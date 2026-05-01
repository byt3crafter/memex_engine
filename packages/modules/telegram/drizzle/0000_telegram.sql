CREATE TABLE `telegram_user` (
	`telegram_id` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`username` text,
	`first_name` text,
	`last_name` text,
	`language_code` text,
	`is_premium` integer DEFAULT false NOT NULL,
	`notifications_enabled` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `telegram_user_user_idx` ON `telegram_user` (`user_id`);