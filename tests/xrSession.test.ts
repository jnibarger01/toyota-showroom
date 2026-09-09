import { beforeEach, describe, expect, it, vi } from "vitest";
import { XrSessionController, type XrCapableRenderer } from "../lib/three/xrSession";

/**
 * No headset, no `navigator.xr`, and no constructible renderer in this environment, so the session
 * lifecycle is driven against doubles. That covers the parts that are actually easy to get wrong —
 * ordering of the renderer handover, a declined permission, a session ended from the device's own
 * control, and unmounting while the permission prompt is open. Whether AR *looks* right on a phone
 * is not something any test here can claim.
 */

function makeSession() {
  const listeners = new Map<string, Set<() => void>>();
  const session = {
    end: vi.fn(async () => session.fireEnd()),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => listeners.get(type)?.delete(listener)),
    fireEnd: () => {
      for (const listener of [...(listeners.get("end") ?? [])]) listener();
    },
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
  };
  return session;
}

function makeRenderer(): XrCapableRenderer & { xr: { enabled: boolean; setSession: ReturnType<typeof vi.fn> } } {
  return { xr: { enabled: false, setSession: vi.fn(async () => {}) } };
}

function makeXrSystem(session: ReturnType<typeof makeSession>, supported = true) {
  return {
    isSessionSupported: vi.fn(async () => supported),
    requestSession: vi.fn(async () => session),
  } as unknown as XRSystem;
}

describe("XrSessionController", () => {
  let session: ReturnType<typeof makeSession>;
  let renderer: ReturnType<typeof makeRenderer>;
  let onPresentingChange: ReturnType<typeof vi.fn>;
  let onError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    session = makeSession();
    renderer = makeRenderer();
    onPresentingChange = vi.fn();
    onError = vi.fn();
  });

  const make = (xrSystem: XRSystem | null) =>
    new XrSessionController({ renderer, onPresentingChange, onError, xrSystem });

  describe("support detection", () => {
    it("reports unsupported when navigator.xr is absent, rather than throwing", async () => {
      await expect(make(null).isSupported()).resolves.toBe(false);
    });

    it("reports unsupported when the device says so", async () => {
      await expect(make(makeXrSystem(session, false)).isSupported()).resolves.toBe(false);
    });

    it("treats a rejected support query as unsupported (insecure context)", async () => {
      const xrSystem = { isSessionSupported: vi.fn(async () => { throw new Error("insecure"); }) } as unknown as XRSystem;
      await expect(make(xrSystem).isSupported()).resolves.toBe(false);
    });

    it("reports supported when the device offers immersive-ar", async () => {
      await expect(make(makeXrSystem(session)).isSupported()).resolves.toBe(true);
    });
  });

  describe("entering", () => {
    it("enables the renderer and hands it the session before announcing presentation", async () => {
      const controller = make(makeXrSystem(session));
      const order: string[] = [];
      renderer.xr.setSession.mockImplementation(async () => void order.push("setSession"));
      onPresentingChange.mockImplementation(() => order.push("presenting"));

      await expect(controller.enter()).resolves.toBe(true);

      // Announcing first would stop the caller's rAF chain while nothing yet drove frames.
      expect(order).toEqual(["setSession", "presenting"]);
      expect(renderer.xr.enabled).toBe(true);
      expect(controller.isPresenting).toBe(true);
    });

    it("reports a declined permission through onError rather than throwing", async () => {
      const xrSystem = {
        isSessionSupported: vi.fn(async () => true),
        requestSession: vi.fn(async () => { throw new Error("Permission denied"); }),
      } as unknown as XRSystem;
      const controller = make(xrSystem);

      await expect(controller.enter()).resolves.toBe(false);
      expect(onError).toHaveBeenCalledWith("Permission denied");
      expect(controller.isPresenting).toBe(false);
      expect(renderer.xr.enabled).toBe(false);
      expect(onPresentingChange).not.toHaveBeenCalled();
    });

    it("reports unsupported hardware through onError", async () => {
      await expect(make(null).enter()).resolves.toBe(false);
      expect(onError).toHaveBeenCalledWith("This device does not support AR.");
    });

    it("ignores a second enter while one is already in flight", async () => {
      const xrSystem = makeXrSystem(session);
      const controller = make(xrSystem);
      const [first, second] = await Promise.all([controller.enter(), controller.enter()]);
      expect([first, second].filter(Boolean)).toHaveLength(1);
      expect(xrSystem.requestSession).toHaveBeenCalledTimes(1);
    });

    it("ends a session that arrived after dispose instead of leaving the camera running", async () => {
      const controller = make(makeXrSystem(session));
      const pending = controller.enter();
      controller.dispose();
      await expect(pending).resolves.toBe(false);
      expect(session.end).toHaveBeenCalled();
    });
  });

  describe("exiting", () => {
    it("announces the end and disables the renderer when the device ends the session", async () => {
      const controller = make(makeXrSystem(session));
      await controller.enter();
      onPresentingChange.mockClear();

      // The headset's own exit control, not ours — this is the path that must not be missed.
      session.fireEnd();

      expect(onPresentingChange).toHaveBeenCalledWith(false);
      expect(renderer.xr.enabled).toBe(false);
      expect(controller.isPresenting).toBe(false);
    });

    it("routes an app-driven exit through the same teardown", async () => {
      const controller = make(makeXrSystem(session));
      await controller.enter();
      onPresentingChange.mockClear();

      await controller.exit();

      expect(onPresentingChange).toHaveBeenCalledWith(false);
      expect(controller.isPresenting).toBe(false);
    });

    it("removes its end listener so a controller cannot leak one per session", async () => {
      const controller = make(makeXrSystem(session));
      await controller.enter();
      expect(session.listenerCount("end")).toBe(1);
      await controller.exit();
      expect(session.listenerCount("end")).toBe(0);
    });

    it("is a no-op when not presenting", async () => {
      await expect(make(makeXrSystem(session)).exit()).resolves.toBeUndefined();
      expect(onPresentingChange).not.toHaveBeenCalled();
    });

    it("survives a session that rejects on end", async () => {
      const controller = make(makeXrSystem(session));
      await controller.enter();
      session.end.mockImplementation(async () => { throw new Error("already ending"); });
      await expect(controller.exit()).resolves.toBeUndefined();
    });
  });
});
