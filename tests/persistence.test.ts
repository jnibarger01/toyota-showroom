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

/** Convenience for tests that don't care about the owner token itself. */
async function createSaved() {
  return repo.create(baseInput());
}

beforeEach(() => repo.clear());

describe("create", () => {
  it("returns the canonical saved record plus a plaintext owner token", async () => {
    const { configuration, ownerToken } = await createSaved();

    expect(configuration.configurationId).toMatch(/^cfg_/);
    expect(configuration.vehicleId).toBe("4runner");
    expect(configuration.model).toBe("4Runner");
    expect(configuration.modelYear).toBe(2024);
    expect(configuration.revision).toBe(1);
    expect(configuration.schemaVersion).toBe(CUSTOMIZATION_SCHEMA_VERSION);
    expect(configuration.createdAt).toBe(configuration.updatedAt);
    expect(ownerToken.length).toBeGreaterThan(20);
  });

  it("mints distinct ids and distinct owner tokens", async () => {
    const a = await createSaved();
    const b = await createSaved();
    expect(a.configuration.configurationId).not.toBe(b.configuration.configurationId);
    expect(a.ownerToken).not.toBe(b.ownerToken);
  });
});

describe("read", () => {
  it("round-trips a saved configuration, unauthenticated", async () => {
    const { configuration } = await createSaved();
    const fetched = await repo.get(configuration.configurationId);
    expect(fetched).toEqual(configuration);
  });

  it("returns null for an unknown id", async () => {
    expect(await repo.get("cfg_nope")).toBeNull();
  });
});

describe("update", () => {
  it("bumps the revision and refreshes updatedAt", async () => {
    const { configuration: saved, ownerToken } = await createSaved();
    const patch = validatePatchConfiguration(
      { selections: { paint: ["paint-3u5-barcelona-red"], accessory: ["accessory-roof-rack"] } },
      { vehicleId: saved.vehicleId, gradeId: saved.gradeId },
    );

    const updated = await repo.update(saved.configurationId, patch, ownerToken);

    expect(updated.revision).toBe(2);
    expect(updated.selections.paint).toEqual(["paint-3u5-barcelona-red"]);
    expect(updated.selections.accessory).toEqual(["accessory-roof-rack"]);
    expect(updated.createdAt).toBe(saved.createdAt);
  });

  it("preserves fields the patch omits", async () => {
    const { configuration: saved, ownerToken } = await createSaved();
    const updated = await repo.update(
      saved.configurationId,
      { cameraState: { presetId: "side", position: [10, 2.2, 0], target: [0, 1, 0] } },
      ownerToken,
    );
    expect(updated.selections).toEqual(saved.selections);
    expect(updated.cameraState?.presetId).toBe("side");
  });

  it("rejects a write against a stale revision", async () => {
    const { configuration: saved, ownerToken } = await createSaved();
    await repo.update(saved.configurationId, { selections: { paint: ["paint-1j9-ice-cap"] } }, ownerToken);

    await expect(
      repo.update(
        saved.configurationId,
        { selections: { paint: ["paint-070-midnight-black"] }, expectedRevision: 1 },
        ownerToken,
      ),
    ).rejects.toMatchObject({ status: 409, code: "revision_conflict" });
  });

  it("accepts a write that names the current revision", async () => {
    const { configuration: saved, ownerToken } = await createSaved();
    const updated = await repo.update(
      saved.configurationId,
      { selections: { paint: ["paint-1g3-underground"] }, expectedRevision: 1 },
      ownerToken,
    );
    expect(updated.revision).toBe(2);
  });

  it("throws 404 for an unknown id, before the token is even checked", async () => {
    await expect(repo.update("cfg_nope", {}, "any-token")).rejects.toBeInstanceOf(ApiError);
    await expect(repo.update("cfg_nope", {}, "")).rejects.toMatchObject({ status: 404 });
  });
});

describe("ownership", () => {
  it("rejects a PATCH with no token", async () => {
    const { configuration: saved } = await createSaved();
    await expect(
      repo.update(saved.configurationId, { selections: { paint: ["paint-1j9-ice-cap"] } }, ""),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("rejects a PATCH with the wrong token", async () => {
    const { configuration: saved } = await createSaved();
    const { ownerToken: someoneElsesToken } = await createSaved();

    await expect(
      repo.update(saved.configurationId, { selections: { paint: ["paint-1j9-ice-cap"] } }, someoneElsesToken),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });

    // And the record genuinely wasn't touched.
    expect((await repo.get(saved.configurationId))?.revision).toBe(1);
  });

  it("rejects a DELETE with the wrong token, without deleting the record", async () => {
    const { configuration: saved } = await createSaved();
    const { ownerToken: someoneElsesToken } = await createSaved();

    await expect(repo.delete(saved.configurationId, someoneElsesToken)).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
    expect(await repo.get(saved.configurationId)).not.toBeNull();
  });

  it("accepts a PATCH/DELETE with the correct token", async () => {
    const { configuration: saved, ownerToken } = await createSaved();
    await expect(
      repo.update(saved.configurationId, { selections: { paint: ["paint-1j9-ice-cap"] } }, ownerToken),
    ).resolves.toMatchObject({ revision: 2 });
    await expect(repo.delete(saved.configurationId, ownerToken)).resolves.toBe(true);
  });
});

describe("revision history", () => {
  it("records every accepted mutation", async () => {
    const { configuration: saved, ownerToken } = await createSaved();
    await repo.update(saved.configurationId, { selections: { paint: ["paint-070-midnight-black"] } }, ownerToken);
    await repo.update(saved.configurationId, { selections: { paint: ["paint-1j9-ice-cap"] } }, ownerToken);

    const history = await repo.listRevisions(saved.configurationId);

    expect(history.map((entry) => entry.revision)).toEqual([1, 2, 3]);
    expect(history[0].selections.paint).toEqual(["paint-218-blueprint"]);
    expect(history[2].selections.paint).toEqual(["paint-1j9-ice-cap"]);
  });
});

describe("delete", () => {
  it("removes the record and its history", async () => {
    const { configuration: saved, ownerToken } = await createSaved();
    expect(await repo.delete(saved.configurationId, ownerToken)).toBe(true);
    expect(await repo.get(saved.configurationId)).toBeNull();
    expect(await repo.listRevisions(saved.configurationId)).toEqual([]);
  });

  it("reports false for an unknown id", async () => {
    expect(await repo.delete("cfg_nope", "any-token")).toBe(false);
  });
});
