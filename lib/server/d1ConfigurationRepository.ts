import { and, asc, eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
// Scoped to this file rather than added to tsconfig.json's global `types` — the rest of the
// project mixes browser-side React components (needing `lib.dom.d.ts`) with this server-only
// module in one tsconfig, and Workers' ambient globals (Request/Response/fetch/crypto) redefine
// enough of the same names as `dom` that injecting them project-wide risks real conflicts.
import type { D1Database } from "@cloudflare/workers-types";
import { configurationRevisions, configurations } from "../../db/schema";
import {
  CUSTOMIZATION_SCHEMA_VERSION,
  type CameraState,
  type SelectionMap,
  type VehicleConfiguration,
} from "../types/customization";
import type { ValidatedConfigurationInput, ValidatedPatch } from "../validation/configuration";
import { forbidden, notFound, revisionConflict } from "../api/errors";
import { generateOwnerToken, hashOwnerToken, verifyOwnerToken } from "../shared/ownerToken";
import { newId } from "../shared/id";
import type { ConfigurationRepository } from "./configurationRepository";

/**
 * D1-backed `ConfigurationRepository`, bound from the Worker entry point via
 * `setConfigurationRepository(new D1ConfigurationRepository(env.DB))` once `wrangler.jsonc`'s "DB"
 * binding resolves to a real database. Every method here has behavior parity with
 * `InMemoryConfigurationRepository` — same error conditions, same check ordering (existence before
 * ownership before revision) — verified against a real local D1 instance in
 * tests/d1ConfigurationRepository.test.ts via `wrangler`'s `getPlatformProxy()`, not just typechecked.
 *
 * D1 does not offer interactive multi-round-trip transactions the way a traditional RDBMS
 * connection does; its actual atomicity primitive is `db.batch([...])`, an all-or-nothing group of
 * pre-built statements. Every write here that touches both `configurations` and
 * `configuration_revisions` goes through `batch` so a mid-write failure can't leave the two tables
 * inconsistent. The preceding read (to decide whether to 404/403/409) is a separate statement, which
 * is a real, accepted narrowing versus full ACID: a write racing in between the read and the batch
 * would still be caught by D1 rejecting a stale `expectedRevision` when one is supplied, but an
 * unconditioned update (no `expectedRevision`) has the same last-write-wins behavior as the
 * in-memory repository it matches — not a regression introduced by moving to D1.
 */
export class D1ConfigurationRepository implements ConfigurationRepository {
  private readonly db: DrizzleD1Database;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  async create(input: ValidatedConfigurationInput): Promise<{ configuration: VehicleConfiguration; ownerToken: string }> {
    const now = new Date();
    const configurationId = newId("cfg");
    const ownerToken = generateOwnerToken();
    const ownerTokenHash = await hashOwnerToken(ownerToken);
    const selections = input.selections;
    const cameraState = input.cameraState ?? null;

    await this.db.batch([
      this.db.insert(configurations).values({
        id: configurationId,
        vehicleId: input.vehicleId,
        modelYear: input.modelYear,
        model: input.model,
        gradeId: input.gradeId,
        ownerTokenHash,
        selections,
        cameraState,
        revision: 1,
        schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
      }),
      this.db.insert(configurationRevisions).values({
        id: newId("rev"),
        configurationId,
        revision: 1,
        selections,
        cameraState,
        createdAt: now,
      }),
    ]);

    return {
      configuration: {
        configurationId,
        vehicleId: input.vehicleId,
        modelYear: input.modelYear,
        model: input.model,
        gradeId: input.gradeId,
        selections,
        cameraState: cameraState ?? undefined,
        revision: 1,
        schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      ownerToken,
    };
  }

  async get(configurationId: string): Promise<VehicleConfiguration | null> {
    const row = await this.selectRow(configurationId);
    return row ? this.toVehicleConfiguration(row) : null;
  }

  async update(configurationId: string, patch: ValidatedPatch, ownerToken: string): Promise<VehicleConfiguration> {
    const row = await this.selectRow(configurationId);
    if (!row) throw notFound(`No configuration found with id "${configurationId}".`);

    if (!(await verifyOwnerToken(ownerToken, row.ownerTokenHash))) {
      throw forbidden(`Owner token missing or does not match for configuration "${configurationId}".`);
    }

    if (patch.expectedRevision !== undefined && patch.expectedRevision !== row.revision) {
      throw revisionConflict(
        `Configuration "${configurationId}" is at revision ${row.revision}, not ${patch.expectedRevision}. Reload before retrying.`,
      );
    }

    const now = new Date();
    const nextRevision = row.revision + 1;
    const nextSelections = patch.selections ?? row.selections;
    const nextCameraState = patch.cameraState ?? row.cameraState;

    const updateStatement = this.db
      .update(configurations)
      .set({ selections: nextSelections, cameraState: nextCameraState, revision: nextRevision, updatedAt: now })
      // `AND revision = row.revision` costs nothing and closes most of the narrow race window
      // documented on the class: if another write slipped in between the read above and this
      // statement, this condition fails to match and the batch's second statement (below) would
      // record a revision the `configurations` row never actually reached — so it is paired with
      // the same guard rather than left to run unconditionally.
      .where(and(eq(configurations.id, configurationId), eq(configurations.revision, row.revision)));

    const insertRevisionStatement = this.db.insert(configurationRevisions).values({
      id: newId("rev"),
      configurationId,
      revision: nextRevision,
      selections: nextSelections,
      cameraState: nextCameraState,
      createdAt: now,
    });

    const [updateResult] = await this.db.batch([updateStatement, insertRevisionStatement]);
    if (updateResult.meta.changes === 0) {
      // The row existed and matched at read time but no longer matches at write time — a genuine
      // concurrent writer won the race. Report it the same way a stale `expectedRevision` is
      // reported; the caller's retry-with-reload path is identical either way.
      throw revisionConflict(
        `Configuration "${configurationId}" changed concurrently. Reload before retrying.`,
      );
    }

    return this.toVehicleConfiguration({
      ...row,
      selections: nextSelections,
      cameraState: nextCameraState,
      revision: nextRevision,
      updatedAt: now,
    });
  }

  async delete(configurationId: string, ownerToken: string): Promise<boolean> {
    const row = await this.selectRow(configurationId);
    if (!row) return false;

    if (!(await verifyOwnerToken(ownerToken, row.ownerTokenHash))) {
      throw forbidden(`Owner token missing or does not match for configuration "${configurationId}".`);
    }

    await this.db.batch([
      this.db.delete(configurationRevisions).where(eq(configurationRevisions.configurationId, configurationId)),
      this.db.delete(configurations).where(eq(configurations.id, configurationId)),
    ]);
    return true;
  }

  async listRevisions(configurationId: string): Promise<VehicleConfiguration[]> {
    const parent = await this.selectRow(configurationId);
    if (!parent) return [];

    const rows = await this.db
      .select()
      .from(configurationRevisions)
      .where(eq(configurationRevisions.configurationId, configurationId))
      .orderBy(asc(configurationRevisions.revision));

    return rows.map((revisionRow) => ({
      configurationId,
      vehicleId: parent.vehicleId,
      modelYear: parent.modelYear,
      model: parent.model,
      gradeId: parent.gradeId,
      selections: revisionRow.selections as SelectionMap,
      cameraState: (revisionRow.cameraState as CameraState | null) ?? undefined,
      revision: revisionRow.revision,
      schemaVersion: parent.schemaVersion,
      // `configurations.createdAt` is never touched by `update()`, so it is still the original
      // creation time here regardless of which revision this snapshot represents; each revision
      // row's own `createdAt` is when *that* revision was written, i.e. this snapshot's `updatedAt`.
      createdAt: parent.createdAt.toISOString(),
      updatedAt: revisionRow.createdAt.toISOString(),
    }));
  }

  private async selectRow(configurationId: string) {
    const rows = await this.db.select().from(configurations).where(eq(configurations.id, configurationId)).limit(1);
    return rows[0] ?? null;
  }

  private toVehicleConfiguration(row: Awaited<ReturnType<D1ConfigurationRepository["selectRow"]>> & object): VehicleConfiguration {
    return {
      configurationId: row.id,
      vehicleId: row.vehicleId,
      modelYear: row.modelYear,
      model: row.model,
      gradeId: row.gradeId,
      selections: row.selections as SelectionMap,
      cameraState: (row.cameraState as CameraState | null) ?? undefined,
      revision: row.revision,
      schemaVersion: row.schemaVersion,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
