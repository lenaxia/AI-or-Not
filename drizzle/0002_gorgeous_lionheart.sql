CREATE TABLE `rejected_images` (
	`sha1` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`source_key` text,
	`rejected_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
