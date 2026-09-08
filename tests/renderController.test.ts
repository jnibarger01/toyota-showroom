// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  RenderController,
  type RenderControllerOptions,
  type RendererLike,
  type RendererMode,
} from "../lib/three/renderController";

// jsdom implements neither ResizeObserver nor a real WebGL/WebGPU context (`getContext` returns
// null — confirmed against this exact environment). `RenderController.create`'s `rendererFactory`
// parameter exists for exactly this: every real caller gets the true WebGPU/WebGL2 construction,
// tests inject a fully-controllable fake `RendererLike` instead. ResizeObserver needs its own fake
// global (the same idiom `tests/canvasIdle.test.ts` already uses for IntersectionObserver) since
// nothing in this suite exercises real layout.
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  trigger(): void {
    this.callback([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
  }
}

interface FakeRenderer extends RendererLike {
  setPixelRatioCalls: number[];
  setSizeCalls: Array<[number, number]>;
  renderCalls: number;
  renderAsyncCalls: number;
  disposeCalls: number;
}

function makeFakeRenderer(overrides: Partial<RendererLike> = {}): FakeRenderer {
  const canvas = document.createElement("canvas");
  const fake: FakeRenderer = {
    domElement: canvas,
    setPixelRatioCalls: [],
    setSizeCalls: [],
    renderCalls: 0,
    renderAsyncCalls: 0,
    disposeCalls: 0,
    setPixelRatio(value: number) {
      fake.setPixelRatioCalls.push(value);
    },
    setSize(width: number, height: number) {
      fake.setSizeCalls.push([width, height]);
    },
    render() {
      fake.renderCalls += 1;
    },
    dispose() {
      fake.disposeCalls += 1;
    },
    shadowMap: { enabled: false },
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    isWebGLRenderer: true,
    ...overrides,
  };
  return fake;
}

function makeHost(width = 800, height = 450): HTMLDivElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: width, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: height, configurable: true });
  document.body.appendChild(host);
  return host;
}

async function makeController(
  optionOverrides: Partial<RenderControllerOptions> = {},
  rendererOverrides: Partial<RendererLike> = {},
  mode: RendererMode = "webgl2",
) {
  const host = makeHost();
  const fakeRenderer = makeFakeRenderer(rendererOverrides);
  const controller = await RenderController.create({ host, ...optionOverrides }, async () => ({
    renderer: fakeRenderer,
    mode,
  }));
  return { host, fakeRenderer, controller };
}

let previousResizeObserver: typeof ResizeObserver | undefined;

beforeEach(() => {
  FakeResizeObserver.instances = [];
  previousResizeObserver = (globalThis as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    FakeResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  (globalThis as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = previousResizeObserver;
  document.body.innerHTML = "";
});

describe("RenderController", () => {
  describe("construction", () => {
    it("creates the renderer via the injected factory, appends the canvas, and applies quality", async () => {
      const { host, fakeRenderer, controller } = await makeController();
      expect(host.contains(controller.canvas)).toBe(true);
      expect(controller.canvas).toBe(fakeRenderer.domElement);
      expect(controller.mode).toBe("webgl2");
      expect(controller.canvas.dataset.renderer).toBe("webgl2");
      expect(controller.canvas.dataset.quality).toBe(controller.currentQuality.tier);
      expect(fakeRenderer.setPixelRatioCalls.length).toBe(1);
      expect(fakeRenderer.shadowMap.enabled).toBe(controller.currentQuality.shadowsEnabled);
      expect(fakeRenderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
      expect(fakeRenderer.toneMappingExposure).toBeCloseTo(1.05, 5);
    });

    it("registers a ResizeObserver on the host", async () => {
      const { host } = await makeController();
      const observer = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]!;
      expect(observer.observed).toContain(host);
    });

    it("starts with the render loop running and not suspended (document visible, no IntersectionObserver)", async () => {
      const { controller } = await makeController();
      expect(controller.canvas.dataset.idle).toBe("0");
    });
  });

  describe("resize", () => {
    it("sizes the renderer to the host's client box and notifies onResize", async () => {
      const onResize = vi.fn();
      const { fakeRenderer, controller } = await makeController({ onResize });
      fakeRenderer.setSizeCalls.length = 0;
      onResize.mockClear();
      controller.resize();
      expect(fakeRenderer.setSizeCalls).toEqual([[800, 450]]);
      expect(onResize).toHaveBeenCalledWith(800, 450);
    });

    it("clamps a zero-sized host to 1x1 rather than passing 0 to the renderer", async () => {
      const host = makeHost(0, 0);
      const fakeRenderer = makeFakeRenderer();
      const controller = await RenderController.create({ host }, async () => ({
        renderer: fakeRenderer,
        mode: "webgl2",
      }));
      fakeRenderer.setSizeCalls.length = 0;
      controller.resize();
      expect(fakeRenderer.setSizeCalls).toEqual([[1, 1]]);
    });

    it("a ResizeObserver firing on the host calls resize()", async () => {
      const onResize = vi.fn();
      const { fakeRenderer } = await makeController({ onResize });
      fakeRenderer.setSizeCalls.length = 0;
      onResize.mockClear();
      const observer = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]!;
      observer.trigger();
      expect(fakeRenderer.setSizeCalls).toEqual([[800, 450]]);
      expect(onResize).toHaveBeenCalledTimes(1);
    });
  });

  describe("applyQuality", () => {
    it("re-applies pixel ratio / shadow map / dataset and re-syncs size", async () => {
      const { fakeRenderer, controller } = await makeController();
      fakeRenderer.setPixelRatioCalls.length = 0;
      fakeRenderer.setSizeCalls.length = 0;
      const next = { ...controller.currentQuality, tier: "low" as const, shadowsEnabled: false, maxPixelRatio: 1 };
      controller.applyQuality(next);
      expect(controller.currentQuality).toBe(next);
      expect(fakeRenderer.shadowMap.enabled).toBe(false);
      expect(fakeRenderer.setPixelRatioCalls.length).toBe(1);
      expect(controller.canvas.dataset.quality).toBe("low");
      expect(fakeRenderer.setSizeCalls.length).toBe(1); // applyQuality re-syncs size
    });
  });

  describe("render loop", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("calls tick every frame even before a scene/camera is attached, but never renders", async () => {
      const { fakeRenderer, controller } = await makeController();
      let tickCalls = 0;
      controller.start(() => {
        tickCalls += 1;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(tickCalls).toBeGreaterThanOrEqual(1);
      expect(fakeRenderer.renderCalls).toBe(0);
      const before = tickCalls;
      await vi.advanceTimersByTimeAsync(16 * 3);
      expect(tickCalls).toBeGreaterThan(before);
      expect(fakeRenderer.renderCalls).toBe(0);
    });

    it("calls tick then renders once a scene/camera are attached, and keeps chaining frames", async () => {
      const { fakeRenderer, controller } = await makeController();
      controller.attachScene(new THREE.Scene(), new THREE.PerspectiveCamera());
      let tickCalls = 0;
      controller.start(() => {
        tickCalls += 1;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(tickCalls).toBe(1);
      expect(fakeRenderer.renderCalls).toBe(1);
      await vi.advanceTimersByTimeAsync(16 * 3);
      expect(tickCalls).toBeGreaterThan(1);
      expect(fakeRenderer.renderCalls).toBeGreaterThan(1);
    });

    it("uses renderAsync instead of render when the renderer provides it", async () => {
      const renderAsync = vi.fn(() => Promise.resolve());
      const { fakeRenderer, controller } = await makeController({}, { renderAsync });
      controller.attachScene(new THREE.Scene(), new THREE.PerspectiveCamera());
      controller.start(() => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(renderAsync).toHaveBeenCalledTimes(1);
      expect(fakeRenderer.renderCalls).toBe(0);
    });

    it("publishes a frame-stats dataset snapshot after enough frames", async () => {
      const { controller } = await makeController();
      controller.attachScene(new THREE.Scene(), new THREE.PerspectiveCamera());
      controller.start(() => {});
      expect(controller.canvas.dataset.frameStats).toBeUndefined();
      await vi.advanceTimersByTimeAsync(16 * 40);
      expect(controller.canvas.dataset.frameStats).toBeTruthy();
      expect(controller.getFrameStats().samples).toBeGreaterThan(0);
    });
  });

  describe("WebGL context loss / restoration", () => {
    it("pauses the loop on contextlost, resumes and re-syncs size on contextrestored", async () => {
      vi.useFakeTimers();
      try {
        const onContextLost = vi.fn();
        const onContextRestored = vi.fn();
        const { fakeRenderer, controller } = await makeController({ onContextLost, onContextRestored });
        controller.attachScene(new THREE.Scene(), new THREE.PerspectiveCamera());
        controller.start(() => {});
        await vi.advanceTimersByTimeAsync(0);
        const rendersBeforeLoss = fakeRenderer.renderCalls;

        let prevented = false;
        const lostEvent = new Event("webglcontextlost", { cancelable: true });
        Object.defineProperty(lostEvent, "preventDefault", {
          value: () => {
            prevented = true;
          },
        });
        controller.canvas.dispatchEvent(lostEvent);
        expect(prevented).toBe(true);
        expect(onContextLost).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(16 * 5);
        expect(fakeRenderer.renderCalls).toBe(rendersBeforeLoss); // loop stayed paused

        fakeRenderer.setSizeCalls.length = 0;
        controller.canvas.dispatchEvent(new Event("webglcontextrestored"));
        expect(onContextRestored).toHaveBeenCalledTimes(1);
        expect(fakeRenderer.setSizeCalls.length).toBe(1); // resize() re-synced the drawing buffer

        await vi.advanceTimersByTimeAsync(16 * 3);
        expect(fakeRenderer.renderCalls).toBeGreaterThan(rendersBeforeLoss); // loop resumed
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("capture", () => {
    it("returns null for a zero-sized canvas without calling toDataURL", async () => {
      const { controller } = await makeController();
      const spy = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL");
      controller.canvas.width = 0;
      controller.canvas.height = 0;
      expect(controller.capture()).toBeNull();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("returns the PNG data URL for a rendered canvas", async () => {
      const { controller } = await makeController();
      controller.canvas.width = 10;
      controller.canvas.height = 10;
      const spy = vi
        .spyOn(HTMLCanvasElement.prototype, "toDataURL")
        .mockReturnValue("data:image/png;base64,fake");
      expect(controller.capture()).toBe("data:image/png;base64,fake");
      spy.mockRestore();
    });

    it("fails closed to null when toDataURL throws (tainted canvas)", async () => {
      const { controller } = await makeController();
      controller.canvas.width = 10;
      controller.canvas.height = 10;
      const spy = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => {
        throw new DOMException("tainted", "SecurityError");
      });
      expect(controller.capture()).toBeNull();
      spy.mockRestore();
    });
  });

  describe("disposal", () => {
    it("disposes the renderer, detaches the canvas, disconnects the ResizeObserver, and is idempotent", async () => {
      const { host, fakeRenderer, controller } = await makeController();
      const observer = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]!;
      controller.dispose();
      expect(fakeRenderer.disposeCalls).toBe(1);
      expect(host.contains(controller.canvas)).toBe(false);
      expect(observer.disconnected).toBe(true);

      expect(() => controller.dispose()).not.toThrow();
      expect(fakeRenderer.disposeCalls).toBe(1); // not double-disposed
    });

    it("stops the render loop so no further frames render after dispose", async () => {
      vi.useFakeTimers();
      try {
        const { fakeRenderer, controller } = await makeController();
        controller.attachScene(new THREE.Scene(), new THREE.PerspectiveCamera());
        controller.start(() => {});
        await vi.advanceTimersByTimeAsync(0);
        controller.dispose();
        const rendersAtDispose = fakeRenderer.renderCalls;
        await vi.advanceTimersByTimeAsync(16 * 5);
        expect(fakeRenderer.renderCalls).toBe(rendersAtDispose);
      } finally {
        vi.useRealTimers();
      }
    });

    it("removes the context-loss listeners so a post-dispose event is a no-op", async () => {
      const onContextLost = vi.fn();
      const { controller } = await makeController({ onContextLost });
      controller.dispose();
      controller.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      expect(onContextLost).not.toHaveBeenCalled();
    });
  });

  describe("ownership isolation", () => {
    it("two independently created controllers do not share a renderer or canvas", async () => {
      const a = await makeController();
      const b = await makeController();
      expect(a.controller.canvas).not.toBe(b.controller.canvas);
      expect(a.fakeRenderer).not.toBe(b.fakeRenderer);
      a.controller.applyQuality({ ...a.controller.currentQuality, tier: "low" });
      expect(b.controller.currentQuality.tier).not.toBe("low");
    });
  });
});
