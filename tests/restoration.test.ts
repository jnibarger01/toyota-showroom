import { beforeEach, describe, expect, it, vi } from "vitest";
import { colorHexAt, createVehicleFixture } from "./fixtures/scene";
import { VehicleSceneController } from "../lib/three/sceneController";
import { verifyNodeContract } from "../lib/three/nodes";
import { fourRunnerOptions } from "../lib/data/options/4runner";
import { InMemoryConfigurationRepository } from "../lib/server/configurationRepository";
import { validateCreateConfiguration, validatePatchConfiguration } from "../lib/validation/configuration";
import type { VehicleConfiguration } from "../lib/types/customization";

/**
 * `lib/api/configurations` is the only network boundary the store touches, so stubbing it here is
 * enough to drive the store deterministically. The stub is backed by the real in-memory repository
 * and the real validators, so these tests exercise the actual persistence and validation paths —
 * only the HTTP hop is replaced.
 */
const repo = new InMemoryConfigurationRepository();
const failNextUpdate = { value: false };

vi.mock("../lib/api/configurations", async () => {
  const { InMemoryConfigurationRepository: Repo } = await import("../lib/server/configurationRepository");
  void Repo;
  return {
    async createConfiguration(input: unknown) {
      const { validateCreateConfiguration: validate } = await import("../lib/validation/configuration");
      return repo.create(validate(input));
    },
    async getConfiguration(id: string) {
      const record = await repo.get(id);
      if (!record) throw new Error(`No configuration found with id "${id}".`);
      return record;
    },
    async updateConfiguration(id: string, patch: Record<string, unknown>) {
      if (failNextUpdate.value) {
        failNextUpdate.value = false;
        throw new Error("Simulated network failure.");
      }
      const existing = await repo.get(id);
      if (!existing) throw new Error("missing");
      const { validatePatchConfiguration: validate } = await import("../lib/validation/configuration");
      return repo.update(id, validate(patch, existing));
    },
    async deleteConfiguration(id: string) {
      await repo.delete(id);
    },
    async listVehicleOptions() {
      return fourRunnerOptions;
    },
  };
});

const { configurationStore } = await import("../lib/state/configurationStore");

function freshScene() {
  const fixture = createVehicleFixture();
  const { satisfied } = verifyNodeContract(fixture.root, fourRunnerOptions);
  return { fixture, controller: new VehicleSceneController(fixture.root, satisfied), catalog: satisfied };
}

async function seedConfiguration(): Promise<VehicleConfiguration> {
  return repo.create(
    validateCreateConfiguration({
      vehicleId: "4runner",
      modelYear: 2024,
      gradeId: "trd-pro",
    }),
  );
}

beforeEach(() => {
  repo.clear();
  failNextUpdate.value = false;
  configurationStore.reset();
});

describe("selection → state → scene → persistence", () => {
  it("updates state, scene, and the stored record from one call", async () => {
    const { fixture, controller, catalog } = freshScene();
    const configuration = await seedConfiguration();
    await configurationStore.attachScene(controller, configuration, catalog);

    const red = catalog.find((option) => option.id === "paint-3u5-barcelona-red")!;
    await configurationStore.selectOption(red);

    // Scene and local state respond before the write completes.
    expect(colorHexAt(fixture.root, "BODY", "body.carmain")).toBe("9d1d20");
    expect(configurationStore.getSnapshot().configuration?.selections.paint).toEqual([red.id]);

    await configurationStore.flush();

    const stored = await repo.get(configuration.configurationId);
    expect(stored?.selections.paint).toEqual([red.id]);
    expect(stored?.revision).toBe(2);
    expect(configurationStore.getSnapshot().status).toBe("saved");
  });

  it("coalesces a burst of selections into a single write", async () => {
    const { controller, catalog } = freshScene();
    const configuration = await seedConfiguration();
    await configurationStore.attachScene(controller, configuration, catalog);

    for (const id of ["paint-218-blueprint", "paint-070-midnight-black", "paint-1j9-ice-cap"]) {
      await configurationStore.selectOption(catalog.find((option) => option.id === id)!);
    }
    await configurationStore.flush();

    const stored = await repo.get(configuration.configurationId);
    // Three clicks, one revision bump, and the final choice wins.
    expect(stored?.revision).toBe(2);
    expect(stored?.selections.paint).toEqual(["paint-1j9-ice-cap"]);
  });

  it("toggles an accumulating category on and off", async () => {
    const { fixture, controller, catalog } = freshScene();
    const configuration = await seedConfiguration();
    await configurationStore.attachScene(controller, configuration, catalog);

    const rack = catalog.find((option) => option.id === "accessory-roof-rack")!;
    await configurationStore.selectOption(rack);
    expect(fixture.root.getObjectByName("ACCESSORY_ROOF_RACK")!.visible).toBe(true);

    await configurationStore.selectOption(rack);
    expect(fixture.root.getObjectByName("ACCESSORY_ROOF_RACK")!.visible).toBe(false);

    await configurationStore.flush();
    expect((await repo.get(configuration.configurationId))?.selections.accessory).toEqual([]);
  });
});

describe("failure handling", () => {
  it("restores the previous state and scene when the write is rejected", async () => {
    const { fixture, controller, catalog } = freshScene();
    const configuration = await seedConfiguration();
    await configurationStore.attachScene(controller, configuration, catalog);

    const blue = catalog.find((option) => option.id === "paint-218-blueprint")!;
    await configurationStore.selectOption(blue);
    await configurationStore.flush();
    expect(colorHexAt(fixture.root, "BODY", "body.carmain")).toBe("1558d6");

    failNextUpdate.value = true;
    const red = catalog.find((option) => option.id === "paint-3u5-barcelona-red")!;
    await configurationStore.selectOption(red);
    expect(colorHexAt(fixture.root, "BODY", "body.carmain")).toBe("9d1d20"); // optimistic

    await configurationStore.flush();

    const state = configurationStore.getSnapshot();
    expect(state.status).toBe("error");
    expect(state.error).toMatch(/Simulated network failure/);
    // Both the state and the viewport are back on the last server-confirmed selection.
    expect(state.configuration?.selections.paint).toEqual([blue.id]);
    expect(colorHexAt(fixture.root, "BODY", "body.carmain")).toBe("1558d6");
  });

  it("clears the error once acknowledged", async () => {
    const { controller, catalog } = freshScene();
    await configurationStore.attachScene(controller, await seedConfiguration(), catalog);

    failNextUpdate.value = true;
    await configurationStore.selectOption(catalog.find((o) => o.id === "paint-1g3-underground")!);
    await configurationStore.flush();
    expect(configurationStore.getSnapshot().status).toBe("error");

    configurationStore.clearError();
    expect(configurationStore.getSnapshot().status).toBe("idle");
    expect(configurationStore.getSnapshot().error).toBeNull();
  });

  it("leaves no pending markers behind after a failure", async () => {
    const { controller, catalog } = freshScene();
    await configurationStore.attachScene(controller, await seedConfiguration(), catalog);

    failNextUpdate.value = true;
    await configurationStore.selectOption(catalog.find((o) => o.id === "trim-grille-chrome")!);
    await configurationStore.flush();

    expect(configurationStore.getSnapshot().pending.size).toBe(0);
  });
});

describe("restoration after a reload", () => {
  it("reproduces the saved build in a freshly loaded scene", async () => {
    // ---- session one: build and save
    const first = freshScene();
    const configuration = await seedConfiguration();
    await configurationStore.attachScene(first.controller, configuration, first.catalog);

    for (const id of ["paint-0r2-solar-octane", "wheels-weisu-bronze", "accessory-rock-sliders"]) {
      await configurationStore.selectOption(first.catalog.find((option) => option.id === id)!);
    }
    await configurationStore.flush();
    const savedId = configurationStore.getSnapshot().configuration!.configurationId;

    // ---- the browser is refreshed: new store state, new GLB, new controller
    configurationStore.reset();
    const second = freshScene();
    const reloaded = await repo.get(savedId);
    expect(reloaded).not.toBeNull();

    await configurationStore.attachScene(second.controller, reloaded!, second.catalog);

    expect(colorHexAt(second.fixture.root, "BODY", "body.carmain")).toBe("ff6a1a");
    expect(colorHexAt(second.fixture.root, "PLACED_WEISU_front_left", "wheel.metal")).toBe("8c6239");
    expect(second.fixture.root.getObjectByName("ACCESSORY_ROCK_SLIDERS")!.visible).toBe(true);
    expect(second.fixture.root.getObjectByName("ACCESSORY_ROOF_RACK")!.visible).toBe(false);
    expect(configurationStore.getSnapshot().status).toBe("idle");
  });

  it("surfaces an error when a saved option cannot be applied to the current asset", async () => {
    // A configuration saved before an asset regression: the option is still valid server-side but
    // the loaded GLB no longer carries its node.
    const configuration = await repo.create(
      validateCreateConfiguration({
        vehicleId: "4runner",
        modelYear: 2024,
        gradeId: "trd-pro",
        selections: { hood: ["hood-sport-scoop"] },
      }),
    );

    const { controller } = freshScene();
    // Hand the controller the full catalog so the option resolves but its nodes do not.
    const permissive = new VehicleSceneController(controller.root, fourRunnerOptions);
    await configurationStore.attachScene(permissive, configuration, fourRunnerOptions);

    const state = configurationStore.getSnapshot();
    expect(state.status).toBe("error");
    expect(state.error).toMatch(/hood-sport-scoop/);
  });

  it("keeps the stored record authoritative over local state", async () => {
    const { controller, catalog } = freshScene();
    const configuration = await seedConfiguration();
    await configurationStore.attachScene(controller, configuration, catalog);

    await configurationStore.selectOption(catalog.find((o) => o.id === "paint-218-blueprint")!);
    await configurationStore.flush();

    const stored = await repo.get(configuration.configurationId);
    const local = configurationStore.getSnapshot().configuration;
    expect(local).toEqual(stored);
  });
});

describe("patch validation reaches the store", () => {
  it("rolls back when the server rejects the selection", async () => {
    const { fixture, controller, catalog } = freshScene();
    // Grade sr5 does not offer Solar Octane, so the PATCH is rejected by the real validator.
    const configuration = await repo.create(
      validateCreateConfiguration({ vehicleId: "4runner", modelYear: 2024, gradeId: "sr5" }),
    );
    await configurationStore.attachScene(controller, configuration, fourRunnerOptions);
    void catalog;

    await configurationStore.selectOption(
      fourRunnerOptions.find((option) => option.id === "paint-0r2-solar-octane")!,
    );
    await configurationStore.flush();

    const state = configurationStore.getSnapshot();
    expect(state.status).toBe("error");
    expect(state.error).toMatch(/not available on grade "sr5"/);
    expect(state.configuration?.selections.paint ?? []).toEqual([]);
    expect(colorHexAt(fixture.root, "BODY", "body.carmain")).toBe("1558d6");
  });
});
