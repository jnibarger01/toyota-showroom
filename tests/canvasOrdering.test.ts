import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fourRunner } from "../lib/data/vehicles/4runner";
import { VEHICLES } from "../lib/data/vehicles";

/**
 * Two ordering properties in `app/components/VehicleCanvas.tsx` that a refactor can silently
 * reverse, plus the asset-shape assertions that keep the payload work from regressing at the
 * config level.
 *
 * `tests/progressiveLoad.test.ts` covers the load *phases* properly, behaviourally, against the
 * `lib/three/progressiveLoad.ts` state machine — that is the better tool and it is already in use.
 * What it cannot see is where those phases sit relative to the renderer's own lifecycle inside the
 * setup effect, because the effect needs a GPU that jsdom does not have.
 *
 * So these two are source-order assertions. Blunt instruments, and normally the wrong tool. They
 * earn their place because the alternative is no coverage at all, and because both properties look
 * completely correct in behaviour right up until they are expensive: the app renders the same
 * either way, just slower and leakier. The canvas source already carries comments asserting both
 * intentions; this is what makes them fail when broken rather than merely read well.
 */
const CANVAS_SOURCE = readFileSync(
  path.join(process.cwd(), "app/components/VehicleCanvas.tsx"),
  "utf8",
);

describe("VehicleCanvas lifecycle ordering", () => {
  it("starts the render loop before awaiting the vehicle model", () => {
    const loopStart = CANVAS_SOURCE.indexOf("\n      loop();");
    const modelAwait = CANVAS_SOURCE.indexOf("await loadVehicleRoot(");

    expect(loopStart, "expected a `loop();` call in VehicleCanvas").toBeGreaterThan(-1);
    expect(modelAwait, "expected an `await loadVehicleRoot(` call in VehicleCanvas").toBeGreaterThan(-1);
    expect(
      loopStart,
      "The render loop must start before the model is awaited, otherwise the whole showroom " +
        "(lights, floor, grid, environment) and the procedural placeholder all wait on geometry " +
        "they do not depend on, and first paint is bounded by the largest asset on the page.",
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

  it("loads running gear after the detailed body resolves", () => {
    const bodyAwait = CANVAS_SOURCE.indexOf("await loadVehicleRoot(");
    const runningGear = CANVAS_SOURCE.indexOf("await installWheelAndTireAssets(");

    expect(runningGear).toBeGreaterThan(-1);
    expect(
      runningGear,
      "Running gear is additive — the body is complete without it, and the `low` quality tier " +
        "skips it entirely. Fetching it before the body resolves puts an optional asset on the " +
        "critical path.",
    ).toBeGreaterThan(bodyAwait);
  });
});

describe("optimized runtime model assets", () => {
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
