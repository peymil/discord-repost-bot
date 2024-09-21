CREATE TABLE `attachments` (
	`hash` blob NOT NULL,
	`post_id` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `link_blacklist` (
	`url` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `links` (
	`url` text NOT NULL,
	`post_id` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`user_id` text NOT NULL,
	`message` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hash_idx` ON `attachments` (`hash`);--> statement-breakpoint
CREATE INDEX `link_blacklist_url_idx` ON `link_blacklist` (`url`);--> statement-breakpoint
CREATE INDEX `url_idx` ON `links` (`url`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `posts` (`user_id`);--> statement-breakpoint
CREATE INDEX `created_at_idx` ON `posts` (`created_at`);