CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`display_name` text NOT NULL,
	`timezone` text NOT NULL,
	`role` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`preferences` text NOT NULL,
	`enabled_modules` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_email_idx` ON `user` (`email`);--> statement-breakpoint
CREATE INDEX `user_role_idx` ON `user` (`role`);--> statement-breakpoint
CREATE TABLE `connection` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`scopes` text NOT NULL,
	`metadata` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `connection_user_idx` ON `connection` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `connection_token_hash_idx` ON `connection` (`token_hash`);--> statement-breakpoint
CREATE INDEX `connection_kind_idx` ON `connection` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `pairing_code` (
	`code` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_name` text NOT NULL,
	`client_kind` text NOT NULL,
	`scopes` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`consumed_connection_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`consumed_connection_id`) REFERENCES `connection`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `pairing_code_user_idx` ON `pairing_code` (`user_id`);--> statement-breakpoint
CREATE INDEX `pairing_code_expires_idx` ON `pairing_code` (`expires_at`);--> statement-breakpoint
CREATE TABLE `module_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`codename` text NOT NULL,
	`version` text NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`installed_at` text NOT NULL,
	`updated_at` text NOT NULL
);
