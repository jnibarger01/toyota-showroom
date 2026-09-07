import { describe, expect, it } from "vitest";
import { collectPipelineMetrics, EXPECTED_UNSATISFIED } from "../scripts/asset-pipeline-report";

/**
 * CI-enforced version of `node scripts/asset-pipeline-report.ts --fail-on-contract-violation`:
 * the real committed GLBs, read and checked against the real scene maps, exactly like the script
 * a maintainer would run by hand — except this runs on every `vitest run`, so a re-exported asset
 * that silently drops a node a `SceneMapEntry` depends on fails CI instead of only failing the
 * first time someone remembers to run the standalone script (or, worse, only failing at runtime
 * for whoever's browser loads it first).
 */
describe("asset pipeline: semantic contract holds for every shipped GLB", () => {
  it("every scene-map-checked asset has no unexpected unsatisfied entries", async () => {
    const metrics = await collectPipelineMetrics();
    const checked = metrics.filter((m) => m.checkedSceneMap);
    expect(checked.length).toBeGreaterThan(0); // sanity: the pipeline actually found assets to check

    for (const asset of checked) {
      expect(asset.unexpectedContractViolations, `${asset.label}: unexpected semantic contract violations`).toEqual([]);
    }
  });

  it("every asset still ships geometry compression", async () => {
    const metrics = await collectPipelineMetrics();
    for (const asset of metrics) {
      expect(asset.compressionMode, `${asset.label} shipped uncompressed`).not.toBe("none");
    }
  });

  it("EXPECTED_UNSATISFIED stays in sync with what the 4Runner scene map actually declares as unsatisfied", async () => {
    const metrics = await collectPipelineMetrics();
    const body = metrics.find((m) => m.label === "4Runner body");
    expect(body).toBeDefined();
    // Every entry EXPECTED_UNSATISFIED documents for 4runner should genuinely be unsatisfied —
    // if a future asset export adds real door/mirror/badge/roof/interior geometry, this fails
    // loudly instead of leaving a stale "expected gap" masking a now-real capability.
    const actuallyUnsatisfied = new Set(body!.semanticContract.unsatisfied.map((u) => u.id));
    for (const id of EXPECTED_UNSATISFIED["4runner"]!) {
      expect(actuallyUnsatisfied.has(id), `"${id}" is documented as expected-unsatisfied but is now satisfied`).toBe(true);
    }
  });
});
