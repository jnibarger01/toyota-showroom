import {
  validateCameraState,
  validateSelections,
  validateVehicleIdentity,
} from "../validation/configuration";
import type { CameraState, SelectionMap } from "../types/customization";
import { invalidBody } from "../api/errors";

/**
 * Shareable deep-link builds (`?c=…`).
 *
 * Encodes option ids + camera state into a URL-safe payload so a visitor can restore a build on
 * GitHub Pages / local without a D1-backed configuration id. Validation reuses the same catalog
 * checks as saved configurations — never GLB node names or material paths.
 */

export const DEEP_LINK_QUERY_PARAM = "c";
export const DEEP_LINK_SCHEMA_VERSION = 1 as const;

/** Compact on-wire camera shape — short keys keep QR payloads small. */
interface CompactCamera {
  i?: string;
  p: [number, number, number];
  t: [number, number, number];
}

interface CompactPayload {
  v: typeof DEEP_LINK_SCHEMA_VERSION;
  g: string;
  s: SelectionMap;
  c?: CompactCamera;
}

export interface BuildDeepLinkInput {
  gradeId: string;
  selections: SelectionMap;
  cameraState?: CameraState;
}

export interface DecodedBuildDeepLink {
  gradeId: string;
  selections: SelectionMap;
  cameraState?: CameraState;
}

const CAMERA_DECIMALS = 3;

function roundCoord(n: number): number {
  const factor = 10 ** CAMERA_DECIMALS;
  return Math.round(n * factor) / factor;
}

function compactCamera(camera: CameraState): CompactCamera {
  return {
    ...(camera.presetId ? { i: camera.presetId } : {}),
    p: camera.position.map(roundCoord) as [number, number, number],
    t: camera.target.map(roundCoord) as [number, number, number],
  };
}

function expandCamera(raw: CompactCamera): CameraState {
  return {
    ...(raw.i ? { presetId: raw.i } : {}),
    position: raw.p,
    target: raw.t,
  };
}

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

/** Encodes selections + camera into a URL-safe `c=` value (option ids only). */
export function encodeBuildDeepLink(input: BuildDeepLinkInput): string {
  const payload: CompactPayload = {
    v: DEEP_LINK_SCHEMA_VERSION,
    g: input.gradeId,
    s: input.selections,
  };
  if (input.cameraState) {
    payload.c = compactCamera(input.cameraState);
  }
  const json = JSON.stringify(payload);
  return toBase64Url(new TextEncoder().encode(json));
}

/**
 * Decodes a `c=` value without catalog validation. Throws `ApiError` (422) on malformed payloads
 * so callers can treat decode failures the same way as invalid saved-config bodies.
 */
export function decodeBuildDeepLink(encoded: string): DecodedBuildDeepLink {
  if (typeof encoded !== "string" || encoded.trim() === "") {
    throw invalidBody(`Deep-link payload must be a non-empty string.`);
  }

  let json: string;
  try {
    json = new TextDecoder().decode(fromBase64Url(encoded.trim()));
  } catch {
    throw invalidBody(`Deep-link payload is not valid base64url.`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw invalidBody(`Deep-link payload is not valid JSON.`);
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw invalidBody(`Deep-link payload must be a JSON object.`);
  }

  const candidate = raw as Record<string, unknown>;
  if (candidate.v !== DEEP_LINK_SCHEMA_VERSION) {
    throw invalidBody(
      `Unsupported deep-link schema version "${String(candidate.v)}" (expected ${DEEP_LINK_SCHEMA_VERSION}).`,
    );
  }
  if (typeof candidate.g !== "string" || candidate.g.trim() === "") {
    throw invalidBody(`Deep-link "g" (gradeId) must be a non-empty string.`);
  }
  if (candidate.s === undefined) {
    throw invalidBody(`Deep-link "s" (selections) is required.`);
  }

  let cameraState: CameraState | undefined;
  if (candidate.c !== undefined && candidate.c !== null) {
    if (typeof candidate.c !== "object" || Array.isArray(candidate.c)) {
      throw invalidBody(`Deep-link "c" (camera) must be an object when present.`);
    }
    const cam = candidate.c as Record<string, unknown>;
    cameraState = expandCamera({
      i: typeof cam.i === "string" ? cam.i : undefined,
      p: cam.p as [number, number, number],
      t: cam.t as [number, number, number],
    });
  }

  return {
    gradeId: candidate.g,
    selections: candidate.s as SelectionMap,
    cameraState,
  };
}

/**
 * Decodes then validates against the same catalog rules as saved configurations.
 * `vehicleId` / `modelYear` come from the route + vehicle record, not the URL.
 */
export function validateBuildDeepLink(
  vehicleId: string,
  modelYear: number,
  encoded: string,
): DecodedBuildDeepLink {
  const decoded = decodeBuildDeepLink(encoded);
  validateVehicleIdentity(vehicleId, modelYear, decoded.gradeId);
  const selections = validateSelections(vehicleId, decoded.gradeId, decoded.selections);
  const cameraState = validateCameraState(decoded.cameraState);
  return { gradeId: decoded.gradeId, selections, cameraState };
}

/** Reads the `c` query param from a search string (`?c=…` or bare `c=…`). */
export function readBuildDeepLinkParam(search: string): string | null {
  const normalized = search.startsWith("?") ? search.slice(1) : search;
  if (!normalized) return null;
  try {
    const value = new URLSearchParams(normalized).get(DEEP_LINK_QUERY_PARAM);
    return value && value.trim() !== "" ? value : null;
  } catch {
    return null;
  }
}

/** Builds `/[slug]/?c=…` share URL from the current selections + camera. */
export function createBuildDeepLinkUrl(
  origin: string,
  pathname: string,
  input: BuildDeepLinkInput,
): string {
  const encoded = encodeBuildDeepLink(input);
  const path = pathname.endsWith("/") || pathname === "" ? pathname : `${pathname}/`;
  const url = new URL(path || "/", origin);
  url.searchParams.set(DEEP_LINK_QUERY_PARAM, encoded);
  return url.toString();
}
