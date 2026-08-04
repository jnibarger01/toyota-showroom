CREATE TABLE `builds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`year` integer NOT NULL,
	`trim` text NOT NULL,
	`paint` text NOT NULL,
	`lift` integer DEFAULT 0 NOT NULL,
	`roof_rack` integer DEFAULT false NOT NULL,
	`light_bar` integer DEFAULT false NOT NULL,
	`sliders` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `camera_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`build_id` text NOT NULL,
	`name` text NOT NULL,
	`position` text NOT NULL,
	`target` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `configuration_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`configuration_id` text NOT NULL,
	`revision` integer NOT NULL,
	`selections` text NOT NULL,
	`camera_state` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `configuration_revisions_config_idx` ON `configuration_revisions` (`configuration_id`,`revision`);--> statement-breakpoint
CREATE TABLE `configurations` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`model_year` integer NOT NULL,
	`model` text NOT NULL,
	`grade_id` text NOT NULL,
	`owner_token_hash` text NOT NULL,
	`selections` text NOT NULL,
	`camera_state` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`schema_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `configurations_vehicle_idx` ON `configurations` (`vehicle_id`);