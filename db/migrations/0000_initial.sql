CREATE TABLE IF NOT EXISTS `builds` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `year` integer NOT NULL,
  `trim` text NOT NULL,
  `paint` text NOT NULL,
  `lift` integer DEFAULT 0 NOT NULL,
  `roof_rack` integer DEFAULT 0 NOT NULL,
  `light_bar` integer DEFAULT 0 NOT NULL,
  `sliders` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `camera_presets` (
  `id` text PRIMARY KEY NOT NULL,
  `build_id` text NOT NULL,
  `name` text NOT NULL,
  `position` text NOT NULL,
  `target` text NOT NULL
);

CREATE TABLE IF NOT EXISTS `configurations` (
  `id` text PRIMARY KEY NOT NULL,
  `vehicle_id` text NOT NULL,
  `model_year` integer NOT NULL,
  `model` text NOT NULL,
  `grade_id` text NOT NULL,
  `selections` text NOT NULL,
  `camera_state` text,
  `revision` integer DEFAULT 1 NOT NULL,
  `schema_version` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `configurations_vehicle_idx`
  ON `configurations` (`vehicle_id`);

CREATE INDEX IF NOT EXISTS `configurations_updated_at_idx`
  ON `configurations` (`updated_at`);

CREATE TABLE IF NOT EXISTS `configuration_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `configuration_id` text NOT NULL,
  `revision` integer NOT NULL,
  `selections` text NOT NULL,
  `camera_state` text,
  `created_at` integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `configuration_revisions_unique_idx`
  ON `configuration_revisions` (`configuration_id`, `revision`);
