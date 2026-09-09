import { describe, expect, it, vi } from "vitest";
import { createGpuTimer } from "../lib/three/gpuTimer";

/**
 * Neither timer API exists in this environment — there is no GPU here at all — so these tests cover
 * what actually has to hold on the machines that run them: that an absent capability degrades to
 * `null` instead of throwing during renderer construction, and that the WebGPU path drives three's
 * async resolution correctly. The real WebGL2 query path needs a live GL context and is exercised
 * by the browser e2e run, not here.
 */

describe("createGpuTimer — capability detection", () => {
  it("returns null for a renderer that exposes no timing API at all", () => {
    expect(createGpuTimer({ render() {} })).toBeNull();
  });

  it("returns null rather than throwing when capability probing itself blows up", () => {
    const hostile = {
      get resolveTimestampsAsync(): never {
        throw new Error("extension probing blocked");
      },
    };
    expect(createGpuTimer(hostile)).toBeNull();
  });

  it("returns null for null/undefined instead of assuming an object", () => {
    expect(createGpuTimer(null)).toBeNull();
    expect(createGpuTimer(undefined)).toBeNull();
  });
});

describe("createGpuTimer — WebGPU timestamp path", () => {
  function makeRenderer(resolve: () => Promise<number | undefined>) {
    return { trackTimestamp: false, resolveTimestampsAsync: vi.fn(resolve) };
  }

  it("enables trackTimestamp, without which three never allocates a query pool", () => {
    const renderer = makeRenderer(async () => 4);
    const timer = createGpuTimer(renderer);
    expect(timer?.source).toBe("webgpu-timestamp");
    expect(renderer.trackTimestamp).toBe(true);
  });

  it("reports no measurement until one has actually resolved", () => {
    const timer = createGpuTimer(makeRenderer(async () => 4));
    expect(timer?.lastGpuMs()).toBeNull();
  });

  it("publishes a resolved duration", async () => {
    const timer = createGpuTimer(makeRenderer(async () => 7.5))!;
    timer.beginFrame();
    timer.endFrame();
    await vi.waitFor(() => expect(timer.lastGpuMs()).toBe(7.5));
  });

  it("keeps only one resolution outstanding so slow frames cannot pile up promises", async () => {
    let release!: (value: number) => void;
    const renderer = makeRenderer(() => new Promise<number>((resolve) => (release = resolve)));
    const timer = createGpuTimer(renderer)!;

    for (let i = 0; i < 5; i += 1) {
      timer.beginFrame();
      timer.endFrame();
    }
    expect(renderer.resolveTimestampsAsync).toHaveBeenCalledTimes(1);

    release(3);
    await vi.waitFor(() => expect(timer.lastGpuMs()).toBe(3));

    // Once settled, the next frame may request again.
    timer.beginFrame();
    timer.endFrame();
    expect(renderer.resolveTimestampsAsync).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good value when a resolution rejects", async () => {
    let fail = false;
    const timer = createGpuTimer(
      makeRenderer(async () => {
        if (fail) throw new Error("query pool lost");
        return 9;
      }),
    )!;

    timer.beginFrame();
    timer.endFrame();
    await vi.waitFor(() => expect(timer.lastGpuMs()).toBe(9));

    fail = true;
    timer.beginFrame();
    timer.endFrame();
    await vi.waitFor(() => expect(timer.lastGpuMs()).toBe(9));
  });

  it("ignores a non-finite result rather than publishing NaN as a frame time", async () => {
    const timer = createGpuTimer(makeRenderer(async () => Number.NaN))!;
    timer.beginFrame();
    timer.endFrame();
    await vi.waitFor(() => expect(timer.lastGpuMs()).toBeNull());
  });

  it("stops tracking and ignores late results after dispose", async () => {
    let release!: (value: number) => void;
    const renderer = makeRenderer(() => new Promise<number>((resolve) => (release = resolve)));
    const timer = createGpuTimer(renderer)!;
    timer.beginFrame();
    timer.endFrame();

    timer.dispose();
    release(11);
    await Promise.resolve();

    expect(renderer.trackTimestamp).toBe(false);
    expect(timer.lastGpuMs()).toBeNull();
  });
});
