CREATE TABLE `guilds` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `whitelist` (
	`pattern` text NOT NULL,
	`guild_id` text
);
--> statement-breakpoint
CREATE INDEX `whitelist_guild_id_idx` ON `whitelist` (`guild_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `whitelist_pattern_idx` ON `whitelist` (`pattern`,`guild_id`);--> statement-breakpoint
DROP INDEX `link_blacklist_url_idx`;--> statement-breakpoint
ALTER TABLE `link_blacklist` ADD `guild_id` text;--> statement-breakpoint
CREATE INDEX `blacklist_guild_id_idx` ON `link_blacklist` (`guild_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `link_blacklist_url_idx` ON `link_blacklist` (`url`,`guild_id`);--> statement-breakpoint
ALTER TABLE `attachments` ADD `guild_id` text;--> statement-breakpoint
CREATE INDEX `attachments_guild_id_idx` ON `attachments` (`guild_id`);--> statement-breakpoint
ALTER TABLE `links` ADD `guild_id` text;--> statement-breakpoint
CREATE INDEX `links_guild_id_idx` ON `links` (`guild_id`);--> statement-breakpoint
ALTER TABLE `posts` ADD `guild_id` text;--> statement-breakpoint
CREATE INDEX `posts_guild_id_idx` ON `posts` (`guild_id`);