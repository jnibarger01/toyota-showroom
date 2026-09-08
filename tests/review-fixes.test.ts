import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { colorHexAt, createVehicleFixture, materialAt } from "./fixtures/scene";
import { VehicleSceneController } from "../lib/three/sceneController";
import { verifyNodeContract } from "../lib/three/nodes";
import { fourRunnerOptions } from "../lib/data/options/4runner";
import { getOptionById } from "../lib/data/options";
import { validateSelections } from "../lib/validation/configuration";
import { withOptionSelected, type CustomizationOption } from "../lib/types/customization";
import { ApiError } from "../lib/api/errors";

/**
 * Regression coverage for the issues raised in review of PR #2. Each block names the behaviour it
 * locks in, so a future refactor that reintroduces one of these fails here rather than in a
 * browser.
 */

// ─────────────────────────────────────────────── selection groups within a category

describe("selection groups", () => {
  const grilleBlackout = getOptionById("4runner", "trim-grille-blackout")!;
  const grilleChrome = getOptionById("4runner", "trim-grille-chrome")!;
  const tyreWhite = getOptionById("4runner", "trim-tire-letters-raised-white")!;
  const tyreBlack = getOptionById("4runner", "trim-tire-letters-blackwall")!;

  it("keeps independent groups filed under one category", () => {
    let selections = withOptionSelected({}, tyreWhite, fourRunnerOptions);
    selections = withOptionSelected(selections, grilleBlackout, fourRunnerOptions);

    // Choosing a grille must not evict the tyre lettering, which is separately configurable.
    expect(selections.trim).toContain(tyreWhite.id);
    expect(selections.trim).toContain(grilleBlackout.id);
  });

  it("still evicts the previous choice within the same group", () => {
    let selections = withOptionSelected({}, grilleBlackout, fourRunnerOptions);
    selections = withOptionSelected(selections, grilleChrome, fourRunnerOptions);

    expect(selections.trim).toEqual([grilleChrome.id]);
  });

  it("evicts per group independently", () => {
    let selections = withOptionSelected({}, tyreWhite, fourRunnerOptions);
    selections = withOptionSelected(selections, grilleBlackout, fourRunnerOptions);
    selections = withOptionSelected(selections, tyreBlack, fourRunnerOptions);

    expect(selections.trim).toEqual([grilleBlackout.id, tyreBlack.id]);
  });

  it("is accepted by the server when the groups differ", () => {
    const selections = validateSelections("4runner", "sr5", {
      trim: [grilleBlackout.id, tyreWhite.id],
    });
    expect(selections.trim).toHaveLength(2);
  });

  it("is rejected by the server when two options share a group", () => {
    expect(() => validateSelections("4runner", "sr5", { trim: [grilleBlackout.id, grilleChrome.id] })).toThrow(
      /Selection group "trim-grille" accepts a single option/,
    );
  });

  it("keeps single-select categories without groups to one option", () => {
    expect(() =>
      validateSelections("4runner", "sr5", { paint: ["paint-218-blueprint", "paint-070-midnight-black"] }),
    ).toThrow(/accepts a single option/);
  });

  it("survives a round trip through the scene and stays visible", async () => {
    const fixture = createVehicleFixture();
    const { satisfied } = verifyNodeContract(fixture.root, fourRunnerOptions);
    const controller = new VehicleSceneController(fixture.root, satisfied);

    await controller.applyConfiguration({ trim: [tyreWhite.id, grilleBlackout.id] });

    expect(colorHexAt(fixture.root, "PLACED_KO3_front_left", "tire.sidewall")).toBe("6f6f6c");
    expect(colorHexAt(fixture.root, "Tun_GRILLE", "plastik.all.003")).toBe("0d0f11");
  });
});

// ─────────────────────────────────────────────── scene reversal

describe("reversing operations", () => {
  function replacementOption(): CustomizationOption {
    return {
      id: "wheels-swap-beadlock",
      category: "wheels",
      label: "Beadlock swap",
      operation: "mesh-replacement",
      assetUrl: "/models/wheels/beadlock.glb",
      mountNodes: ["MOUNT_WHEEL_FRONT_LEFT"],
      hidesNodes: ["PLACED_WEISU_front_left"],
      compatibleVehicleIds: ["4runner"],
    };
  }

  it("re-shows displaced geometry when a replacement is removed", async () => {
    const fixture = createVehicleFixture();
    const option = replacementOption();
    const controller = new VehicleSceneController(fixture.root, [option]);

    // Stand in for the mounted asset without a network fetch: hide the node the way
    // applyMeshReplacement does, then reverse it.
    fixture.root.getObjectByName("PLACED_WEISU_front_left")!.visible = false;

    await controller.removeOption(option);

    expect(fixture.root.getObjectByName("PLACED_WEISU_front_left")!.visible).toBe(true);
  });

  it("makes texture-update nodes visible again when reapplied", async () => {
    const fixture = createVehicleFixture();

    const decalNode = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      Object.assign(new THREE.MeshStandardMaterial(), { name: "decal.slot" }),
    );
    decalNode.name = "DECAL_DRIVER";
    fixture.root.add(decalNode);

    const option: CustomizationOption = {
      id: "decal-test",
      category: "decal",
      label: "Test decal",
      operation: "texture-update",
      targetNodes: ["DECAL_DRIVER"],
      materialConfig: { textureUrl: "/textures/decal.png" },
      compatibleVehicleIds: ["4runner"],
    };

    const controller = new VehicleSceneController(fixture.root, [option]);
    // Texture fetching is a network concern with no bearing on this assertion; substitute the
    // writer so the test pins the visibility contract rather than the loader.
    (controller as unknown as { writer: unknown }).writer = {
      applyTexture: async () => 1,
      applyMaterialConfig: () => 1,
    };

    decalNode.visible = false;
    const applied = await controller.applyOption(option);

    expect(applied).toBe(true);
    expect(decalNode.visible).toBe(true);
  });
});

// ─────────────────────────────────────────────── material disposal

describe("material disposal", () => {
  it("reinstalls original materials so the caller's traversal can release them", async () => {
    const fixture = createVehicleFixture();
    const { satisfied } = verifyNodeContract(fixture.root, fourRunnerOptions);
    const controller = new VehicleSceneController(fixture.root, satisfied);

    await controller.applyOption(getOptionById("4runner", "paint-3u5-barcelona-red")!);
    expect(materialAt(fixture.root, "BODY", "body.carmain")).not.toBe(fixture.materials.bodyPaint);

    controller.dispose();

    // The mesh points back at the GLB-supplied instance, which a subsequent disposeSubtree can
    // therefore reach. Previously it was stranded inside the writer and leaked.
    expect(materialAt(fixture.root, "BODY", "body.carmain")).toBe(fixture.materials.bodyPaint);
    expect(controller.clonedMaterialCount).toBe(0);
  });
});

// ─────────────────────────────────────────────── asset URL normalization

describe("catalog asset URLs", () => {
  it("prefixes root-relative URLs with the deployment base", async () => {
    const { normalizeOptionAssets } = await import("../lib/api/configurations");

    const normalized = normalizeOptionAssets(
      {
        id: "decal-x",
        category: "decal",
        label: "Decal",
        operation: "texture-update",
        assetUrl: "/models/parts/x.glb",
        thumbnailUrl: "/images/x.png",
        materialConfig: { textureUrl: "/textures/decals/x.png" },
        compatibleVehicleIds: ["4runner"],
      },
      "/toyota-showroom",
    );

    expect(normalized.assetUrl).toBe("/toyota-showroom/models/parts/x.glb");
    expect(normalized.thumbnailUrl).toBe("/toyota-showroom/images/x.png");
    expect(normalized.materialConfig?.textureUrl).toBe("/toyota-showroom/textures/decals/x.png");
  });

  it("leaves absolute URLs alone", async () => {
    const { normalizeOptionAssets } = await import("../lib/api/configurations");
    const normalized = normalizeOptionAssets(
      {
        id: "decal-y",
        category: "decal",
        label: "Decal",
        operation: "texture-update",
        materialConfig: { textureUrl: "https://cdn.example.com/y.png" },
        compatibleVehicleIds: ["4runner"],
      },
      "/toyota-showroom",
    );
    expect(normalized.materialConfig?.textureUrl).toBe("https://cdn.example.com/y.png");
  });
});

// ─────────────────────────────────────────────── browser storage failures

describe("browser storage failures", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  it("reports a failed write instead of returning a phantom success", async () => {
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException("QuotaExceededError");
        },
        removeItem: () => {},
      },
    };

    const { localConfigurationTransport } = await import("../lib/api/localConfigurationTransport");

    await expect(
      localConfigurationTransport.create({ vehicleId: "4runner", modelYear: 2024, gradeId: "sr5" }),
    ).rejects.toMatchObject({ status: 507, code: "local_persistence_failed" });
  });
});

// ─────────────────────────────────────────────── camera restoration

describe("camera restoration", () => {
  const vehicleStub = {
    threeDConfig: {
      cameraPresets: [
        { id: "hero", label: "Hero", position: [7.5, 4, 8.5], target: [0, 1.1, 0] },
        { id: "side", label: "Side", position: [10, 2.2, 0], target: [0, 1, 0] },
      ],
    },
  };

  const configuration = (cameraState?: unknown) =>
    ({
      configurationId: "cfg_1",
      vehicleId: "4runner",
      modelYear: 2024,
      model: "4Runner",
      gradeId: "sr5",
      selections: {},
      cameraState,
      revision: 1,
      schemaVersion: "1.0.0",
      createdAt: "",
      updatedAt: "",
    }) as never;

  it("prefers the saved preset over the vehicle default", async () => {
    const { presetForConfiguration } = await import("../app/components/BuilderApp");
    const preset = presetForConfiguration(
      vehicleStub as never,
      configuration({ presetId: "side", position: [10, 2.2, 0], target: [0, 1, 0] }),
    );
    expect(preset?.id).toBe("side");
  });

  it("reconstructs a preset from a free-orbit camera state", async () => {
    const { presetForConfiguration } = await import("../app/components/BuilderApp");
    const preset = presetForConfiguration(
      vehicleStub as never,
      configuration({ position: [3, 3, 3], target: [0, 1, 0] }),
    );
    expect(preset?.position).toEqual([3, 3, 3]);
  });

  it("falls back to the first preset when nothing was saved", async () => {
    const { presetForConfiguration } = await import("../app/components/BuilderApp");
    expect(presetForConfiguration(vehicleStub as never, configuration(undefined))?.id).toBe("hero");
  });
});

// ─────────────────────────────────────────────── backend detection

describe("resuming a configuration when no backend exists", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
      },
    };
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    vi.restoreAllMocks();
  });

  it("resolves a locally-saved configuration through a bare host 404", async () => {
    const api = await import("../lib/api/configurations");

    // First session: no backend, so the write falls back to browser storage.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>404</html>", { status: 404 })));
    const created = await api.createConfiguration({ vehicleId: "4runner", modelYear: 2024, gradeId: "sr5" });

    // Second session: a reload resets transport detection, so the GET hits the host first and gets
    // its HTML 404 page. That must route to the local store, not strand the saved build.
    api.resetTransportDetection();
    const resumed = await api.getConfiguration(created.configurationId);

    expect(resumed.configurationId).toBe(created.configurationId);
  });

  it("still reports a genuine not-found from a live API", async () => {
    const api = await import("../lib/api/configurations");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "not_found", status: 404, message: "gone" } }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(api.getConfiguration("cfg_missing")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });
});
