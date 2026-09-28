ALTER TABLE `configurations` ADD `factory_package_ids` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `configuration_revisions` ADD `factory_package_ids` text DEFAULT '[]' NOT NULL;
