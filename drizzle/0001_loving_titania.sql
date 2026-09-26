CREATE TABLE `simulation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`project_id` text NOT NULL,
	`model_hash` text NOT NULL,
	`status` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runs_owner_project_created` ON `simulation_runs` (`owner`,`project_id`,`created_at`);