import {
  validateSelections,
  validateVehicleIdentity,
} from "../validation/configuration";
import {
  CUSTOMIZATION_SCHEMA_VERSION,
  type SelectionMap,
  type VehicleConfiguration,
} from "../types/customization";
import { invalidBody } from "../api/errors";
import { MAX_COMPARE, MIN_COMPARE } from "../api/client";

/**
 * Shareable garage-compare deep links (`?cmp=…`).
 *
 * Encodes a 2–4 build set as vehicle + grade + option ids so `/compare?cmp=…` restores the same
 * comparison on another browser without D1 / localStorage configuration ids. Distinct from
 * single-build deep links (`?c=…` in `deepLink.ts`, issue #15).
 */

export const COMPARE_DEEP_LINK_QUERY_PARAM = "cmp";
export const COMPARE_DEEP_LINK_SCHEMA_VERSION = 1 as const;

/**
 * Soft cap for full share URLs. Many messengers / QR contexts truncate near 2KB; staying under
 * this keeps restore reliable. Callers must surface copy-error UX when encoding exceeds it.
 */
export const COMPARE_DEEP_LINK_MAX_URL_LENGTH = 2048;

/** Compact on-wire build — short keys; option ids only (never GLB node/material names). */
interface CompactCompareBuild {
  u: string;
  y: number;
  g: string;
  s: SelectionMap;
}

interface CompactComparePayload {
  v: typeof COMPARE_DEEP_LINK_SCHEMA_VERSION;
  b: CompactCompareBuild[];
}

export interface CompareDeepLinkBuildInput {
  vehicleId: string;
  modelYear: number;
  gradeId: string;
  selections: SelectionMap;
}

export interface DecodedCompareDeepLinkBuild {
  vehicleId: string;
  modelYear: number;
  gradeId: string;
  selections: SelectionMap;
}

export type CreateCompareDeepLinkResult =
  | { ok: true; url: string; encoded: string; length: number }
  | {
      ok: false;
      reason: "too_long" | "invalid_count";
      message: string;
      length?: number;
    };

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): Uint8Array {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const base64 = padded + "=".repeat(padLength);
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/** Encodes 2–4 builds into a URL-safe `cmp=` value (vehicle + option ids only). */
export function encodeCompareDeepLink(builds: CompareDeepLinkBuildInput[]): string {
  if (builds.length < MIN_COMPARE || builds.length > MAX_COMPARE) {
    throw invalidBody(
      `Compare deep-link requires ${MIN_COMPARE}–${MAX_COMPARE} builds, got ${builds.length}.`,
    );
  }
  const payload: CompactComparePayload = {
    v: COMPARE_DEEP_LINK_SCHEMA_VERSION,
    b: builds.map((build) => ({
      u: build.vehicleId,
      y: build.modelYear,
      g: build.gradeId,
      s: build.selections,
    })),
  };
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

/**
 * Decodes a `cmp=` value without catalog validation. Throws `ApiError` (422) on malformed payloads.
 */
export function decodeCompareDeepLink(encoded: string): DecodedCompareDeepLinkBuild[] {
  if (typeof encoded !== "string" || encoded.trim() === "") {
    throw invalidBody(`Compare deep-link payload must be a non-empty string.`);
  }

  let json: string;
  try {
    json = new TextDecoder().decode(fromBase64Url(encoded.trim()));
  } catch {
    throw invalidBody(`Compare deep-link payload is not valid base64url.`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw invalidBody(`Compare deep-link payload is not valid JSON.`);
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw invalidBody(`Compare deep-link payload must be a JSON object.`);
  }

  const candidate = raw as Record<string, unknown>;
  if (candidate.v !== COMPARE_DEEP_LINK_SCHEMA_VERSION) {
    throw invalidBody(
      `Unsupported compare deep-link schema version "${String(candidate.v)}" (expected ${COMPARE_DEEP_LINK_SCHEMA_VERSION}).`,
    );
  }
  if (!Array.isArray(candidate.b)) {
    throw invalidBody(`Compare deep-link "b" (builds) must be an array.`);
  }
  if (candidate.b.length < MIN_COMPARE || candidate.b.length > MAX_COMPARE) {
    throw invalidBody(
      `Compare deep-link requires ${MIN_COMPARE}–${MAX_COMPARE} builds, got ${candidate.b.length}.`,
    );
  }

  return candidate.b.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw invalidBody(`Compare deep-link build[${index}] must be an object.`);
    }
    const build = entry as Record<string, unknown>;
    if (typeof build.u !== "string" || build.u.trim() === "") {
      throw invalidBody(`Compare deep-link build[${index}].u (vehicleId) must be a non-empty string.`);
    }
    if (typeof build.y !== "number" || !Number.isInteger(build.y)) {
      throw invalidBody(`Compare deep-link build[${index}].y (modelYear) must be an integer.`);
    }
    if (typeof build.g !== "string" || build.g.trim() === "") {
      throw invalidBody(`Compare deep-link build[${index}].g (gradeId) must be a non-empty string.`);
    }
    if (build.s === undefined) {
      throw invalidBody(`Compare deep-link build[${index}].s (selections) is required.`);
    }
    return {
      vehicleId: build.u,
      modelYear: build.y,
      gradeId: build.g,
      selections: build.s as SelectionMap,
    };
  });
}

/**
 * Decodes then validates each build against the same catalog rules as saved configurations.
 * Returns ephemeral `VehicleConfiguration` rows suitable for the compare table (no D1 ids).
 */
export function validateCompareDeepLink(encoded: string): VehicleConfiguration[] {
  const decoded = decodeCompareDeepLink(encoded);
  const now = new Date().toISOString();

  return decoded.map((build, index) => {
    const { vehicle } = validateVehicleIdentity(build.vehicleId, build.modelYear, build.gradeId);
    const selections = validateSelections(build.vehicleId, build.gradeId, build.selections);
    return {
      configurationId: `cmp_${index}_${build.vehicleId}`,
      vehicleId: build.vehicleId,
      modelYear: build.modelYear,
      model: vehicle.model,
      gradeId: build.gradeId,
      selections,
      revision: 0,
      schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    };
  });
}

/** Reads the `cmp` query param from a search string (`?cmp=…` or bare `cmp=…`). */
export function readCompareDeepLinkParam(search: string): string | null {
  const normalized = search.startsWith("?") ? search.slice(1) : search;
  if (!normalized) return null;
  try {
    const value = new URLSearchParams(normalized).get(COMPARE_DEEP_LINK_QUERY_PARAM);
    return value && value.trim() !== "" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Builds `/compare/?cmp=…` share URL. Returns `ok: false` with a copy-error message when the
 * full URL would exceed {@link COMPARE_DEEP_LINK_MAX_URL_LENGTH}.
 */
export function createCompareDeepLinkUrl(
  origin: string,
  comparePathname: string,
  builds: CompareDeepLinkBuildInput[],
): CreateCompareDeepLinkResult {
  if (builds.length < MIN_COMPARE || builds.length > MAX_COMPARE) {
    return {
      ok: false,
      reason: "invalid_count",
      message: `Select ${MIN_COMPARE}–${MAX_COMPARE} builds to share a compare link.`,
    };
  }

  let encoded: string;
  try {
    encoded = encodeCompareDeepLink(builds);
  } catch (error) {
    return {
      ok: false,
      reason: "invalid_count",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const path =
    comparePathname.endsWith("/") || comparePathname === ""
      ? comparePathname
      : `${comparePathname}/`;
  const url = new URL(path || "/compare/", origin);
  url.searchParams.set(COMPARE_DEEP_LINK_QUERY_PARAM, encoded);
  const href = url.toString();
  if (href.length > COMPARE_DEEP_LINK_MAX_URL_LENGTH) {
    return {
      ok: false,
      reason: "too_long",
      message: `Compare link is too long to share (${href.length} chars; max ${COMPARE_DEEP_LINK_MAX_URL_LENGTH}). Remove a build or simplify selections, then try again.`,
      length: href.length,
    };
  }
  return { ok: true, url: href, encoded, length: href.length };
}

/** Map garage / saved configs into compare deep-link inputs (drops camera/paint — compare is options-only). */
export function buildsToCompareDeepLinkInput(
  builds: Array<Pick<VehicleConfiguration, "vehicleId" | "modelYear" | "gradeId" | "selections">>,
): CompareDeepLinkBuildInput[] {
  return builds.map((build) => ({
    vehicleId: build.vehicleId,
    modelYear: build.modelYear,
    gradeId: build.gradeId,
    selections: build.selections,
  }));
}

