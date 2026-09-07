import { ApiError, forbidden, notFound, revisionConflict } from "./errors";
import {
  CUSTOMIZATION_SCHEMA_VERSION,
  type VehicleConfiguration,
} from "../types/customization";
import {
  validateCreateConfiguration,
  validatePatchConfiguration,
  type ValidatedPatch,
} from "../validation/configuration";
import { generateOwnerToken, hashOwnerToken, verifyOwnerToken } from "../shared/ownerToken";

const STORE_KEY = "toyota-showroom:configurations:v1";
const RECOVERY_KEY = "toyota-showroom:recovery:v1";

interface StoredRecord {
  configuration: VehicleConfiguration;
  /** Mirrors the real API's storage shape (lib/shared/ownerToken.ts) — never the plaintext token. */
  ownerTokenHash: string;
}

type Store = Record<string, StoredRecord>;

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
  async create(input: unknown): Promise<{ configuration: VehicleConfiguration; ownerToken: string }> {
    const validated = validateCreateConfiguration(input);
    const now = new Date().toISOString();
    const configuration: VehicleConfiguration = {
      configurationId: newId(),
      vehicleId: validated.vehicleId,
      modelYear: validated.modelYear,
      model: validated.model,
      gradeId: validated.gradeId,
      selections: validated.selections,
      cameraState: validated.cameraState,
      paintStudio: validated.paintStudio,
      revision: 1,
      schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    };

    const ownerToken = generateOwnerToken();
    const ownerTokenHash = await hashOwnerToken(ownerToken);

    const store = readStore();
    store[configuration.configurationId] = { configuration, ownerTokenHash };
    writeStore(store);
    return { configuration, ownerToken };
  },

  async get(configurationId: string): Promise<VehicleConfiguration> {
    const record = readStore()[configurationId];
    if (!record) throw notFound(`No configuration found with id "${configurationId}".`);
    return record.configuration;
  },

  async update(configurationId: string, patch: unknown, ownerToken: string): Promise<VehicleConfiguration> {
    const store = readStore();
    const stored = store[configurationId];
    if (!stored) throw notFound(`No configuration found with id "${configurationId}".`);

    if (!(await verifyOwnerToken(ownerToken, stored.ownerTokenHash))) {
      throw forbidden(`Owner token missing or does not match for configuration "${configurationId}".`);
    }

    const existing = stored.configuration;
    const validated: ValidatedPatch = validatePatchConfiguration(patch, {
      vehicleId: existing.vehicleId,
      gradeId: existing.gradeId,
      selections: existing.selections,
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
      paintStudio: validated.paintStudio ?? existing.paintStudio,
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
    };

    store[configurationId] = { configuration: next, ownerTokenHash: stored.ownerTokenHash };
    writeStore(store);
    this.clearRecovery(configurationId);
    return next;
  },

  async delete(configurationId: string, ownerToken: string): Promise<void> {
    const store = readStore();
    const stored = store[configurationId];
    if (!stored) return; // matches the server: deleting an already-gone id is not an error here

    if (!(await verifyOwnerToken(ownerToken, stored.ownerTokenHash))) {
      throw forbidden(`Owner token missing or does not match for configuration "${configurationId}".`);
    }

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

  /**
   * Every configuration currently in this browser's local store — used by the multi-vehicle garage
   * to list builds when Worker/D1 is unavailable. Read-only; does not require owner tokens.
   */
  list(): VehicleConfiguration[] {
    return Object.values(readStore()).map((record) => record.configuration);
  },
};
