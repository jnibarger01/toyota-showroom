import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import type { PaintStudioState } from "../lib/types/paintStudio";

/**
 * Persisted vehicle configurations.
 *
 * `selections` holds a category-keyed map of stable option ids. Nothing derived from the 3D
 * asset — node names, material names, GLB paths — is stored here: those live in the server-side
 * catalog and are resolved on read, so re-authoring the model never invalidates saved builds.
 */
export const configurations = sqliteTable(
  "configurations",
  {
    id: text("id").primaryKey(),
    vehicleId: text("vehicle_id").notNull(),
    modelYear: integer("model_year").notNull(),
    model: text("model").notNull(),
    gradeId: text("grade_id").notNull(),
    /**
     * SHA-256 of the capability token returned to the creator once, at POST time
     * (lib/shared/ownerToken.ts). Never the plaintext token — a leaked database export must not
     * itself grant write access to every configuration in it. PATCH/DELETE require the caller to
     * present the plaintext; GET stays open so the sharing feature keeps working unauthenticated.
     */
    ownerTokenHash: text("owner_token_hash").notNull(),
    selections: text("selections", { mode: "json" }).notNull().$type<Record<string, string[]>>(),
    cameraState: text("camera_state", { mode: "json" }).$type<{
      presetId?: string;
      position: [number, number, number];
      target: [number, number, number];
    } | null>(),
    /** OEM vs custom paint studio — schema-safe material params + HDRI preset ids (no GLB names). */
    paintStudio: text("paint_studio", { mode: "json" }).$type<PaintStudioState | null>(),
    /** Incremented on every accepted mutation; drives optimistic-concurrency checks. */
    revision: integer("revision").notNull().default(1),
    schemaVersion: text("schema_version").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("configurations_vehicle_idx").on(table.vehicleId)],
);

/**
 * Append-only history. One row per accepted mutation, holding the full post-mutation selection
 * map, so a configuration can be audited or rolled back to any prior revision.
 */
export const configurationRevisions = sqliteTable(
  "configuration_revisions",
  {
    id: text("id").primaryKey(),
    configurationId: text("configuration_id").notNull(),
    revision: integer("revision").notNull(),
    selections: text("selections", { mode: "json" }).notNull().$type<Record<string, string[]>>(),
    cameraState: text("camera_state", { mode: "json" }),
    paintStudio: text("paint_studio", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("configuration_revisions_config_idx").on(table.configurationId, table.revision)],
);
