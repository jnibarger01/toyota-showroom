import * as THREE from "three";
import * as THREE_WEBGPU from "three/webgpu";
import {
  collectBrowserDeviceHints,
  CONSTRUCTION_TIME_QUALITY_KEYS,
  qualitySettingsFor,
  resolveQuality,
  type QualitySettings,
} from "./quality";
import { QualityGovernor } from "./qualityGovernor";
import { preferredTierHint, readQualityPreference, writeQualityPreference, type QualityPreference } from "./qualityPreference";
import { createCanvasIdleGate, type CanvasIdleGate } from "./canvasIdle";
import { FrameTimeTracker, formatFrameStats, type FrameStatsSnapshot } from "./frameStats";
import { createGpuTimer, type GpuTimer } from "./gpuTimer";
import { recordMetric } from "../observability/clientMetrics";

/**
 * Owns the render-side runtime authority `VehicleCanvas.tsx` used to keep as a dozen scattered
 * `let`s in one giant setup effect: the renderer instance itself (WebGPU-preferred, WebGL2
 * fallback), capability/mode selection, quality application, resize, the render lifecycle (rAF
 * scheduling, idle suspension, WebGL context loss/restoration, adaptive quality governance,
 * per-frame paint), a capture/screenshot capability, frame-stat metrics hooks, and disposal.
 * Mission Priority 6.
 *
 * Deliberately plain TypeScript, the same shape `CameraController`/`EnvironmentController`/
 * `VehicleSceneController` already use: no React import, no application-state or agent-layer
 * dependency, a constructor (well — an async factory, since renderer creation is async: WebGPU
 * needs `await renderer.init()`) that builds and owns everything it creates, and a single
 * `dispose()` that undoes it.
 *
 * ## Why a `tick` callback instead of owning the camera
 *
 * The render loop needs `CameraController.update()` called once per frame, before the paint — but
 * this module does not import `CameraController` or know it exists. `start(tick)` takes a plain
 * `() => void` callback instead, called immediately before each frame's render. That is what keeps
 * this a *render* controller rather than a second place camera/vehicle state is reachable from —
 * mission Priority 6's own instruction not to merge vehicle/camera/renderer state into one giant
 * controller. `attachScene` is the same shape: this module holds `THREE.Scene`/`THREE.Camera`
 * references only to pass them to `renderer.render(...)`, never to read or mutate them.
 *
 * ## capture() — new, not extracted
 *
 * Nothing in the pre-Priority-6 `VehicleCanvas.tsx` had a screenshot capability — `docs/
 * AGENT_API.md`'s own "not implemented yet" section names `showroom.capture` as blocked on exactly
 * this not existing. `capture()` is the minimal real capability that unblocks it later (a future,
 * explicitly-requested agent-API composition, the same shape `camera.focusPart` became once
 * `CameraController.focusPoint` existed) — `HTMLCanvasElement.toDataURL`, not a new rendering
 * pipeline or a new dependency.
 */

export type RendererMode = "webgpu" | "webgl2";

/** Structural surface both `WebGPURenderer` and `WebGLRenderer` satisfy — the same narrowing
 * `VehicleCanvas.tsx` used before this extraction, needed because the two real classes share no
 * common base type in `three`'s own types. */
export type RendererLike = {
  domElement: HTMLCanvasElement;
  setPixelRatio(value: number): void;
  setSize(width: number, height: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  renderAsync?: (scene: THREE.Scene, camera: THREE.Camera) => Promise<void>;
  dispose(): void;
  shadowMap: { enabled: boolean };
  /** Present on both real renderers. Used only when handing the loop to an XR device — rAF cannot
   * pace frames for a headset or phone compositor. Optional so test doubles need not provide it. */
  setAnimationLoop?: (callback: ((time: number, frame?: unknown) => void) | null) => void | Promise<void>;
  xr?: { enabled: boolean; setSession(session: unknown): Promise<void> | void };
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  /** Real on `THREE.WebGLRenderer` (constructor sets it `true`), absent on `WebGPURenderer` —
   * `EnvironmentController.applyHdri`'s WebGL-only PMREM guard keys off exactly this. */
  isWebGLRenderer?: boolean;
};

export interface RenderControllerOptions {
  /** Element the canvas is appended to and the `ResizeObserver`/idle `IntersectionObserver` watch. */
  host: HTMLElement;
  /** Called after every resize (initial sizing included) with the new CSS pixel dimensions — the
   * seam a caller uses to also update its own camera's aspect ratio, without this module knowing
   * `CameraController` exists. */
  onResize?: (width: number, height: number) => void;
  /** Called when a quality tier change has already been applied to the renderer — the seam a
   * caller uses to re-apply quality-dependent state it owns (e.g. `EnvironmentController.
   * applyQuality`), without this module knowing that controller exists either. */
  onQualityChange?: (next: QualitySettings) => void;
  /** WebGL context lost — rendering has stopped until `webglcontextrestored` fires. */
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export class RenderController {
  /** The live canvas — VehicleCanvas.tsx still writes its own dataset attributes on this directly
   * (`data-selected-part`, `data-hovered-part`, `data-load-phase`), the same way it always did. */
  readonly canvas: HTMLCanvasElement;
  readonly mode: RendererMode;
  /** Exposed for `EnvironmentController.applyHdri`'s WebGL-only PMREM check — the exact renderer
   * reference `VehicleCanvas.tsx` used to bridge via its own `rendererRef`. */
  readonly renderer: RendererLike;

  private readonly host: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly idleGate: CanvasIdleGate;
  private readonly frameStats = new FrameTimeTracker(60);
  readonly governor: QualityGovernor;
  private readonly options: RenderControllerOptions;
  private readonly handleContextLost: (event: Event) => void;
  private readonly handleContextRestored: () => void;
  /** GPU-side frame timing where the platform offers it; `null` otherwise. See `gpuTimer.ts`. */
  private readonly gpuTimer: GpuTimer | null;

  private quality: QualitySettings;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  private tick: (() => void) | undefined;
  private running = true;
  private suspended: boolean;
  private rafId = 0;
  private framePublishCount = 0;
  private disposed = false;
  /** True while an XR device is pacing frames instead of `requestAnimationFrame`. */
  private xrPresenting = false;

  /**
   * `rendererFactory` defaults to the real WebGPU/WebGL2 construction (`createRenderer` below) —
   * every real caller gets exactly that. The parameter exists so unit tests can inject a fake
   * `RendererLike` instead: this module's constructor, resize/quality/render-loop/capture/dispose
   * logic is otherwise plain, GPU-independent TypeScript, but `createRenderer` itself calls
   * `renderer.init()`/`getContext('webgl2')`, which needs a real GPU-backed canvas that neither
   * jsdom nor plain Node provides — the same "no WebGLRenderer available in this environment"
   * constraint `EnvironmentController.applyHdri`'s tests already document and work around.
   */
  static async create(
    options: RenderControllerOptions,
    rendererFactory: (antialias: boolean) => Promise<{ renderer: RendererLike; mode: RendererMode }> = createRenderer,
  ): Promise<RenderController> {
    // A stored viewer preference outranks device inference — that is the whole point of it. It is
    // read here rather than applied after construction so `antialias`, which cannot change on a
    // live renderer, is right the first time.
    const preference = readQualityPreference();
    const quality = resolveQuality(collectBrowserDeviceHints(preferredTierHint(preference)));
    const { renderer, mode } = await rendererFactory(quality.antialias);
    const controller = new RenderController(renderer, mode, quality, options);
    if (preference !== "auto") controller.governor.setPinnedTier(preference);
    return controller;
  }

  private constructor(renderer: RendererLike, mode: RendererMode, quality: QualitySettings, options: RenderControllerOptions) {
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.mode = mode;
    this.quality = quality;
    this.host = options.host;
    this.options = options;

    this.gpuTimer = createGpuTimer(renderer);
    if (this.gpuTimer) this.canvas.dataset.gpuTimer = this.gpuTimer.source;

    applyRendererQuality(renderer, quality);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.canvas.dataset.renderer = mode;
    recordMetric({ name: "renderer_selected", labels: { renderer: mode, tier: quality.tier } });
    this.canvas.dataset.quality = quality.tier;
    options.host.appendChild(this.canvas);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(options.host);

    this.idleGate = createCanvasIdleGate(options.host, (next) => {
      this.suspended = next;
      this.canvas.dataset.idle = next ? "1" : "0";
      if (next) {
        this.cancelPendingRaf();
        return;
      }
      // Leaving idle: drop any stale rAF, reseed frame timing, and kick a single chain.
      if (this.running) {
        this.cancelPendingRaf();
        this.frameStats.reset();
        // The frames either side of an idle gap describe the pause, not the renderer; feeding
        // them to the governor would drive a downgrade on resume.
        this.governor.reset();
        this.loop();
      }
    });
    this.suspended = this.idleGate.suspended;
    this.canvas.dataset.idle = this.suspended ? "1" : "0";

    this.governor = new QualityGovernor({
      initialTier: quality.tier,
      onChange: (next, { from, reason }) => {
        this.applyQuality(next);
        this.options.onQualityChange?.(next);
        recordMetric({
          name: "quality_changed",
          value: Math.round(this.governor.averageFrameTimeMs),
          labels: { from, to: next.tier, reason },
        });
        // Left in production rather than dev-gated: when someone reports "the showroom looks
        // blurry on my phone", this line is the answer, and it fires a handful of times a session.
        console.info(`[quality] ${reason}: ${from} -> ${next.tier}`);
      },
    });

    /**
     * WebGL context loss.
     *
     * The GPU process can drop a context at any time — a driver reset, the OS reclaiming VRAM, a
     * background tab being evicted, too many live contexts. It arrives as an *event*, not an
     * exception, so neither a try/catch around model loading nor a React error boundary sees it:
     * the render loop just keeps calling into a dead context and the viewport freezes on its last
     * frame with nothing logged anywhere.
     *
     * `preventDefault` on `webglcontextlost` is what makes the context eligible for restoration at
     * all — without it the browser never fires `webglcontextrestored`.
     */
    this.handleContextLost = (event: Event) => {
      event.preventDefault();
      this.running = false;
      this.cancelPendingRaf();
      console.warn("[canvas] WebGL context lost; pausing render loop until it is restored.");
      this.options.onContextLost?.();
    };
    this.handleContextRestored = () => {
      console.info("[canvas] WebGL context restored; resuming render loop.");
      // Reallocates the drawing buffer against the restored context; without it the renderer keeps
      // the dimensions of a buffer that no longer exists.
      this.resize();
      this.options.onContextRestored?.();
      if (this.running) return;
      this.running = true;
      this.frameStats.reset();
      this.governor.reset();
      this.loop();
    };
    this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
  }

  get currentQuality(): QualitySettings {
    return this.quality;
  }

  /** What `renderer.render`/`renderAsync` paints each frame. Set once the scene/camera exist. */
  attachScene(scene: THREE.Scene, camera: THREE.Camera): void {
    this.scene = scene;
    this.camera = camera;
  }

  /** Sizes the renderer to the host's current CSS box and notifies `onResize`. Called once
   * explicitly by the caller after every other controller exists (so `onResize` — typically a
   * camera aspect update — has something to call into), and automatically on every host resize
   * and context restoration afterward. */
  resize(): void {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(width, height);
    this.options.onResize?.(width, height);
  }

  /**
   * Re-applies a quality tier to the live renderer: pixel ratio, shadow map enablement, dataset,
   * and a resize (matching the pre-extraction `applyTier`'s own unconditional resize — a safety
   * re-sync, not something this changes behavior on). Does NOT re-apply quality-dependent state
   * other controllers own (e.g. `EnvironmentController`'s shadow-casting lights, its starfield
   * density) — that is what `onQualityChange` is for.
   *
   * `CONSTRUCTION_TIME_QUALITY_KEYS` (antialias, authored running gear) cannot follow a live tier
   * change; see that constant for why. Dev builds warn when a change would have needed them, so the
   * limitation shows up while tuning the tier table rather than as an unexplained shortfall between
   * the cost a downgrade claims to shed and the cost it actually sheds.
   */
  applyQuality(next: QualitySettings): void {
    if (process.env.NODE_ENV !== "production") {
      const ignored = CONSTRUCTION_TIME_QUALITY_KEYS.filter((key) => this.quality[key] !== next[key]);
      if (ignored.length > 0) {
        console.warn(
          `[quality] ${this.quality.tier} → ${next.tier} also changes ${ignored.join(", ")}, ` +
            "which only apply at construction/load time and will keep their original values.",
        );
      }
    }
    this.quality = next;
    applyRendererQuality(this.renderer, next);
    this.canvas.dataset.quality = next.tier;
    this.resize();
  }

  /**
   * Applies and persists a viewer's quality preference, taking effect immediately.
   *
   * `"auto"` releases the pin and hands the tier back to `QualityGovernor`, leaving the current
   * tier in place until measured frame time moves it — releasing the pin is not itself a reason to
   * jump somewhere, and the governor resumes from live data.
   *
   * A pinned tier still cannot change `CONSTRUCTION_TIME_QUALITY_KEYS`. Choosing `high` on a
   * renderer built without MSAA gets everything except antialiasing, which needs a reload; the
   * alternative — recreating the renderer under the viewer — would drop the scene and camera pose
   * to change one sample count. `qualityPreferenceNeedsReload` lets the UI say so plainly.
   */
  setQualityPreference(preference: QualityPreference): void {
    writeQualityPreference(preference);
    const pinned = this.governor.setPinnedTier(preference === "auto" ? null : preference);
    if (pinned) {
      this.applyQuality(pinned);
      this.options.onQualityChange?.(pinned);
    }
  }

  /**
   * Whether the live renderer can honour `preference` in full, or needs a reload to do so.
   *
   * Only the construction-time keys can be out of reach; everything else `applyQuality` handles.
   */
  qualityPreferenceNeedsReload(preference: QualityPreference): boolean {
    const target = preferredTierHint(preference);
    if (!target) return false;
    const wanted = qualitySettingsFor(target);
    return CONSTRUCTION_TIME_QUALITY_KEYS.some((key) => this.quality[key] !== wanted[key]);
  }

  /** Starts the render loop, calling `tick()` once before every frame's paint. */
  start(tick: () => void): void {
    this.tick = tick;
    this.loop();
  }

  private cancelPendingRaf(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private queueFrame(): void {
    if (this.rafId !== 0) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.loop();
    });
  }

  /** One frame. Called from the rAF chain normally, and from `setAnimationLoop` while in XR. */
  private loop(): void {
    if (!this.running || this.disposed) return;
    // Idle suspension is a page-visibility concept and does not apply in XR: the canvas is not what
    // the viewer is looking at, and an IntersectionObserver on it says nothing about the headset.
    if (this.suspended && !this.xrPresenting) return;
    const stats = this.frameStats.record(performance.now());
    // Reuses the delta frameStats already computed rather than timing the loop a second time.
    this.governor.recordFrame(stats.lastFrameMs);
    this.framePublishCount += 1;
    if (stats.samples > 0 && this.framePublishCount % 30 === 0) {
      this.canvas.dataset.frameStats = formatFrameStats(stats);
      const gpuMs = this.gpuTimer?.lastGpuMs();
      // Published beside the CPU stats rather than folded into them: the whole value of this number
      // is the *gap* between it and `avgFrameMs`, which is what says whether the scene is GPU-bound
      // and therefore whether the tier ladder can help at all.
      if (typeof gpuMs === "number") this.canvas.dataset.gpuFrameMs = gpuMs.toFixed(2);
    }
    this.tick?.();
    if (!this.scene || !this.camera) {
      this.queueFrame();
      return;
    }
    const scene = this.scene;
    const camera = this.camera;
    this.gpuTimer?.beginFrame();
    const paint = this.renderer.renderAsync
      ? this.renderer.renderAsync(scene, camera)
      : Promise.resolve(this.renderer.render(scene, camera));
    // Ends the query around the *issuing* of the frame's work, which is what both timer APIs
    // measure — not around its completion, which is what the promise below settles on.
    this.gpuTimer?.endFrame();
    void paint.finally(() => {
      // In XR the device asks for the next frame itself; self-queueing would run two loops.
      if (this.running && !this.suspended && !this.xrPresenting) this.queueFrame();
    });
  }

  /**
   * Hands frame pacing to an XR device, or takes it back.
   *
   * `requestAnimationFrame` cannot drive a headset or phone compositor: those frames are paced by
   * the device and delivered through `renderer.setAnimationLoop`, which is also what supplies the
   * per-frame `XRFrame` and the correct per-eye projection. Running the rAF chain as well would
   * render every frame twice, so entering cancels it and exiting restarts it.
   *
   * Called by `XrSessionController.onPresentingChange` rather than reached for directly, so the
   * handover always follows the session's real state instead of an optimistic guess about it.
   */
  setXrPresenting(presenting: boolean): void {
    if (this.disposed || this.xrPresenting === presenting) return;
    this.xrPresenting = presenting;

    if (presenting) {
      this.cancelPendingRaf();
      void this.renderer.setAnimationLoop?.(() => this.loop());
      return;
    }

    void this.renderer.setAnimationLoop?.(null);
    // Resume the page-driven chain only if this controller is still meant to be rendering — an XR
    // session can outlive a tab switch, so `suspended` may legitimately be true on the way out.
    if (this.running && !this.suspended) this.queueFrame();
  }

  /** Whether an XR device currently paces frames. */
  get isXrPresenting(): boolean {
    return this.xrPresenting;
  }

  /** Latest ring-buffer frame-timing snapshot — the `__vehicleFrameStats` dev hook's data source. */
  getFrameStats(): FrameStatsSnapshot {
    return this.frameStats.snapshot();
  }

  /**
   * Most recent GPU-side frame duration in ms, or `null` when this platform offers no timer or none
   * has resolved yet. Compare against `getFrameStats().avgFrameMs`: a large gap means CPU-bound, and
   * the quality ladder — which only controls GPU cost — cannot recover that frame time.
   */
  getGpuFrameMs(): number | null {
    return this.gpuTimer?.lastGpuMs() ?? null;
  }

  /**
   * A PNG data URL of the current canvas contents — the real, minimal capability behind a future
   * `showroom.capture` agent capability (see this module's own doc comment). `null` when nothing
   * has been rendered yet or the canvas is zero-sized, rather than a data URL of a blank frame.
   */
  capture(): string | null {
    if (this.canvas.width === 0 || this.canvas.height === 0) return null;
    try {
      return this.canvas.toDataURL("image/png");
    } catch {
      // A tainted canvas (cross-origin texture without CORS) throws on read — fail closed rather
      // than let a capture call crash the caller.
      return null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    this.cancelPendingRaf();
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    this.idleGate.dispose();
    // Detach the XR loop before disposing the renderer, or it keeps invoking a torn-down scene.
    if (this.xrPresenting) void this.renderer.setAnimationLoop?.(null);
    this.gpuTimer?.dispose();
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

function applyRendererQuality(renderer: RendererLike, quality: QualitySettings): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio));
  renderer.shadowMap.enabled = quality.shadowsEnabled;
}

async function createRenderer(antialias: boolean): Promise<{ renderer: RendererLike; mode: RendererMode }> {
  if (navigator.gpu) {
    try {
      const renderer = new THREE_WEBGPU.WebGPURenderer({ antialias });
      await renderer.init();
      return { renderer: renderer as unknown as RendererLike, mode: "webgpu" };
    } catch (error) {
      console.warn("WebGPU initialization failed; using WebGL2 fallback.", error);
    }
  }

  const renderer = new THREE.WebGLRenderer({ antialias, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return { renderer: renderer as unknown as RendererLike, mode: "webgl2" };
}
