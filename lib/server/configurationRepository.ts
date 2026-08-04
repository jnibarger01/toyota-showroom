import { CUSTOMIZATION_SCHEMA_VERSION, type VehicleConfiguration } from "../types/customization";
import type { ValidatedConfigurationInput, ValidatedPatch } from "../validation/configuration";
import { forbidden, notFound, revisionConflict } from "../api/errors";
import { generateOwnerToken, hashOwnerToken, verifyOwnerToken } from "../shared/ownerToken";
import { newId } from "../shared/id";

/**
 * Persistence boundary for configurations.
 *
 * Route handlers depend on this interface, never on Drizzle directly, so the same handlers run
 * against D1 in the deployed Worker and against the in-memory store in `npm run dev` and in tests.
 * Revision bumping, history appending, and owner-token verification all live here rather than in the
 * handlers, so no caller can write a configuration without also recording its revision, and no
 * implementation can accidentally skip the ownership check on a write path.
 */
export interface ConfigurationRepository {
  /** Returns the created record plus its plaintext capability token — the only time it is ever seen. */
  create(input: ValidatedConfigurationInput): Promise<{ configuration: VehicleConfiguration; ownerToken: string }>;
  /** Unauthenticated by design: reads are what the sharing feature depends on. */
  get(configurationId: string): Promise<VehicleConfiguration | null>;
  /** Throws `forbidden()` if `ownerToken` doesn't match the record's stored hash. */
  update(configurationId: string, patch: ValidatedPatch, ownerToken: string): Promise<VehicleConfiguration>;
  /** Throws `forbidden()` if `ownerToken` doesn't match; returns `false` only for a genuinely missing id. */
  delete(configurationId: string, ownerToken: string): Promise<boolean>;
  listRevisions(configurationId: string): Promise<VehicleConfiguration[]>;
}

interface StoredRecord {
  configuration: VehicleConfiguration;
  ownerTokenHash: string;
}

export class InMemoryConfigurationRepository implements ConfigurationRepository {
  private readonly records = new Map<string, StoredRecord>();
  private readonly history = new Map<string, VehicleConfiguration[]>();

  async create(input: ValidatedConfigurationInput): Promise<{ configuration: VehicleConfiguration; ownerToken: string }> {
    const now = new Date().toISOString();
    const configuration: VehicleConfiguration = {
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

    const ownerToken = generateOwnerToken();
    const ownerTokenHash = await hashOwnerToken(ownerToken);

    this.records.set(configuration.configurationId, { configuration, ownerTokenHash });
    this.history.set(configuration.configurationId, [configuration]);
    return { configuration, ownerToken };
  }

  async get(configurationId: string): Promise<VehicleConfiguration | null> {
    return this.records.get(configurationId)?.configuration ?? null;
  }

  async update(configurationId: string, patch: ValidatedPatch, ownerToken: string): Promise<VehicleConfiguration> {
    const stored = this.records.get(configurationId);
    if (!stored) throw notFound(`No configuration found with id "${configurationId}".`);

    if (!(await verifyOwnerToken(ownerToken, stored.ownerTokenHash))) {
      throw forbidden(`Owner token missing or does not match for configuration "${configurationId}".`);
    }

    const existing = stored.configuration;
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

    this.records.set(configurationId, { configuration: next, ownerTokenHash: stored.ownerTokenHash });
    this.history.get(configurationId)?.push(next);
    return next;
  }

  async delete(configurationId: string, ownerToken: string): Promise<boolean> {
    const stored = this.records.get(configurationId);
    if (!stored) return false;

    if (!(await verifyOwnerToken(ownerToken, stored.ownerTokenHash))) {
      throw forbidden(`Owner token missing or does not match for configuration "${configurationId}".`);
    }

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
