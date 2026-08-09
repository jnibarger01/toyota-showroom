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
    throw new ApiError(0, "network_error", "Could not reach the configuration service.", { cause });
  }

  if (!response.ok) {
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

let remoteAvailable: boolean | null = null;

function indicatesMissingBackend(error: unknown, method: "GET" | "WRITE"): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === "network_error" || error.status === 405 || error.status === 501) return true;
  if (method === "WRITE" && (error.status === 401 || error.status === 403 || error.status === 404)) return true;
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
    remoteAvailable = true;
    return result;
  } catch (error) {
    if (indicatesMissingBackend(error, method)) {
      remoteAvailable = false;
      console.info(
        "[configurations] Remote configuration writes are unavailable or protected; persisting configurations in this browser instead.",
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
  expectedRevision?: number;
}

export async function listVehicleOptions(vehicleId: string, gradeId?: string): Promise<CustomizationOption[]> {
  const { data } = await request<{ data: CustomizationOption[] }>(
    catalogUrl(`/vehicles/${encodeURIComponent(vehicleId)}/options`),
  );
  return gradeId ? data.filter((option) => isOptionAvailableForGrade(option, gradeId)) : data;
}

export async function createConfiguration(input: CreateConfigurationInput): Promise<VehicleConfiguration> {
  return withFallback(
    "WRITE",
    async () => {
      const { data } = await request<{ data: VehicleConfiguration }>(apiUrl("/configurations"), {
        method: "POST",
        body: JSON.stringify(input),
      });
      localConfigurationTransport.seed(data);
      return data;
    },
    () => localConfigurationTransport.create(input),
  );
}

export async function getConfiguration(configurationId: string): Promise<VehicleConfiguration> {
  try {
    const { data } = await request<{ data: VehicleConfiguration }>(
      apiUrl(`/configurations/${encodeURIComponent(configurationId)}`),
    );
    localConfigurationTransport.seed(data);
    return data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && localConfigurationTransport.has(configurationId)) {
      return localConfigurationTransport.get(configurationId);
    }
    throw error;
  }
}

export async function updateConfiguration(
  configurationId: string,
  input: UpdateConfigurationInput,
): Promise<VehicleConfiguration> {
  return withFallback(
    "WRITE",
    async () => {
      const { data } = await request<{ data: VehicleConfiguration }>(
        apiUrl(`/configurations/${encodeURIComponent(configurationId)}`),
        { method: "PATCH", body: JSON.stringify(input) },
      );
      localConfigurationTransport.seed(data);
      return data;
    },
    () => localConfigurationTransport.update(configurationId, input),
  );
}

export async function deleteConfiguration(configurationId: string): Promise<void> {
  return withFallback(
    "WRITE",
    async () => {
      await request<unknown>(apiUrl(`/configurations/${encodeURIComponent(configurationId)}`), {
        method: "DELETE",
      });
    },
    () => localConfigurationTransport.delete(configurationId),
  );
}

export function resetTransportDetection(): void {
  remoteAvailable = null;
}
