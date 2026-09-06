import type {
  CameraState,
  CustomizationOption,
  SelectionMap,
  VehicleConfiguration,
} from "../types/customization";
import { ApiError, type ApiErrorBody } from "./errors";
import { isOptionAvailableForGrade } from "../data/options";
import { localConfigurationTransport } from "./localConfigurationTransport";

/**
 * The only module in the client that talks to the configuration endpoints.
 *
 * UI components never call `fetch` — they call the store, the store calls this. That keeps request
 * shape, error translation, and base-path handling in one place, and makes the store trivially
 * testable by stubbing this module.
 */

const basePath =
  typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
    ? import.meta.env.BASE_URL.replace(/\/$/, "")
    : "";

function apiUrl(path: string): string {
  return `${basePath}/api/v1${path}`;
}

function catalogUrl(path: string): string {
  return `${basePath}/catalog/v1${path}.json`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (cause) {
    // Network-level failure never reaches the UI as a raw TypeError.
    throw new ApiError(0, "network_error", "Could not reach the configuration service.", { cause });
  }

  if (!response.ok) {
    // An error body is not guaranteed to carry the `{ error: {...} }` envelope — a static host
    // serving a bare 404 page, or a proxy, will not. Reading it defensively keeps the failure a
    // reportable ApiError instead of a TypeError thrown from the error path itself.
    const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? "request_failed",
      body?.error?.message ?? `Request to ${url} failed with ${response.status}`,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/**
 * Persistence surface the client is talking to.
 *
 * - `unknown` — no write/read has proven either path yet
 * - `worker` — Cloudflare Worker + D1 (production persistence)
 * - `local` — browser `localStorage` via `localConfigurationTransport` (Pages demo / offline)
 */
export type PersistenceMode = "unknown" | "worker" | "local";

/**
 * Whether the request-aware backend is reachable.
 *
 * `null` until proven either way. It latches to `false` the first time a *write* fails in a way
 * only a host without the route can fail — a network error, a 405, or a 404 on POST/PATCH, which
 * is precisely what the static GitHub Pages export returns. A 404 on GET is left alone, because
 * against a live API it means the configuration genuinely does not exist.
 *
 * Worker/D1 is the production persistence path. Pages keeps `local` as a demo/offline fallback
 * so the static site still saves and shares (via deep links) without a live API.
 */
let remoteAvailable: boolean | null = null;

const persistenceModeListeners = new Set<() => void>();

function notifyPersistenceModeListeners(): void {
  for (const listener of persistenceModeListeners) listener();
}

function setRemoteAvailable(value: boolean): void {
  if (remoteAvailable === value) return;
  remoteAvailable = value;
  notifyPersistenceModeListeners();
}

/** Current persistence surface — safe to read from UI after bootstrap/save has run. */
export function getPersistenceMode(): PersistenceMode {
  if (remoteAvailable === null) return "unknown";
  return remoteAvailable ? "worker" : "local";
}

/** Subscribe to latch changes (`unknown` → `worker` | `local`). Returns an unsubscribe. */
export function subscribePersistenceMode(listener: () => void): () => void {
  persistenceModeListeners.add(listener);
  return () => {
    persistenceModeListeners.delete(listener);
  };
}

function indicatesMissingBackend(error: unknown, method: "GET" | "WRITE"): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === "network_error" || error.status === 405 || error.status === 501) return true;

  if (error.status === 404) {
    // A write can only 404 on a host that has no such route.
    if (method === "WRITE") return true;
    // A GET is ambiguous: the real API answers a genuinely missing record with the
    // `{ error: { code: "not_found" } }` envelope, while a static host serves its own HTML 404
    // page, which fails to parse and surfaces as "request_failed". Distinguishing the two is what
    // lets a resumed configuration fall through to the local store instead of being recreated —
    // which would strand the saved build on every refresh of the Pages deployment.
    return error.code !== "not_found";
  }

  return false;
}

async function withFallback<T>(
  method: "GET" | "WRITE",
  remote: () => Promise<T>,
  local: () => Promise<T>,
): Promise<T> {
  if (remoteAvailable === false) return local();

  try {
    const result = await remote();
    setRemoteAvailable(true);
    return result;
  } catch (error) {
    if (indicatesMissingBackend(error, method)) {
      setRemoteAvailable(false);
      console.info(
        "[configurations] No Worker/D1 backend detected; using local demo persistence (saves stay in this browser; share uses deep links).",
      );
      return local();
    }
    throw error;
  }
}

export interface CreateConfigurationInput {
  vehicleId: string;
  modelYear: number;
  gradeId: string;
  selections?: SelectionMap;
  cameraState?: CameraState;
}

export interface UpdateConfigurationInput {
  selections?: SelectionMap;
  cameraState?: CameraState;
  /** Optimistic concurrency: the revision the client believes it is editing. */
  expectedRevision?: number;
}

/**
 * Owner-token bookkeeping (lib/shared/ownerToken.ts).
 *
 * `createConfiguration` receives a plaintext capability token exactly once and remembers it here;
 * `updateConfiguration`/`deleteConfiguration` attach it automatically. This is deliberately invisible
 * to every caller above this module — `configurationStore.ts` and `BuilderApp.tsx` call
 * `updateConfiguration(id, patch)` exactly as before and need no awareness that a write is now
 * authenticated at all.
 */
const OWNER_TOKENS_STORAGE_KEY = "toyota-showroom:ownerTokens";
const OWNER_TOKEN_HEADER = "X-Owner-Token";

function readOwnerTokens(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(OWNER_TOKENS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function rememberOwnerToken(configurationId: string, ownerToken: string): void {
  try {
    const tokens = readOwnerTokens();
    tokens[configurationId] = ownerToken;
    window.localStorage.setItem(OWNER_TOKENS_STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // Best-effort: losing the token means a later write to this configuration gets rejected with
    // 403 rather than silently succeeding as an edit from whoever holds the id — a safe failure mode,
    // not a correctness bug.
  }
}

function ownerTokenFor(configurationId: string): string {
  return readOwnerTokens()[configurationId] ?? "";
}

function forgetOwnerToken(configurationId: string): void {
  try {
    const tokens = readOwnerTokens();
    delete tokens[configurationId];
    window.localStorage.setItem(OWNER_TOKENS_STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // Nothing to recover — the configuration itself is already gone.
  }
}

/**
 * The customization catalog is static data and is read from the generated snapshot, the same way
 * `lib/api/client.ts` reads vehicles. Grade filtering happens here because a static host cannot
 * vary a file by query string.
 */
export async function listVehicleOptions(vehicleId: string, gradeId?: string): Promise<CustomizationOption[]> {
  const { data } = await request<{ data: CustomizationOption[] }>(
    catalogUrl(`/vehicles/${encodeURIComponent(vehicleId)}/options`),
  );
  // Called through a lambda, not passed by reference: `Array.map` supplies the element index as a
  // second argument, which would land in `base` and prefix every URL with a number.
  const normalized = data.map((option) => normalizeOptionAssets(option));
  return gradeId ? normalized.filter((option) => isOptionAvailableForGrade(option, gradeId)) : normalized;
}

/**
 * Catalog data stores root-relative asset URLs. Under the GitHub Pages deployment the site is
 * mounted at a sub-path, so every URL a loader will consume needs the same prefix `lib/api/client.ts`
 * applies to vehicle media — otherwise a decal texture or replacement GLB is fetched from the domain
 * root and 404s the moment those options become contract-satisfied.
 */
export function normalizeOptionAssets(
  option: CustomizationOption,
  base: string = basePath,
): CustomizationOption {
  const withBase = (url: string) => (url.startsWith("/") ? `${base}${url}` : url);

  const next: CustomizationOption = { ...option };
  if (next.assetUrl) next.assetUrl = withBase(next.assetUrl);
  if (next.thumbnailUrl) next.thumbnailUrl = withBase(next.thumbnailUrl);
  if (next.materialConfig?.textureUrl) {
    next.materialConfig = {
      ...next.materialConfig,
      textureUrl: withBase(next.materialConfig.textureUrl),
    };
  }
  return next;
}

export async function createConfiguration(input: CreateConfigurationInput): Promise<VehicleConfiguration> {
  return withFallback(
    "WRITE",
    async () => {
      const { data, ownerToken } = await request<{ data: VehicleConfiguration; ownerToken: string }>(
        apiUrl("/configurations"),
        { method: "POST", body: JSON.stringify(input) },
      );
      rememberOwnerToken(data.configurationId, ownerToken);
      return data;
    },
    async () => {
      const { configuration, ownerToken } = await localConfigurationTransport.create(input);
      rememberOwnerToken(configuration.configurationId, ownerToken);
      return configuration;
    },
  );
}

export async function getConfiguration(configurationId: string): Promise<VehicleConfiguration> {
  return withFallback(
    "GET",
    async () => {
      const { data } = await request<{ data: VehicleConfiguration }>(
        apiUrl(`/configurations/${encodeURIComponent(configurationId)}`),
      );
      return data;
    },
    () => localConfigurationTransport.get(configurationId),
  );
}

export async function updateConfiguration(
  configurationId: string,
  input: UpdateConfigurationInput,
  options: { keepalive?: boolean } = {},
): Promise<VehicleConfiguration> {
  return withFallback(
    "WRITE",
    async () => {
      const { data } = await request<{ data: VehicleConfiguration }>(
        apiUrl(`/configurations/${encodeURIComponent(configurationId)}`),
        {
          method: "PATCH",
          body: JSON.stringify(input),
          // `keepalive` lets the request outlive the document during `pagehide`; browsers are free
          // to abort ordinary in-flight fetches as a page unloads, which would silently drop the
          // user's last click.
          keepalive: options.keepalive,
          headers: { [OWNER_TOKEN_HEADER]: ownerTokenFor(configurationId) },
        },
      );
      return data;
    },
    () => localConfigurationTransport.update(configurationId, input, ownerTokenFor(configurationId)),
  );
}

export async function deleteConfiguration(configurationId: string): Promise<void> {
  await withFallback(
    "WRITE",
    async () => {
      await request<unknown>(apiUrl(`/configurations/${encodeURIComponent(configurationId)}`), {
        method: "DELETE",
        headers: { [OWNER_TOKEN_HEADER]: ownerTokenFor(configurationId) },
      });
    },
    () => localConfigurationTransport.delete(configurationId, ownerTokenFor(configurationId)),
  );
  forgetOwnerToken(configurationId);
}

/** Test hook: forget the detected transport so each case starts from an unknown state. */
export function resetTransportDetection(): void {
  if (remoteAvailable !== null) {
    remoteAvailable = null;
    notifyPersistenceModeListeners();
  } else {
    remoteAvailable = null;
  }
}
