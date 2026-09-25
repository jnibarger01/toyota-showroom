import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createVehicleFixture } from "./fixtures/scene";
import { VehicleSceneController } from "../lib/three/sceneController";
import { verifyNodeContract } from "../lib/three/nodes";
import { fourRunnerOptions } from "../lib/data/options/4runner";
import { InMemoryConfigurationRepository } from "../lib/server/configurationRepository";
import { validateCreateConfiguration, validatePatchConfiguration } from "../lib/validation/configuration";

/**
 * Paint hover/focus preview (`configurationStore.previewOption`): the vehicle shows a paint the
 * viewer is pointing at, and the real selection comes back when they move away — without the
 * preview ever reaching configuration state, persistence, or price. Setup mirrors
 * storeConcurrency.test.ts (same in-memory repository and mocked transport).
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
    return repo.update(id, validatePatchConfiguration(patch, { vehicleId: existing.vehicleId, gradeId: existing.gradeId, selections: existing.selections }), ownerTokens.get(id) ?? "");
  },
  async deleteConfiguration(id: string) {
    await repo.delete(id, ownerTokens.get(id) ?? "");
  },
  async listVehicleOptions() {
    return fourRunnerOptions;
  },
  // Local mode: conflict UX must not activate — historic rollback path stays covered here.
  getPersistenceMode: () => "local" as const,
}));

const { configurationStore } = await import("../lib/state/configurationStore");


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


function paintColor(root: THREE.Object3D): string {
  let hex = "";
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material.name === "body.carmain") hex = `#${(material as THREE.MeshStandardMaterial).color.getHexString()}`;
    }
  });
  return hex;
}

describe("paint preview", () => {
  it("shows the hovered paint and restores the selected one, without touching state", async () => {
    const { fixture, catalog } = await attach();
    const blue = catalog.find((option) => option.id === "paint-218-blueprint")!;
    const red = catalog.find((option) => option.id === "paint-3u5-barcelona-red")!;
    await configurationStore.selectOption(blue);
    const selectedHex = paintColor(fixture.root);
    const before = configurationStore.getSnapshot().configuration;

    await configurationStore.previewOption(red);
    expect(paintColor(fixture.root)).toBe(red.materialConfig!.color!.toLowerCase());
    expect(configurationStore.getSnapshot().configuration).toBe(before);

    await configurationStore.previewOption(null);
    expect(paintColor(fixture.root)).toBe(selectedHex);
    expect(configurationStore.getSnapshot().configuration?.selections.paint).toEqual([blue.id]);
  });

  it("lets a click on the previewed swatch win over the preview's restore", async () => {
    const { fixture, catalog } = await attach();
    const red = catalog.find((option) => option.id === "paint-3u5-barcelona-red")!;
    void configurationStore.previewOption(red);
    await configurationStore.selectOption(red);
    await configurationStore.previewOption(null); // the pointer leaving after the click
    expect(paintColor(fixture.root)).toBe(red.materialConfig!.color!.toLowerCase());
    expect(configurationStore.getSnapshot().configuration?.selections.paint).toEqual([red.id]);
  });

  it("never previews anything but paint", async () => {
    const { catalog, controller } = await attach();
    const applySpy = vi.spyOn(controller, "applyOption");
    const notPaint = catalog.find((option) => option.category !== "paint")!;
    await configurationStore.previewOption(notPaint);
    expect(applySpy).not.toHaveBeenCalled();
  });
});
