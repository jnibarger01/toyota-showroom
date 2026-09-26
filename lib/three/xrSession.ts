/**
 * WebXR session lifecycle for the vehicle stage (#16).
 *
 * Owns exactly one thing: getting into and out of an `immersive-ar` session, and telling the rest
 * of the runtime when that has happened. It does not render, does not touch the camera, and does
 * not know what a vehicle is — the same plain-class shape `CameraController`,
 * `EnvironmentController` and `RenderController` already use, so it stays unit-testable without a
 * headset, a GPU, or a DOM.
 *
 * ## The render loop has to change hands
 *
 * `RenderController` drives frames from its own `requestAnimationFrame` chain. That cannot drive an
 * XR device: frames there are paced by the headset or phone compositor, not the page, and are
 * delivered through `renderer.setAnimationLoop`. Entering XR therefore hands the loop over and
 * exiting hands it back — `onPresentingChange` is that signal, and it is the reason this module
 * reports state rather than owning the renderer.
 *
 * ## Why `immersive-ar` and not `immersive-vr`
 *
 * The product question a shopper has is "how big is this in my driveway", which is AR. A VR session
 * would also need a room-scale environment built for it; the showroom's floor, HDRI backdrop and
 * fog are staged for a camera orbiting a plinth, and would read as a void around the vehicle.
 *
 * ## What is deliberately not here
 *
 * (Superseded: tap-to-place on a hit-tested floor now lives in `arPlacement.ts`, and `hit-test` is
 * requested below as an optional feature.) The original reasoning, kept for context:
 * No hit-testing, plane detection, or placement UI. Those are a real feature on their own and
 * `local-floor` puts the vehicle at the viewer's floor level, which is enough to walk around it —
 * the thing #16 actually asks for. Adding anchors before anyone has used this would be guessing.
 */

/** The subset of `THREE.WebGLRenderer`/`WebGPURenderer` this needs. Structural so either satisfies
 * it and a test double can too — neither real class is constructible in this environment. */
export interface XrCapableRenderer {
  xr: {
    enabled: boolean;
    setSession(session: XRSession | null): Promise<void> | void;
  };
}

export interface XrSessionControllerOptions {
  renderer: XrCapableRenderer;
  /**
   * Called with `true` once the session is live and the renderer is driving it, and `false` once it
   * has ended. The caller uses this to hand the render loop over and take it back.
   */
  onPresentingChange(presenting: boolean): void;
  /** Surfaced to the UI; a refused permission prompt arrives here, not as a thrown error. */
  onError?(message: string): void;
  /** Injected for tests. Defaults to the real `navigator.xr`. */
  xrSystem?: XRSystem | null;
}

/** Session mode. Named rather than inlined so the two call sites cannot drift. */
const XR_MODE: XRSessionMode = "immersive-ar";

/**
 * `local-floor` puts the origin at the viewer's floor, so a vehicle authored sitting on y=0 stands
 * on the real ground rather than floating at head height. It is requested **optionally**, not as a
 * required feature.
 *
 * Required would defeat its own fallback: `isSessionSupported("immersive-ar")` does not account for
 * reference-space features, so a device that supports AR without floor-level tracking would pass
 * the support check, show the entry control, and then have `requestSession` reject — a control that
 * fails on tap, which is exactly what the support gate exists to prevent. `local` is guaranteed for
 * immersive sessions, so requesting both optionally means the session always starts and the best
 * available space is chosen afterwards.
 */
const SESSION_INIT: XRSessionInit = { optionalFeatures: ["local-floor", "local", "hit-test"] };

export class XrSessionController {
  private readonly renderer: XrCapableRenderer;
  private readonly options: XrSessionControllerOptions;
  private readonly xrSystem: XRSystem | null;

  private session: XRSession | null = null;
  private disposed = false;
  /** Guards against a double-tap on the entry control opening two sessions. */
  private starting = false;
  private readonly handleSessionEnd = () => this.handleEnded();

  constructor(options: XrSessionControllerOptions) {
    this.options = options;
    this.renderer = options.renderer;
    this.xrSystem =
      options.xrSystem !== undefined
        ? options.xrSystem
        : ((globalThis.navigator as Navigator & { xr?: XRSystem })?.xr ?? null);
  }

  /** Whether this device can offer the session at all. `false` rather than throwing when `navigator.xr`
   * is absent, which is every desktop browser without a headset and every iOS browser today. */
  async isSupported(): Promise<boolean> {
    if (!this.xrSystem?.isSessionSupported) return false;
    try {
      return await this.xrSystem.isSessionSupported(XR_MODE);
    } catch {
      // Some browsers reject rather than resolving false in a non-secure context.
      return false;
    }
  }

  /** The live session, for features layered on it (`ArPlacement`). `null` when not presenting. */
  get currentSession(): XRSession | null {
    return this.session;
  }

  get isPresenting(): boolean {
    return this.session !== null;
  }

  /**
   * Requests and starts a session. Resolves `false` if it could not start, having already reported
   * why through `onError` — the caller does not need its own catch.
   */
  async enter(): Promise<boolean> {
    if (this.disposed || this.session || this.starting) return false;
    if (!this.xrSystem?.requestSession) {
      this.options.onError?.("This device does not support AR.");
      return false;
    }

    this.starting = true;
    try {
      const session = await this.xrSystem.requestSession(XR_MODE, SESSION_INIT);
      if (this.disposed) {
        // Unmounted while the permission prompt was open; end the session we just opened rather
        // than leaving the camera running behind a torn-down canvas.
        void session.end().catch(() => {});
        return false;
      }
      this.session = session;
      session.addEventListener("end", this.handleSessionEnd);
      this.renderer.xr.enabled = true;
      try {
        await this.renderer.xr.setSession(session);
      } catch (handoffError) {
        // The session is live and holding the camera even though the renderer refused it. Clearing
        // `this.session` without ending it would strand exactly that: the UI reports failure while
        // the camera stays on, and a later device-initiated `end` is ignored because `handleEnded`
        // sees a null session and returns. Tear it down explicitly, through the same path.
        this.teardownSession();
        void session.end().catch(() => {});
        throw handoffError;
      }
      // Only after the renderer owns the session: this signals the caller to stop its rAF chain,
      // and doing that before the handover would leave a window with nothing driving frames.
      this.options.onPresentingChange(true);
      return true;
    } catch (error) {
      // A declined camera permission lands here. It is an ordinary outcome, not a fault.
      this.options.onError?.(error instanceof Error ? error.message : "Could not start an AR session.");
      this.teardownSession();
      return false;
    } finally {
      this.starting = false;
    }
  }

  /** Ends the session. The `end` event does the teardown, so this stays a single code path whether
   * the exit came from here or from the headset's own control. */
  async exit(): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      await session.end();
    } catch {
      // Already ending. `handleEnded` still runs from the event.
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    void this.exit();
  }

  /**
   * Detaches the listener and clears renderer state without announcing anything.
   *
   * Shared by the failure paths and `handleEnded` so there is exactly one place that knows how to
   * let go of a session — the leak this fixes came from a catch block doing half of it inline.
   */
  private teardownSession(): void {
    this.session?.removeEventListener("end", this.handleSessionEnd);
    this.session = null;
    this.renderer.xr.enabled = false;
  }

  private handleEnded(): void {
    if (!this.session) return;
    this.teardownSession();
    // Reported even when disposed: the caller's own teardown is idempotent, and swallowing this
    // would leave a disposed-mid-session canvas believing it is still presenting.
    this.options.onPresentingChange(false);
  }
}
