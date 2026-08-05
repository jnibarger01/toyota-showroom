import { CUSTOMIZATION_SCHEMA_VERSION, type VehicleConfiguration } from "../types/customization";
import type { ValidatedConfigurationInput, ValidatedPatch } from "../validation/configuration";
import { notFound, revisionConflict, serviceUnavailable } from "../api/errors";
import { getD1Binding, getWorkerEnv } from "./cloudflareEnv";
import { D1ConfigurationRepository } from "./d1ConfigurationRepository";

/**
 * Persistence boundary for configurations.
 *
 * Route handlers depend on this interface, never on Drizzle directly, so the same handlers run
 * against D1 in the deployed Worker and against the in-memory store in Node/Vitest. Revision
 * bumping and history appending live here rather than in handlers.
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

let repository: ConfigurationRepository | undefined;
let repositoryPromise: Promise<ConfigurationRepository> | undefined;

/**
 * Resolve the production repository lazily inside a request. Cloudflare bindings cannot perform
 * I/O during isolate initialization, and Node/Vitest does not provide `cloudflare:workers`.
 */
export function getConfigurationRepository(): Promise<ConfigurationRepository> {
  if (repository) return Promise.resolve(repository);

  repositoryPromise ??= Promise.all([getWorkerEnv(), getD1Binding()]).then(([workerEnv, binding]) => {
    if (binding) {
      repository = new D1ConfigurationRepository(binding);
      return repository;
    }

    if (workerEnv) {
      throw serviceUnavailable("The D1 binding is required for configuration persistence in the Worker runtime.");
    }

    repository = new InMemoryConfigurationRepository();
    return repository;
  });

  return repositoryPromise;
}

/** Explicit test/dev override. */
export function setConfigurationRepository(next: ConfigurationRepository): void {
  repository = next;
  repositoryPromise = Promise.resolve(next);
}
