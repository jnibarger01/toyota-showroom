import { notFound, revisionConflict } from "./errors";
import {
  CUSTOMIZATION_SCHEMA_VERSION,
  type VehicleConfiguration,
} from "../types/customization";
import {
  validateCreateConfiguration,
  validatePatchConfiguration,
  type ValidatedPatch,
} from "../validation/configuration";

/**
 * Browser-local implementation of the configuration endpoints.
 *
 * This project deploys as a static export to GitHub Pages (`next.config.mjs` `output: "export"`),
 * where the `force-dynamic` configuration routes cannot run — the Cloudflare Worker build serves
 * them, the Pages build does not. Rather than degrade to "saving is broken on the demo", the client
 * falls back to this transport, which runs the *same* validators the server does.
 *
 * The consequence is that validation behaviour is identical in both modes; only durability differs
 * (per-browser rather than shared). Nothing here is a second source of truth for the catalog —
 * option records still come from the generated static catalog.
 */

const STORE_KEY = "toyota-showroom:configurations:v1";

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
  } catch {
    // Quota or private-browsing failures leave the in-session state intact; nothing to recover.
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
    return next;
  },

  async delete(configurationId: string): Promise<void> {
    const store = readStore();
    delete store[configurationId];
    writeStore(store);
  },
};
