import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVehicleFixture } from "./fixtures/scene";
import { VehicleSceneController } from "../lib/three/sceneController";
import { verifyNodeContract } from "../lib/three/nodes";
import { fourRunnerOptions } from "../lib/data/options/4runner";
import { InMemoryConfigurationRepository } from "../lib/server/configurationRepository";
import { validateCreateConfiguration, validatePatchConfiguration } from "../lib/validation/configuration";
import { ApiError } from "../lib/api/errors";
import { SAVE_FAILURE_COPY } from "../lib/api/saveFailure";

/**
 * Worker-mode stale-revision conflict UX (#52): keep local edits, offer reload / overwrite / fork.
 * Local-mode behaviour stays covered by storeConcurrency + restoration (rollback + distinct copy).
 */

const repo = new InMemoryConfigurationRepository();
const ownerTokens = new Map<string, string>();

let persistenceMode: "worker" | "local" = "worker";
/** When set, the next update throws this error instead of hitting the repo. */
let nextUpdateError: ApiError | null = null;
let lastUpdatePatch: Record<string, unknown> | null = null;

vi.mock("../lib/api/configurations", () => ({
  async createConfiguration(input: unknown) {
    const { configuration, ownerToken } = await repo.create(validateCreateConfiguration(input));
    ownerTokens.set(configuration.configurationId, ownerToken);
    return configuration;
  },
  async getConfiguration(id: string) {
    const record = await repo.get(id);
    if (!record) throw new Error("missing");
    return record;
  },
  async updateConfiguration(id: string, patch: Record<string, unknown>) {
    lastUpdatePatch = patch;
    if (nextUpdateError) {
      const err = nextUpdateError;
      nextUpdateError = null;
      throw err;
    }
    const existing = await repo.get(id);
    if (!existing) throw new Error("missing");
    return repo.update(
      id,
      validatePatchConfiguration(patch, {
        vehicleId: existing.vehicleId,
        gradeId: existing.gradeId,
        selections: existing.selections,
      }),
      ownerTokens.get(id) ?? "",
    );
  },
  async deleteConfiguration(id: string) {
    await repo.delete(id, ownerTokens.get(id) ?? "");
  },
  async listVehicleOptions() {
    return fourRunnerOptions;
  },
  getPersistenceMode: () => persistenceMode,
}));

const { configurationStore } = await import("../lib/state/configurationStore");

function freshScene() {
  const fixture = createVehicleFixture();
  const { satisfied } = verifyNodeContract(fixture.root, fourRunnerOptions);
  return {
    fixture,
    controller: new VehicleSceneController(fixture.root, satisfied),
    catalog: satisfied,
  };
}

async function attach() {
  const scene = freshScene();
  const { configuration, ownerToken } = await repo.create(
    validateCreateConfiguration({ vehicleId: "4runner", modelYear: 2024, gradeId: "trd-pro" }),
  );
  ownerTokens.set(configuration.configurationId, ownerToken);
  await configurationStore.attachScene(scene.controller, configuration, scene.catalog);
  return { ...scene, configuration };
}

beforeEach(() => {
  repo.clear();
  ownerTokens.clear();
  persistenceMode = "worker";
  nextUpdateError = null;
  lastUpdatePatch = null;
  configurationStore.reset();
});

describe("Worker mode revision conflict", () => {
  it("keeps local edits and surfaces conflict copy (not the raw API message)", async () => {
    const { catalog, configuration } = await attach();
    const blue = catalog.find((o) => o.id === "paint-218-blueprint")!;
    await configurationStore.selectOption(blue);
    await configurationStore.flush();

    // Simulate another client advancing the server revision underneath us.
    const token = ownerTokens.get(configuration.configurationId)!;
    await repo.update(
      configuration.configurationId,
      validatePatchConfiguration(
        { selections: { paint: ["paint-1j9-ice-cap"] }, expectedRevision: 2 },
        { vehicleId: "4runner", gradeId: "trd-pro", selections: { paint: [blue.id] } },
      ),
      token,
    );

    const red = catalog.find((o) => o.id === "paint-3u5-barcelona-red")!;
    await configurationStore.selectOption(red);
    await configurationStore.flush();

    const state = configurationStore.getSnapshot();
    expect(state.status).toBe("error");
    expect(state.saveFailure).toBe("conflict");
    expect(state.error).toBe(SAVE_FAILURE_COPY.conflict);
    // Local edits retained — not rolled back to lastPersisted blue.
    expect(state.configuration?.selections.paint).toEqual([red.id]);
    expect(configurationStore.hasRevisionConflict()).toBe(true);
  });

  it("reloadServerRevision replaces the builder with the server copy", async () => {
    const { catalog, configuration } = await attach();
    const blue = catalog.find((o) => o.id === "paint-218-blueprint")!;
    await configurationStore.selectOption(blue);
    await configurationStore.flush();

    const token = ownerTokens.get(configuration.configurationId)!;
    await repo.update(
      configuration.configurationId,
      validatePatchConfiguration(
        { selections: { paint: ["paint-1j9-ice-cap"] }, expectedRevision: 2 },
        { vehicleId: "4runner", gradeId: "trd-pro", selections: { paint: [blue.id] } },
      ),
      token,
    );

    const red = catalog.find((o) => o.id === "paint-3u5-barcelona-red")!;
    await configurationStore.selectOption(red);
    await configurationStore.flush();
    expect(configurationStore.hasRevisionConflict()).toBe(true);

    await configurationStore.reloadServerRevision();

    const state = configurationStore.getSnapshot();
    expect(state.status).toBe("idle");
    expect(state.saveFailure).toBeNull();
    expect(state.error).toBeNull();
    expect(state.configuration?.selections.paint).toEqual(["paint-1j9-ice-cap"]);
    expect(state.configuration?.revision).toBe(3);
    expect(configurationStore.hasRevisionConflict()).toBe(false);
  });

  it("forceOverwrite omits expectedRevision and lands the local draft", async () => {
    const { catalog, configuration } = await attach();
    const blue = catalog.find((o) => o.id === "paint-218-blueprint")!;
    await configurationStore.selectOption(blue);
    await configurationStore.flush();

    const token = ownerTokens.get(configuration.configurationId)!;
    await repo.update(
      configuration.configurationId,
      validatePatchConfiguration(
        { selections: { paint: ["paint-1j9-ice-cap"] }, expectedRevision: 2 },
        { vehicleId: "4runner", gradeId: "trd-pro", selections: { paint: [blue.id] } },
      ),
      token,
    );

    const red = catalog.find((o) => o.id === "paint-3u5-barcelona-red")!;
    await configurationStore.selectOption(red);
    await configurationStore.flush();

    await configurationStore.forceOverwrite();

    expect(lastUpdatePatch).not.toBeNull();
    expect(lastUpdatePatch).not.toHaveProperty("expectedRevision");

    const state = configurationStore.getSnapshot();
    expect(state.status).toBe("saved");
    expect(state.configuration?.selections.paint).toEqual([red.id]);
    expect((await repo.get(configuration.configurationId))?.selections.paint).toEqual([red.id]);
  });

  it("forkLocalDraft creates a new configuration id with the local edits", async () => {
    const { catalog, configuration } = await attach();
    const blue = catalog.find((o) => o.id === "paint-218-blueprint")!;
    await configurationStore.selectOption(blue);
    await configurationStore.flush();

    const token = ownerTokens.get(configuration.configurationId)!;
    await repo.update(
      configuration.configurationId,
      validatePatchConfiguration(
        { selections: { paint: ["paint-1j9-ice-cap"] }, expectedRevision: 2 },
        { vehicleId: "4runner", gradeId: "trd-pro", selections: { paint: [blue.id] } },
      ),
      token,
    );

    const red = catalog.find((o) => o.id === "paint-3u5-barcelona-red")!;
    await configurationStore.selectOption(red);
    await configurationStore.flush();

    const fresh = await configurationStore.forkLocalDraft();
    expect(fresh).not.toBeNull();
    expect(fresh!.configurationId).not.toBe(configuration.configurationId);
    expect(fresh!.selections.paint).toEqual([red.id]);

    // Original server revision left on ice-cap — fork did not overwrite it.
    expect((await repo.get(configuration.configurationId))?.selections.paint).toEqual([
      "paint-1j9-ice-cap",
    ]);

    const state = configurationStore.getSnapshot();
    expect(state.configuration?.configurationId).toBe(fresh!.configurationId);
    expect(state.status).toBe("saved");
    expect(state.saveFailure).toBeNull();
  });
});

describe("local mode leaves conflict UX inactive", () => {
  it("rolls back on revision_conflict instead of entering conflict recovery", async () => {
    persistenceMode = "local";
    const { catalog } = await attach();
    const blue = catalog.find((o) => o.id === "paint-218-blueprint")!;
    await configurationStore.selectOption(blue);
    await configurationStore.flush();

    nextUpdateError = new ApiError(
      409,
      "revision_conflict",
      'Configuration "x" is at revision 9, not 2. Reload before retrying.',
    );

    const red = catalog.find((o) => o.id === "paint-3u5-barcelona-red")!;
    await configurationStore.selectOption(red);
    await configurationStore.flush();

    const state = configurationStore.getSnapshot();
    expect(state.status).toBe("error");
    expect(state.saveFailure).toBe("conflict");
    expect(state.error).toBe(SAVE_FAILURE_COPY.conflict);
    // Rolled back to last persisted (blue), not kept as a recoverable draft.
    expect(state.configuration?.selections.paint).toEqual([blue.id]);
    expect(configurationStore.hasRevisionConflict()).toBe(false);
  });
});
