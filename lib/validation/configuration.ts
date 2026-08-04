import { invalidBody, notFound } from "../api/errors";
import { getOptionById, getOptionsForVehicle, isOptionAvailableForGrade } from "../data/options";
import { getVehicleBySlug } from "../data/vehicles";
import {
  CATEGORY_APPLY_ORDER,
  isMultiSelect,
  type CameraState,
  type CustomizationCategory,
  type CustomizationOption,
  type SelectionMap,
} from "../types/customization";

/**
 * Server-side validation and trusted asset resolution.
 *
 * The browser sends option ids and nothing else. Node names, material names, and GLB paths are
 * attached here, from the server's own catalog — so a crafted request cannot point the loader at
 * an arbitrary URL or rewrite a material the catalog does not expose.
 */

const CATEGORIES = new Set<string>(CATEGORY_APPLY_ORDER);

export interface ValidatedConfigurationInput {
  vehicleId: string;
  modelYear: number;
  model: string;
  gradeId: string;
  selections: SelectionMap;
  cameraState?: CameraState;
}

interface RawConfigurationBody {
  vehicleId?: unknown;
  modelYear?: unknown;
  gradeId?: unknown;
  selections?: unknown;
  cameraState?: unknown;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw invalidBody(`"${field}" must be a non-empty string.`);
  }
  return value;
}

/**
 * Validates vehicle / grade / model-year coherence against the catalog.
 *
 * The year is checked against the vehicle record rather than accepted as given, which is what
 * rejects an otherwise well-formed request for a 2019 TRD Pro 4Runner with 2024 options.
 */
export function validateVehicleIdentity(vehicleId: string, modelYear: number, gradeId: string) {
  const vehicle = getVehicleBySlug(vehicleId);
  if (!vehicle) throw notFound(`No vehicle found for id "${vehicleId}".`);

  if (!Number.isInteger(modelYear)) throw invalidBody(`"modelYear" must be an integer.`);
  if (modelYear !== vehicle.year) {
    throw invalidBody(
      `Model year ${modelYear} is not available for "${vehicleId}" (catalog year ${vehicle.year}).`,
    );
  }

  const grade = vehicle.grades.find((candidate) => candidate.id === gradeId);
  if (!grade) {
    const available = vehicle.grades.map((candidate) => candidate.id).join(", ");
    throw invalidBody(`Grade "${gradeId}" is not offered on the ${vehicle.year} ${vehicle.model}. Available: ${available}.`);
  }

  return { vehicle, grade };
}

/**
 * Validates a selection map: every id must exist in the vehicle's catalog, sit in the category it
 * claims, be offered on the chosen grade, and respect single- versus multi-select cardinality.
 */
export function validateSelections(
  vehicleId: string,
  gradeId: string,
  raw: unknown,
): SelectionMap {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw invalidBody(`"selections" must be an object keyed by category.`);
  }

  const result: SelectionMap = {};
  const seenCategories = new Set<CustomizationCategory>();

  for (const [category, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!CATEGORIES.has(category)) {
      throw invalidBody(`Unknown customization category "${category}".`);
    }
    if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
      throw invalidBody(`"selections.${category}" must be an array of option ids.`);
    }

    const typed = category as CustomizationCategory;
    seenCategories.add(typed);
    const ids = value as string[];

    if (!isMultiSelect(typed) && ids.length > 1) {
      throw invalidBody(`Category "${category}" accepts a single option, received ${ids.length}.`);
    }
    if (new Set(ids).size !== ids.length) {
      throw invalidBody(`Category "${category}" contains duplicate option ids.`);
    }

    for (const id of ids) {
      const option = getOptionById(vehicleId, id);
      if (!option) throw invalidBody(`Unknown option id "${id}" for vehicle "${vehicleId}".`);
      if (option.category !== typed) {
        throw invalidBody(`Option "${id}" belongs to category "${option.category}", not "${category}".`);
      }
      if (!option.compatibleVehicleIds.includes(vehicleId)) {
        throw invalidBody(`Option "${id}" is not compatible with vehicle "${vehicleId}".`);
      }
      if (!isOptionAvailableForGrade(option, gradeId)) {
        throw invalidBody(`Option "${id}" is not available on grade "${gradeId}".`);
      }
    }

    result[typed] = ids;
  }

  return result;
}

const VECTOR_LENGTH = 3;

export function validateCameraState(raw: unknown): CameraState | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") throw invalidBody(`"cameraState" must be an object.`);

  const candidate = raw as Record<string, unknown>;
  const readVector = (key: string): [number, number, number] => {
    const value = candidate[key];
    if (!Array.isArray(value) || value.length !== VECTOR_LENGTH || value.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      throw invalidBody(`"cameraState.${key}" must be an array of three finite numbers.`);
    }
    return value as [number, number, number];
  };

  const presetId = candidate.presetId;
  if (presetId !== undefined && typeof presetId !== "string") {
    throw invalidBody(`"cameraState.presetId" must be a string when present.`);
  }

  return {
    presetId: presetId as string | undefined,
    position: readVector("position"),
    target: readVector("target"),
  };
}

/** Full body validation for `POST /api/v1/configurations`. */
export function validateCreateConfiguration(body: unknown): ValidatedConfigurationInput {
  if (typeof body !== "object" || body === null) throw invalidBody("Request body must be a JSON object.");
  const raw = body as RawConfigurationBody;

  const vehicleId = asString(raw.vehicleId, "vehicleId");
  const gradeId = asString(raw.gradeId, "gradeId");
  const modelYear = typeof raw.modelYear === "number" ? raw.modelYear : Number.NaN;

  const { vehicle } = validateVehicleIdentity(vehicleId, modelYear, gradeId);

  return {
    vehicleId,
    modelYear,
    model: vehicle.model,
    gradeId,
    selections: validateSelections(vehicleId, gradeId, raw.selections),
    cameraState: validateCameraState(raw.cameraState),
  };
}

export interface ValidatedPatch {
  selections?: SelectionMap;
  cameraState?: CameraState;
  expectedRevision?: number;
}

/** Partial body validation for `PATCH /api/v1/configurations/:id`. */
export function validatePatchConfiguration(
  body: unknown,
  existing: { vehicleId: string; gradeId: string },
): ValidatedPatch {
  if (typeof body !== "object" || body === null) throw invalidBody("Request body must be a JSON object.");
  const raw = body as RawConfigurationBody & { expectedRevision?: unknown };

  const patch: ValidatedPatch = {};

  if ("selections" in raw && raw.selections !== undefined) {
    patch.selections = validateSelections(existing.vehicleId, existing.gradeId, raw.selections);
  }
  if ("cameraState" in raw && raw.cameraState !== undefined) {
    patch.cameraState = validateCameraState(raw.cameraState);
  }
  if (raw.expectedRevision !== undefined) {
    if (!Number.isInteger(raw.expectedRevision)) {
      throw invalidBody(`"expectedRevision" must be an integer when present.`);
    }
    patch.expectedRevision = raw.expectedRevision as number;
  }

  return patch;
}

/**
 * Resolves option ids to the full, trusted records the viewer needs.
 *
 * This is the boundary the requirement "avoid accepting arbitrary GLB paths, material names, or
 * node names from the browser" is enforced at: ids go in, catalog-owned records come out.
 */
export function resolveOptions(vehicleId: string, selections: SelectionMap): CustomizationOption[] {
  const catalog = getOptionsForVehicle(vehicleId);
  const byId = new Map(catalog.map((option) => [option.id, option]));

  return CATEGORY_APPLY_ORDER.flatMap((category) =>
    (selections[category] ?? [])
      .map((id) => byId.get(id))
      .filter((option): option is CustomizationOption => option !== undefined),
  );
}

/** Sum of `priceDelta` across a validated selection map. */
export function priceSelections(vehicleId: string, selections: SelectionMap): number {
  return resolveOptions(vehicleId, selections).reduce((total, option) => total + (option.priceDelta ?? 0), 0);
}
