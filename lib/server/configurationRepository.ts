import { CUSTOMIZATION_SCHEMA_VERSION, type VehicleConfiguration } from "../types/customization";
import type { ValidatedConfigurationInput, ValidatedPatch } from "../validation/configuration";
import { notFound, revisionConflict } from "../api/errors";

/**
 * Persistence boundary for configurations.
 *
 * Route handlers depend on this interface, never on Drizzle directly, so the same handlers run
 * against D1 in the deployed Worker and against the in-memory store in `npm run dev` and in tests.
 * Revision bumping and history appending live here rather than in the handlers, so no caller can
 * write a configuration without also recording its revision.
 */
export interface ConfigurationRepository {
  create(input: ValidatedConfigurationInput): Promise<VehicleConfiguration>;
  get(configurationId: string): Promise<VehicleConfiguration | null>;
  update(configurationId: string, patch: ValidatedPatch): Promise<VehicleConfiguration>;
  delete(configurationId: string): Promise<boolean>;
  listRevisions(configurationId: string): Promise<VehicleConfiguration[]>;
}

function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${random.replace(/-/g, "").slice(0, 20)}`;
}

export class InMemoryConfigurationRepository implements ConfigurationRepository {
  private readonly records = new Map<string, VehicleConfiguration>();
  private readonly history = new Map<string, VehicleConfiguration[]>();

  async create(input: ValidatedConfigurationInput): Promise<VehicleConfiguration> {
    const now = new Date().toISOString();
    const record: VehicleConfiguration = {
      configurationId: newId("cfg"),
      vehicleId: input.vehicleId,
      modelYear: input.modelYear,
      model: input.model,
      gradeId: input.gradeId,
      selections: input.selections,
      cameraState: input.cameraState,
      revision: 1,
      schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.configurationId, record);
    this.history.set(record.configurationId, [record]);
    return record;
  }

  async get(configurationId: string): Promise<VehicleConfiguration | null> {
    return this.records.get(configurationId) ?? null;
  }

  async update(configurationId: string, patch: ValidatedPatch): Promise<VehicleConfiguration> {
    const existing = this.records.get(configurationId);
    if (!existing) throw notFound(`No configuration found with id "${configurationId}".`);

    if (patch.expectedRevision !== undefined && patch.expectedRevision !== existing.revision) {
      throw revisionConflict(
        `Configuration "${configurationId}" is at revision ${existing.revision}, not ${patch.expectedRevision}. Reload before retrying.`,
      );
    }

    const next: VehicleConfiguration = {
      ...existing,
      selections: patch.selections ?? existing.selections,
      cameraState: patch.cameraState ?? existing.cameraState,
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
    };

    this.records.set(configurationId, next);
    this.history.get(configurationId)?.push(next);
    return next;
  }

  async delete(configurationId: string): Promise<boolean> {
    this.history.delete(configurationId);
    return this.records.delete(configurationId);
  }

  async listRevisions(configurationId: string): Promise<VehicleConfiguration[]> {
    return [...(this.history.get(configurationId) ?? [])];
  }

  /** Test helper — drops all state between cases. */
  clear(): void {
    this.records.clear();
    this.history.clear();
  }
}

let repository: ConfigurationRepository = new InMemoryConfigurationRepository();

export function getConfigurationRepository(): ConfigurationRepository {
  return repository;
}

/**
 * Swap in the D1-backed implementation from the Worker entry point once a binding is available.
 * Left as an explicit call rather than environment sniffing so tests and dev never accidentally
 * bind to a real database.
 */
export function setConfigurationRepository(next: ConfigurationRepository): void {
  repository = next;
}
