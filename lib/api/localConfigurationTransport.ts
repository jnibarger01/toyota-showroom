import { ApiError, notFound, revisionConflict } from "./errors";
import {
  CUSTOMIZATION_SCHEMA_VERSION,
  type VehicleConfiguration,
} from "../types/customization";
import {
  validateCreateConfiguration,
  validatePatchConfiguration,
  type ValidatedPatch,
} from "../validation/configuration";

const STORE_KEY = "toyota-showroom:configurations:v1";
const RECOVERY_KEY = "toyota-showroom:recovery:v1";

type Store = Record<string, VehicleConfiguration>;

function readStore(): Store {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (cause) {
    throw new ApiError(
      507,
      "local_persistence_failed",
      "This browser could not persist the configuration. The current view is not durable across reloads.",
      { cause },
    );
  }
}

function newId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `cfg_${random.replace(/-/g, "").slice(0, 20)}`;
}

export const localConfigurationTransport = {
  async create(input: unknown): Promise<VehicleConfiguration> {
    const validated = validateCreateConfiguration(input);
    const now = new Date().toISOString();
    const record: VehicleConfiguration = {
      configurationId: newId(),
      vehicleId: validated.vehicleId,
      modelYear: validated.modelYear,
      model: validated.model,
      gradeId: validated.gradeId,
      selections: validated.selections,
      cameraState: validated.cameraState,
      revision: 1,
      schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    };

    const store = readStore();
    store[record.configurationId] = record;
    writeStore(store);
    return record;
  },

  has(configurationId: string): boolean {
    return Boolean(readStore()[configurationId]);
  },

  seed(configuration: VehicleConfiguration): void {
    const store = readStore();
    store[configuration.configurationId] = configuration;
    writeStore(store);
  },

  async get(configurationId: string): Promise<VehicleConfiguration> {
    const record = readStore()[configurationId];
    if (!record) throw notFound(`No configuration found with id "${configurationId}".`);
    return record;
  },

  async update(configurationId: string, patch: unknown): Promise<VehicleConfiguration> {
    const store = readStore();
    const existing = store[configurationId];
    if (!existing) throw notFound(`No configuration found with id "${configurationId}".`);

    const validated: ValidatedPatch = validatePatchConfiguration(patch, {
      vehicleId: existing.vehicleId,
      gradeId: existing.gradeId,
    });

    if (validated.expectedRevision !== undefined && validated.expectedRevision !== existing.revision) {
      throw revisionConflict(
        `Configuration "${configurationId}" is at revision ${existing.revision}, not ${validated.expectedRevision}.`,
      );
    }

    const next: VehicleConfiguration = {
      ...existing,
      selections: validated.selections ?? existing.selections,
      cameraState: validated.cameraState ?? existing.cameraState,
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
    };

    store[configurationId] = next;
    writeStore(store);
    this.clearRecovery(configurationId);
    return next;
  },

  async delete(configurationId: string): Promise<void> {
    const store = readStore();
    delete store[configurationId];
    writeStore(store);
    this.clearRecovery(configurationId);
  },

  saveRecovery(configuration: VehicleConfiguration): void {
    try {
      window.localStorage.setItem(RECOVERY_KEY, JSON.stringify(configuration));
    } catch {
      // Best-effort crash recovery only. Normal persistence still reports failures explicitly.
    }
  },

  readRecovery(configurationId: string): VehicleConfiguration | null {
    try {
      const raw = window.localStorage.getItem(RECOVERY_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw) as VehicleConfiguration;
      return value.configurationId === configurationId ? value : null;
    } catch {
      return null;
    }
  },

  clearRecovery(configurationId: string): void {
    try {
      const recovered = this.readRecovery(configurationId);
      if (recovered) window.localStorage.removeItem(RECOVERY_KEY);
    } catch {
      // Recovery cleanup must never turn a successful durable write into an error.
    }
  },
};
