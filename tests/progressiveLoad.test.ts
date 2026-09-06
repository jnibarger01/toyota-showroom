import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fourRunner } from "../lib/data/vehicles/4runner";
import { VEHICLES } from "../lib/data/vehicles";

/**
 * Guards the progressive-load contract in `app/components/VehicleCanvas.tsx`.
 *
 * The canvas cannot be rendered here — jsdom has no WebGL or WebGPU context, which is why
 * `tests/components/BuilderApp.test.tsx` stubs it out entirely. What *can* be asserted without a
 * GPU are the two properties that make the change worth having, both of which are ordering
 * properties a refactor can silently reverse:
 *
 *   1. The render loop starts before the model is awaited. If that ordering flips back, first paint
 *      is once again gated on the largest asset on the page and nobody notices until someone
 *      profiles a cold load on a slow connection.
 *   2. Teardown is registered before the first `await`. Otherwise an unmount during loading leaks
 *      the renderer, its WebGL context, and a render loop still drawing into a detached canvas.
 *
 * Source-order assertions are a blunt instrument and normally the wrong tool. They earn their place
 * here because the alternative is no coverage at all, and because both properties are invisible in
 * behaviour until they are expensive: the app looks correct either way, just slower and leakier.
 */
const CANVAS_SOURCE = readFileSync(
  path.join(process.cwd(), "app/components/VehicleCanvas.tsx"),
  "utf8",
);

describe("progressive load ordering", () => {
  it("starts the render loop before awaiting the vehicle model", () => {
    const loopStart = CANVAS_SOURCE.indexOf("void loop();");
    const modelAwait = CANVAS_SOURCE.indexOf("await loadVehicleRoot(");

    expect(loopStart, "expected a `void loop();` call in VehicleCanvas").toBeGreaterThan(-1);
    expect(modelAwait, "expected an `await loadVehicleRoot(` call in VehicleCanvas").toBeGreaterThan(-1);
    expect(
      loopStart,
      "The render loop must start before the model is awaited, otherwise the entire showroom " +
        "(lights, floor, grid, environment) waits on geometry it does not depend on and first " +
        "paint is bounded by the largest asset on the page.",
    ).toBeLessThan(modelAwait);
  });

  it("registers teardown before the first await", () => {
    const cleanupAssigned = CANVAS_SOURCE.indexOf("cleanup = () => {");
    const modelAwait = CANVAS_SOURCE.indexOf("await loadVehicleRoot(");

    expect(cleanupAssigned, "expected a `cleanup = () => {` assignment").toBeGreaterThan(-1);
    expect(
      cleanupAssigned,
      "Teardown must be registered before the first await. Assigned afterwards, unmounting during " +
        "load (a route change, or React strict-mode's double effect) leaks the renderer, its WebGL " +
        "context, the resize observer, and a render loop drawing into a detached canvas.",
    ).toBeLessThan(modelAwait);
  });

  it("shows a placeholder vehicle while the real model streams in", () => {
    // The proxy is what makes the early render loop worth anything — an empty showroom renders
    // fast but communicates nothing.
    expect(CANVAS_SOURCE).toContain("const proxy = createProceduralVehicle()");
    expect(CANVAS_SOURCE).toContain("swapProxyForVehicle(proxy");
  });

  it("loads running gear after the body is in the scene", () => {
    const bodyAdded = CANVAS_SOURCE.indexOf("root = await loadVehicleRoot(");
    const runningGear = CANVAS_SOURCE.indexOf("await installWheelAndTireAssets(");

    expect(runningGear).toBeGreaterThan(-1);
    expect(
      runningGear,
      "Running gear is additive — the body is complete without it. Fetching it before the body " +
        "resolves puts an optional asset on the critical path.",
    ).toBeGreaterThan(bodyAdded);
  });
});

describe("optimized running-gear assets", () => {
  it("points the 4Runner at binary .glb running gear, not base64 .gltf", () => {
    // The tire and wheel were `.gltf` with base64 `data:` buffers: a ~33% encoding tax on top of
    // morph targets nothing could drive (9.11 MiB and 1.41 MiB, for 35k and 14k triangles).
    // `scripts/optimize-models.mjs` rewrites them as binary GLB; this asserts the config followed.
    const assets = fourRunner.threeDConfig.wheelAndTireAssets;
    expect(assets).toBeDefined();
    expect(assets?.wheelUrl).toMatch(/\.glb$/);
    expect(assets?.tireUrl).toMatch(/\.glb$/);
  });

  it("ships every runtime model as .glb", () => {
    // A `.gltf` in a threeDConfig means either an external-buffer asset (an extra round trip) or a
    // base64 one (a 33% tax). Neither belongs on the critical path; catch it at the config level.
    for (const vehicle of VEHICLES) {
      const { modelUrl, wheelAndTireAssets } = vehicle.threeDConfig;
      for (const url of [modelUrl, wheelAndTireAssets?.wheelUrl, wheelAndTireAssets?.tireUrl]) {
        if (!url) continue;
        expect(url, `${vehicle.slug} fetches ${url} at runtime`).toMatch(/\.glb$/);
      }
    }
  });
});
