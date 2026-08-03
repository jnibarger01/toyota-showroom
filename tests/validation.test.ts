import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api/errors";
import {
  priceSelections,
  resolveOptions,
  validateCameraState,
  validateCreateConfiguration,
  validatePatchConfiguration,
  validateSelections,
  validateVehicleIdentity,
} from "../lib/validation/configuration";

function expectApiError(fn: () => unknown, status: number, match?: RegExp): ApiError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(status);
    if (match) expect(apiError.message).toMatch(match);
    return apiError;
  }
  throw new Error("Expected the call to throw an ApiError.");
}

describe("vehicle / grade / model-year validation", () => {
  it("accepts a coherent combination", () => {
    const { vehicle, grade } = validateVehicleIdentity("4runner", 2024, "trd-pro");
    expect(vehicle.slug).toBe("4runner");
    expect(grade.id).toBe("trd-pro");
  });

  it("rejects an unknown vehicle", () => {
    expectApiError(() => validateVehicleIdentity("supra", 2024, "sr5"), 404, /No vehicle found/);
  });

  it("rejects a model year the catalog does not offer", () => {
    expectApiError(() => validateVehicleIdentity("4runner", 2019, "sr5"), 422, /Model year 2019/);
  });

  it("rejects a grade that belongs to a different vehicle", () => {
    expectApiError(() => validateVehicleIdentity("4runner", 2024, "trd-sport"), 422, /is not offered/);
  });
});

describe("selection validation", () => {
  it("accepts known options in their declared categories", () => {
    const selections = validateSelections("4runner", "trd-pro", {
      paint: ["paint-218-blueprint"],
      accessory: ["accessory-roof-rack", "accessory-light-bar"],
    });
    expect(selections.paint).toEqual(["paint-218-blueprint"]);
    expect(selections.accessory).toHaveLength(2);
  });

  it("rejects an unknown option id", () => {
    expectApiError(
      () => validateSelections("4runner", "sr5", { paint: ["paint-999-not-real"] }),
      422,
      /Unknown option id/,
    );
  });

  it("rejects an unknown category", () => {
    expectApiError(
      () => validateSelections("4runner", "sr5", { spoiler: ["anything"] }),
      422,
      /Unknown customization category/,
    );
  });

  it("rejects an option filed under the wrong category", () => {
    expectApiError(
      () => validateSelections("4runner", "sr5", { trim: ["paint-218-blueprint"] }),
      422,
      /belongs to category "paint"/,
    );
  });

  it("rejects more than one option in a single-select category", () => {
    expectApiError(
      () => validateSelections("4runner", "sr5", { paint: ["paint-218-blueprint", "paint-070-midnight-black"] }),
      422,
      /accepts a single option/,
    );
  });

  it("allows several options in an accumulating category", () => {
    const selections = validateSelections("4runner", "sr5", {
      accessory: ["accessory-roof-rack", "accessory-rock-sliders", "accessory-light-bar"],
    });
    expect(selections.accessory).toHaveLength(3);
  });

  it("rejects duplicates within a category", () => {
    expectApiError(
      () => validateSelections("4runner", "sr5", { accessory: ["accessory-roof-rack", "accessory-roof-rack"] }),
      422,
      /duplicate option ids/,
    );
  });

  it("rejects an option that is not offered on the requested grade", () => {
    // Solar Octane is a TRD Pro-only colour.
    expectApiError(
      () => validateSelections("4runner", "sr5", { paint: ["paint-0r2-solar-octane"] }),
      422,
      /not available on grade "sr5"/,
    );
    expect(validateSelections("4runner", "trd-pro", { paint: ["paint-0r2-solar-octane"] }).paint).toEqual([
      "paint-0r2-solar-octane",
    ]);
  });

  it("rejects an option belonging to a different vehicle's catalog", () => {
    expectApiError(
      () => validateSelections("camry", "le", { paint: ["paint-218-blueprint"] }),
      422,
      /Unknown option id/,
    );
  });

  it("rejects a non-array selection value", () => {
    expectApiError(
      () => validateSelections("4runner", "sr5", { paint: "paint-218-blueprint" }),
      422,
      /must be an array/,
    );
  });
});

describe("camera state validation", () => {
  it("accepts a well-formed camera state", () => {
    const state = validateCameraState({ presetId: "hero", position: [1, 2, 3], target: [0, 1, 0] });
    expect(state?.position).toEqual([1, 2, 3]);
  });

  it("rejects vectors of the wrong length or type", () => {
    expectApiError(() => validateCameraState({ position: [1, 2], target: [0, 0, 0] }), 422);
    expectApiError(() => validateCameraState({ position: [1, 2, "x"], target: [0, 0, 0] }), 422);
    expectApiError(() => validateCameraState({ position: [1, 2, Number.NaN], target: [0, 0, 0] }), 422);
  });
});

describe("request body validation", () => {
  it("builds a validated create input and stamps the canonical model name", () => {
    const input = validateCreateConfiguration({
      vehicleId: "4runner",
      modelYear: 2024,
      gradeId: "trd-off-road",
      selections: { paint: ["paint-1j9-ice-cap"] },
    });
    expect(input.model).toBe("4Runner");
    expect(input.selections.paint).toEqual(["paint-1j9-ice-cap"]);
  });

  it("rejects a non-object body", () => {
    expectApiError(() => validateCreateConfiguration("not json"), 422);
    expectApiError(() => validateCreateConfiguration(null), 422);
  });

  it("re-validates a patch against the stored vehicle and grade, not the request's claims", () => {
    // A client that stored an SR5 configuration cannot unlock a TRD Pro-only colour by asserting
    // a different grade — the patch validator only ever consults the persisted record.
    expectApiError(
      () =>
        validatePatchConfiguration(
          { selections: { paint: ["paint-0r2-solar-octane"] }, gradeId: "trd-pro" },
          { vehicleId: "4runner", gradeId: "sr5" },
        ),
      422,
      /not available on grade "sr5"/,
    );
  });

  it("leaves untouched fields absent from the patch", () => {
    const patch = validatePatchConfiguration(
      { cameraState: { position: [1, 1, 1], target: [0, 0, 0] } },
      { vehicleId: "4runner", gradeId: "sr5" },
    );
    expect(patch.selections).toBeUndefined();
    expect(patch.cameraState?.position).toEqual([1, 1, 1]);
  });

  it("rejects a non-integer expectedRevision", () => {
    expectApiError(
      () => validatePatchConfiguration({ expectedRevision: 1.5 }, { vehicleId: "4runner", gradeId: "sr5" }),
      422,
    );
  });
});

describe("server-side asset resolution", () => {
  it("resolves ids to catalog records carrying the node and material names", () => {
    const [option] = resolveOptions("4runner", { paint: ["paint-218-blueprint"] });
    expect(option.targetNodes).toEqual(["BODY"]);
    expect(option.targetMaterials).toEqual(["body.carmain"]);
  });

  it("returns resolved options in canonical apply order", () => {
    const resolved = resolveOptions("4runner", {
      accessory: ["accessory-roof-rack"],
      paint: ["paint-218-blueprint"],
      trim: ["trim-grille-chrome"],
    });
    expect(resolved.map((option) => option.category)).toEqual(["trim", "paint", "accessory"]);
  });

  it("prices a selection from catalog deltas rather than client-supplied figures", () => {
    expect(
      priceSelections("4runner", {
        paint: ["paint-0r2-solar-octane"],
        accessory: ["accessory-roof-rack", "accessory-light-bar"],
      }),
    ).toBe(425 + 1150 + 680);
  });
});
