import { asc, eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { configurationRevisions, configurations } from "../../db/schema";
import { notFound, revisionConflict } from "../api/errors";
import { CUSTOMIZATION_SCHEMA_VERSION, type VehicleConfiguration } from "../types/customization";
import type { ValidatedConfigurationInput, ValidatedPatch } from "../validation/configuration";
import type { ConfigurationRepository } from "./configurationRepository";

const RETRY_DELAYS_MS = [1_000, 2_000] as const;
type ConfigurationRow = typeof configurations.$inferSelect;

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function isTransientD1Error(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_BUSY|database is locked|temporarily unavailable|service unavailable|\b503\b/i.test(message);
}

async function withD1Retry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientD1Error(error) || attempt === RETRY_DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastError;
}

function changedRows(result: D1Result<unknown>): number {
  return typeof result.meta?.changes === "number" ? result.meta.changes : 0;
}

function toConfiguration(row: ConfigurationRow): VehicleConfiguration {
  return {
    configurationId: row.id,
    vehicleId: row.vehicleId,
    modelYear: row.modelYear,
    model: row.model,
    gradeId: row.gradeId,
    selections: row.selections,
    cameraState: row.cameraState ?? undefined,
    revision: row.revision,
    schemaVersion: row.schemaVersion,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export class D1ConfigurationRepository implements ConfigurationRepository {
  private readonly db: DrizzleD1Database;

  constructor(private readonly binding: D1Database) {
    this.db = drizzle(binding);
  }

  async create(input: ValidatedConfigurationInput): Promise<VehicleConfiguration> {
    const now = new Date();
    const record: VehicleConfiguration = {
      configurationId: newId("cfg"), vehicleId: input.vehicleId, modelYear: input.modelYear,
      model: input.model, gradeId: input.gradeId, selections: input.selections,
      cameraState: input.cameraState, revision: 1, schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    const selections = JSON.stringify(record.selections);
    const cameraState = record.cameraState ? JSON.stringify(record.cameraState) : null;
    const timestamp = now.getTime();
    await withD1Retry(() => this.binding.batch([
      this.binding.prepare(`INSERT INTO configurations
        (id, vehicle_id, model_year, model, grade_id, selections, camera_state, revision, schema_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          record.configurationId, record.vehicleId, record.modelYear, record.model, record.gradeId,
          selections, cameraState, record.revision, record.schemaVersion, timestamp, timestamp),
      this.binding.prepare(`INSERT INTO configuration_revisions
        (id, configuration_id, revision, selections, camera_state, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(
          newId("rev"), record.configurationId, record.revision, selections, cameraState, timestamp),
    ]));
    return record;
  }

  async get(configurationId: string): Promise<VehicleConfiguration | null> {
    const rows = await withD1Retry(() => this.db.select().from(configurations).where(eq(configurations.id, configurationId)).limit(1).all());
    return rows[0] ? toConfiguration(rows[0]) : null;
  }

  async update(configurationId: string, patch: ValidatedPatch): Promise<VehicleConfiguration> {
    const existing = await this.get(configurationId);
    if (!existing) throw notFound(`No configuration found with id "${configurationId}".`);
    if (patch.expectedRevision !== undefined && patch.expectedRevision !== existing.revision) {
      throw revisionConflict(`Configuration "${configurationId}" is at revision ${existing.revision}, not ${patch.expectedRevision}. Reload before retrying.`);
    }
    const now = new Date();
    const next: VehicleConfiguration = {
      ...existing, selections: patch.selections ?? existing.selections,
      cameraState: patch.cameraState ?? existing.cameraState,
      revision: existing.revision + 1, updatedAt: now.toISOString(),
    };
    const selections = JSON.stringify(next.selections);
    const cameraState = next.cameraState ? JSON.stringify(next.cameraState) : null;
    const [updateResult, historyResult] = await withD1Retry(() => this.binding.batch([
      this.binding.prepare(`UPDATE configurations SET selections = ?, camera_state = ?, revision = ?, updated_at = ?
        WHERE id = ? AND revision = ?`).bind(selections, cameraState, next.revision, now.getTime(), configurationId, existing.revision),
      this.binding.prepare(`INSERT INTO configuration_revisions
        (id, configuration_id, revision, selections, camera_state, created_at)
        SELECT ?, id, ?, ?, ?, ? FROM configurations WHERE id = ? AND revision = ?`).bind(
          newId("rev"), next.revision, selections, cameraState, now.getTime(), configurationId, next.revision),
    ]));
    if (changedRows(updateResult) !== 1 || changedRows(historyResult) !== 1) {
      const current = await this.get(configurationId);
      if (!current) throw notFound(`No configuration found with id "${configurationId}".`);
      throw revisionConflict(`Configuration "${configurationId}" changed concurrently and is now at revision ${current.revision}. Reload before retrying.`);
    }
    return next;
  }

  async delete(configurationId: string): Promise<boolean> {
    const [, deleteResult] = await withD1Retry(() => this.binding.batch([
      this.binding.prepare("DELETE FROM configuration_revisions WHERE configuration_id = ?").bind(configurationId),
      this.binding.prepare("DELETE FROM configurations WHERE id = ?").bind(configurationId),
    ]));
    return changedRows(deleteResult) > 0;
  }

  async listRevisions(configurationId: string): Promise<VehicleConfiguration[]> {
    const current = await this.get(configurationId);
    if (!current) return [];
    const rows = await withD1Retry(() => this.db.select().from(configurationRevisions)
      .where(eq(configurationRevisions.configurationId, configurationId))
      .orderBy(asc(configurationRevisions.revision)).all());
    return rows.map((row) => ({
      ...current,
      selections: row.selections,
      cameraState: row.cameraState ?? undefined,
      revision: row.revision,
      createdAt: current.createdAt,
      updatedAt: new Date(row.createdAt).toISOString(),
    }));
  }
}
