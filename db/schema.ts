import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Legacy prototype tables. Superseded by `configurations` below, which stores selections as
 * catalog option ids rather than as one column per feature — adding a customization category no
 * longer requires a migration. Retained until the prototype builds are migrated across.
 */
export const builds = sqliteTable("builds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  year: integer("year").notNull(),
  trim: text("trim").notNull(),
  paint: text("paint").notNull(),
  lift: integer("lift").notNull().default(0),
  roofRack: integer("roof_rack", { mode: "boolean" }).notNull().default(false),
  lightBar: integer("light_bar", { mode: "boolean" }).notNull().default(false),
  sliders: integer("sliders", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const cameraPresets = sqliteTable("camera_presets", {
  id: text("id").primaryKey(),
  buildId: text("build_id").notNull(),
  name: text("name").notNull(),
  position: text("position", { mode: "json" }).notNull(),
  target: text("target", { mode: "json" }).notNull(),
});

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
    selections: text("selections", { mode: "json" }).notNull().$type<Record<string, string[]>>(),
    cameraState: text("camera_state", { mode: "json" }).$type<{
      presetId?: string;
      position: [number, number, number];
      target: [number, number, number];
    } | null>(),
    /** Incremented on every accepted mutation; drives optimistic-concurrency checks. */
    revision: integer("revision").notNull().default(1),
    schemaVersion: text("schema_version").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("configurations_vehicle_idx").on(table.vehicleId),
    index("configurations_updated_at_idx").on(table.updatedAt),
  ],
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
    cameraState: text("camera_state", { mode: "json" }).$type<{
      presetId?: string;
      position: [number, number, number];
      target: [number, number, number];
    } | null>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("configuration_revisions_unique_idx").on(table.configurationId, table.revision),
  ],
);
