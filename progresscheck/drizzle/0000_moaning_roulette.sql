CREATE TABLE `photo_assets` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`key` text NOT NULL,
	`mime` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`owner` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
