import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull()
});

export const cameraPresets = sqliteTable("camera_presets", {
  id: text("id").primaryKey(),
  buildId: text("build_id").notNull(),
  name: text("name").notNull(),
  position: text("position", { mode: "json" }).notNull(),
  target: text("target", { mode: "json" }).notNull()
});
