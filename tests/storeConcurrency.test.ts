import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVehicleFixture } from "./fixtures/scene";
import { VehicleSceneController } from "../lib/three/sceneController";
import { verifyNodeContract } from "../lib/three/nodes";
import { fourRunnerOptions, plannedFourRunnerOptions } from "../lib/data/options/4runner";
import { getOptionById } from "../lib/data/options";
import { InMemoryConfigurationRepository } from "../lib/server/configurationRepository";
import { validateCreateConfiguration, validatePatchConfiguration } from "../lib/validation/configuration";

/**
 * Concurrency and failure-path behaviour of the store: what happens when a user keeps clicking
 * while a write is in flight, and what must *not* happen after the scene rejects a selection.
 */

const repo = new InMemoryConfigurationRepository();

/** Lets a test hold a PATCH open until it chooses to release it. */
let gate: { release: () => void; opened: Promise<void> } | null = null;
let updateCalls = 0;

/**
 * Mirrors the real `lib/api/configurations.ts`'s owner-token bookkeeping (there: localStorage;
 * here: a plain Map). Both the mock's `createConfiguration` and the `attach()` helper's direct
 * `repo.create(...)` call must register their token here, or the mocked `updateConfiguration`
 * would present an empty token and every write in this file would 403.
 */
const ownerTokens = new Map<string, string>();

function openGate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  gate = { release, opened };
  return gate;
}

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
    updateCalls++;
    if (gate) await gate.opened;
    const existing = await repo.get(id);
    if (!existing) throw new Error("missing");
    return repo.update(id, validatePatchConfiguration(patch, existing), ownerTokens.get(id) ?? "");
  },
  async deleteConfiguration(id: string) {
    await repo.delete(id, ownerTokens.get(id) ?? "");
  },
  async listVehicleOptions() {
    return fourRunnerOptions;
  },
}));

const { configurationStore } = await import("../lib/state/configurationStore");

const plannedHood = plannedFourRunnerOptions.find((option) => option.id === "hood-sport-scoop")!;

function freshScene(catalog = fourRunnerOptions) {
  const fixture = createVehicleFixture();
  const { satisfied } = verifyNodeContract(fixture.root, catalog);
  return { fixture, controller: new VehicleSceneController(fixture.root, satisfied), catalog: satisfied };
}

async function attach(catalog = fourRunnerOptions) {
  const scene = freshScene(catalog);
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
  gate = null;
  updateCalls = 0;
  configurationStore.reset();
});

describe("edits made while a write is in flight", () => {
  it("does not discard the later selection when the response lands", async () => {
    const { catalog } = await attach();
    const blue = catalog.find((option) => option.id === "paint-218-blueprint")!;
    const red = catalog.find((option) => option.id === "paint-3u5-barcelona-red")!;

    await configurationStore.selectOption(blue);

    // Hold the PATCH open, start it, then make a second choice before it resolves.
    const held = openGate();
    const inFlight = configurationStore.flush();
    await configurationStore.selectOption(red);
    held.release();
    await inFlight;

    // The server's reply described the blue snapshot; adopting it wholesale would have thrown away
    // the red selection the user can already see in the viewport. The flush loop instead keeps the
    // newer selection and re-sends it, so the state settles on red rather than reverting to blue.
    expect(configurationStore.getSnapshot().configuration?.selections.paint).toEqual([red.id]);
  });

  it("persists the later selection on the following flush", async () => {
    const { configuration, catalog } = await attach();
    const blue = catalog.find((option) => option.id === "paint-218-blueprint")!;
    const red = catalog.find((option) => option.id === "paint-3u5-barcelona-red")!;

    await configurationStore.selectOption(blue);
    const held = openGate();
    const inFlight = configurationStore.flush();
    await configurationStore.selectOption(red);
    held.release();
    await inFlight;

    gate = null;
    await configurationStore.flush();

    expect((await repo.get(configuration.configurationId))?.selections.paint).toEqual([red.id]);
    expect(configurationStore.getSnapshot().status).toBe("saved");
  });

  it("still adopts the server record when nothing changed during the write", async () => {
    const { catalog } = await attach();
    await configurationStore.selectOption(catalog.find((o) => o.id === "paint-1j9-ice-cap")!);
    await configurationStore.flush();

    const state = configurationStore.getSnapshot();
    expect(state.status).toBe("saved");
    expect(state.configuration?.revision).toBe(2);
  });
});

describe("after the scene rejects a selection", () => {
  it("does not persist the rolled-back state or clear the error", async () => {
    // The permissive catalog contains hood options the fixture cannot satisfy, so applying one
    // fails in the scene and triggers a rollback.
    const { configuration } = await attach();
    configurationStore.reset();

    const scene = freshScene();
    const permissiveCatalog = [...fourRunnerOptions, ...plannedFourRunnerOptions];
    const permissive = new VehicleSceneController(scene.fixture.root, permissiveCatalog);
    const stored = (await repo.get(configuration.configurationId))!;
    await configurationStore.attachScene(permissive, stored, permissiveCatalog);

    const callsBefore = updateCalls;
    await configurationStore.selectOption(plannedHood);
    await configurationStore.flush();

    // No PATCH was issued, the revision is untouched, and the failure is still on screen.
    expect(updateCalls).toBe(callsBefore);
    expect(configurationStore.getSnapshot().status).toBe("error");
    expect(configurationStore.getSnapshot().error).toMatch(/could not be applied/);
    expect((await repo.get(configuration.configurationId))?.revision).toBe(1);
  });

  it("leaves no pending marker for the rejected option", async () => {
    const { configuration } = await attach();
    configurationStore.reset();

    const scene = freshScene();
    const permissiveCatalog = [...fourRunnerOptions, ...plannedFourRunnerOptions];
    const permissive = new VehicleSceneController(scene.fixture.root, permissiveCatalog);
    const stored = (await repo.get(configuration.configurationId))!;
    await configurationStore.attachScene(permissive, stored, permissiveCatalog);

    await configurationStore.selectOption(plannedHood);

    expect(configurationStore.getSnapshot().pending.size).toBe(0);
  });
});
