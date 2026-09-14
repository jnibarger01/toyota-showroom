import { ApiError, invalidBody } from "../api/errors";
import {
  CUSTOMIZATION_SCHEMA_VERSION,
  type CameraState,
  type SelectionMap,
} from "../types/customization";
import type { PaintStudioState } from "../types/paintStudio";
import {
  validateCameraState,
  validatePaintStudio,
  validateSelections,
  validateVehicleIdentity,
} from "../validation/configuration";

/**
 * Portable configuration JSON export / import (issue #45).
 *
 * Complements deep links (`?c=…`) and Worker/local saves: a readable file for support,
 * backups, and offline handoff. Payload carries option ids + camera + meta only — never GLB
 * node or material names. Import reuses the same catalog validators as Worker / local transports.
 */

export const CONFIG_JSON_KIND = "toyota-showroom-configuration" as const;
export const CONFIG_JSON_SCHEMA_VERSION = 1 as const;

export interface ConfigurationJsonInput {
  vehicleId: string;
  modelYear: number;
  /** Optional human-readable model name stored as meta only. */
  model?: string;
  gradeId: string;
  selections: SelectionMap;
  cameraState?: CameraState;
  paintStudio?: PaintStudioState;
  /** Override export timestamp (tests). Defaults to `new Date().toISOString()`. */
  exportedAt?: string;
}

export interface ConfigurationJsonDocument {
  kind: typeof CONFIG_JSON_KIND;
  schemaVersion: typeof CONFIG_JSON_SCHEMA_VERSION;
  customizationSchemaVersion: typeof CUSTOMIZATION_SCHEMA_VERSION;
  exportedAt: string;
  vehicleId: string;
  modelYear: number;
  model?: string;
  gradeId: string;
  selections: SelectionMap;
  cameraState?: CameraState;
  paintStudio?: PaintStudioState;
}

export interface ValidatedConfigurationJson {
  vehicleId: string;
  modelYear: number;
  model: string;
  gradeId: string;
  selections: SelectionMap;
  cameraState?: CameraState;
  paintStudio?: PaintStudioState;
}

export interface ValidateConfigurationJsonOptions {
  /** When set, reject files for a different vehicle (builder is route-scoped). */
  expectedVehicleId?: string;
  /** When set, reject files whose model year does not match the open vehicle catalog year. */
  expectedModelYear?: number;
}

/**
 * Builds a validated, pretty-printed JSON document from the current build.
 * Runs the same catalog checks used on create so we never export an un-importable payload.
 */
export function exportConfigurationJson(input: ConfigurationJsonInput): string {
  const validated = validateConfigurationFields(input);
  const document: ConfigurationJsonDocument = {
    kind: CONFIG_JSON_KIND,
    schemaVersion: CONFIG_JSON_SCHEMA_VERSION,
    customizationSchemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    vehicleId: validated.vehicleId,
    modelYear: validated.modelYear,
    model: validated.model,
    gradeId: validated.gradeId,
    selections: validated.selections,
    ...(validated.cameraState ? { cameraState: validated.cameraState } : {}),
    ...(validated.paintStudio ? { paintStudio: validated.paintStudio } : {}),
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * Parses and catalog-validates a configuration JSON string or object.
 * Throws `ApiError` (422) with clear messages for schema/version/kind mismatches and bad payloads.
 */
export function validateConfigurationJson(
  raw: string | unknown,
  options: ValidateConfigurationJsonOptions = {},
): ValidatedConfigurationJson {
  const document = parseConfigurationJsonDocument(raw);

  if (options.expectedVehicleId && document.vehicleId !== options.expectedVehicleId) {
    throw invalidBody(
      `This file is for vehicle "${document.vehicleId}"; open that vehicle to import it (currently "${options.expectedVehicleId}").`,
    );
  }
  if (
    options.expectedModelYear !== undefined &&
    document.modelYear !== options.expectedModelYear
  ) {
    throw invalidBody(
      `This file is for model year ${document.modelYear}; the open vehicle catalog year is ${options.expectedModelYear}.`,
    );
  }

  return validateConfigurationFields(document);
}

/** User-facing message for import failures (schema mismatch, invalid JSON, catalog rejection). */
export function formatConfigurationJsonError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Could not import configuration JSON.";
}

function parseConfigurationJsonDocument(raw: string | unknown): ConfigurationJsonDocument {
  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) throw invalidBody("Configuration JSON must be a non-empty string.");
    try {
      value = JSON.parse(trimmed);
    } catch {
      throw invalidBody("Configuration JSON is not valid JSON.");
    }
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidBody("Configuration JSON must be a JSON object.");
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.kind !== CONFIG_JSON_KIND) {
    throw invalidBody(
      `Not a Toyota Showroom configuration export (expected kind "${CONFIG_JSON_KIND}").`,
    );
  }

  if (candidate.schemaVersion !== CONFIG_JSON_SCHEMA_VERSION) {
    throw invalidBody(
      `Unsupported configuration JSON schema version "${String(candidate.schemaVersion)}" (expected ${CONFIG_JSON_SCHEMA_VERSION}).`,
    );
  }

  if (
    candidate.customizationSchemaVersion !== undefined &&
    candidate.customizationSchemaVersion !== CUSTOMIZATION_SCHEMA_VERSION
  ) {
    throw invalidBody(
      `Unsupported customization schema version "${String(candidate.customizationSchemaVersion)}" (expected ${CUSTOMIZATION_SCHEMA_VERSION}).`,
    );
  }

  if (typeof candidate.vehicleId !== "string" || candidate.vehicleId.trim() === "") {
    throw invalidBody(`"vehicleId" must be a non-empty string.`);
  }
  if (typeof candidate.gradeId !== "string" || candidate.gradeId.trim() === "") {
    throw invalidBody(`"gradeId" must be a non-empty string.`);
  }
  if (typeof candidate.modelYear !== "number" || !Number.isInteger(candidate.modelYear)) {
    throw invalidBody(`"modelYear" must be an integer.`);
  }
  if (candidate.selections === undefined) {
    throw invalidBody(`"selections" is required.`);
  }
  if (candidate.exportedAt !== undefined && typeof candidate.exportedAt !== "string") {
    throw invalidBody(`"exportedAt" must be a string when present.`);
  }
  if (candidate.model !== undefined && typeof candidate.model !== "string") {
    throw invalidBody(`"model" must be a string when present.`);
  }

  return {
    kind: CONFIG_JSON_KIND,
    schemaVersion: CONFIG_JSON_SCHEMA_VERSION,
    customizationSchemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
    exportedAt:
      typeof candidate.exportedAt === "string" ? candidate.exportedAt : new Date(0).toISOString(),
    vehicleId: candidate.vehicleId,
    modelYear: candidate.modelYear,
    ...(typeof candidate.model === "string" ? { model: candidate.model } : {}),
    gradeId: candidate.gradeId,
    selections: candidate.selections as SelectionMap,
    cameraState: candidate.cameraState as CameraState | undefined,
    paintStudio: candidate.paintStudio as PaintStudioState | undefined,
  };
}

function validateConfigurationFields(input: {
  vehicleId: string;
  modelYear: number;
  gradeId: string;
  selections: unknown;
  cameraState?: unknown;
  paintStudio?: unknown;
}): ValidatedConfigurationJson {
  const { vehicle } = validateVehicleIdentity(input.vehicleId, input.modelYear, input.gradeId);
  const selections = validateSelections(input.vehicleId, input.gradeId, input.selections);
  const cameraState = validateCameraState(input.cameraState);
  const paintStudio = validatePaintStudio(input.paintStudio, selections);
  return {
    vehicleId: input.vehicleId,
    modelYear: input.modelYear,
    model: vehicle.model,
    gradeId: input.gradeId,
    selections,
    cameraState,
    paintStudio,
  };
}
