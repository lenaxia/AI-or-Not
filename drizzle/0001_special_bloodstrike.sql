CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`sha1` text NOT NULL,
	`label` text NOT NULL,
	`source` text NOT NULL,
	`locator` text NOT NULL,
	`ext` text NOT NULL,
	`mime` text NOT NULL,
	`elo` integer DEFAULT 1000 NOT NULL,
	`appearances` integer DEFAULT 0 NOT NULL,
	`fools` integer DEFAULT 0 NOT NULL,
	`retired` integer DEFAULT false NOT NULL,
	`indexed_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `images_sha1_unique` ON `images` (`sha1`);