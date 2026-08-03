import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../lib/api/errors";
import { InMemoryConfigurationRepository } from "../lib/server/configurationRepository";
import { validateCreateConfiguration, validatePatchConfiguration } from "../lib/validation/configuration";
import { CUSTOMIZATION_SCHEMA_VERSION } from "../lib/types/customization";

const repo = new InMemoryConfigurationRepository();

const baseInput = () =>
  validateCreateConfiguration({
    vehicleId: "4runner",
    modelYear: 2024,
    gradeId: "trd-pro",
    selections: { paint: ["paint-218-blueprint"] },
  });

beforeEach(() => repo.clear());

describe("create", () => {
  it("returns the canonical saved record", async () => {
    const saved = await repo.create(baseInput());

    expect(saved.configurationId).toMatch(/^cfg_/);
    expect(saved.vehicleId).toBe("4runner");
    expect(saved.model).toBe("4Runner");
    expect(saved.modelYear).toBe(2024);
    expect(saved.revision).toBe(1);
    expect(saved.schemaVersion).toBe(CUSTOMIZATION_SCHEMA_VERSION);
    expect(saved.createdAt).toBe(saved.updatedAt);
  });

  it("mints distinct ids", async () => {
    const a = await repo.create(baseInput());
    const b = await repo.create(baseInput());
    expect(a.configurationId).not.toBe(b.configurationId);
  });
});

describe("read", () => {
  it("round-trips a saved configuration", async () => {
    const saved = await repo.create(baseInput());
    const fetched = await repo.get(saved.configurationId);
    expect(fetched).toEqual(saved);
  });

  it("returns null for an unknown id", async () => {
    expect(await repo.get("cfg_nope")).toBeNull();
  });
});

describe("update", () => {
  it("bumps the revision and refreshes updatedAt", async () => {
    const saved = await repo.create(baseInput());
    const patch = validatePatchConfiguration(
      { selections: { paint: ["paint-3u5-barcelona-red"], accessory: ["accessory-roof-rack"] } },
      { vehicleId: saved.vehicleId, gradeId: saved.gradeId },
    );

    const updated = await repo.update(saved.configurationId, patch);

    expect(updated.revision).toBe(2);
    expect(updated.selections.paint).toEqual(["paint-3u5-barcelona-red"]);
    expect(updated.selections.accessory).toEqual(["accessory-roof-rack"]);
    expect(updated.createdAt).toBe(saved.createdAt);
  });

  it("preserves fields the patch omits", async () => {
    const saved = await repo.create(baseInput());
    const updated = await repo.update(saved.configurationId, {
      cameraState: { presetId: "side", position: [10, 2.2, 0], target: [0, 1, 0] },
    });
    expect(updated.selections).toEqual(saved.selections);
    expect(updated.cameraState?.presetId).toBe("side");
  });

  it("rejects a write against a stale revision", async () => {
    const saved = await repo.create(baseInput());
    await repo.update(saved.configurationId, { selections: { paint: ["paint-1j9-ice-cap"] } });

    await expect(
      repo.update(saved.configurationId, {
        selections: { paint: ["paint-070-midnight-black"] },
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ status: 409, code: "revision_conflict" });
  });

  it("accepts a write that names the current revision", async () => {
    const saved = await repo.create(baseInput());
    const updated = await repo.update(saved.configurationId, {
      selections: { paint: ["paint-1g3-underground"] },
      expectedRevision: 1,
    });
    expect(updated.revision).toBe(2);
  });

  it("throws 404 for an unknown id", async () => {
    await expect(repo.update("cfg_nope", {})).rejects.toBeInstanceOf(ApiError);
  });
});

describe("revision history", () => {
  it("records every accepted mutation", async () => {
    const saved = await repo.create(baseInput());
    await repo.update(saved.configurationId, { selections: { paint: ["paint-070-midnight-black"] } });
    await repo.update(saved.configurationId, { selections: { paint: ["paint-1j9-ice-cap"] } });

    const history = await repo.listRevisions(saved.configurationId);

    expect(history.map((entry) => entry.revision)).toEqual([1, 2, 3]);
    expect(history[0].selections.paint).toEqual(["paint-218-blueprint"]);
    expect(history[2].selections.paint).toEqual(["paint-1j9-ice-cap"]);
  });
});

describe("delete", () => {
  it("removes the record and its history", async () => {
    const saved = await repo.create(baseInput());
    expect(await repo.delete(saved.configurationId)).toBe(true);
    expect(await repo.get(saved.configurationId)).toBeNull();
    expect(await repo.listRevisions(saved.configurationId)).toEqual([]);
  });

  it("reports false for an unknown id", async () => {
    expect(await repo.delete("cfg_nope")).toBe(false);
  });
});
