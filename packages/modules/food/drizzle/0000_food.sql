CREATE TABLE `pantry_item` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`category` text NOT NULL,
	`quantity` real,
	`unit` text,
	`expiry_date` text,
	`source` text NOT NULL,
	`confidence` real,
	`is_available` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pantry_item_user_idx` ON `pantry_item` (`user_id`);--> statement-breakpoint
CREATE INDEX `pantry_item_normalized_idx` ON `pantry_item` (`user_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `pantry_item_category_idx` ON `pantry_item` (`user_id`,`category`);--> statement-breakpoint
CREATE INDEX `pantry_item_available_idx` ON `pantry_item` (`user_id`,`is_available`);--> statement-breakpoint
CREATE TABLE `food_event` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event_type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`source` text NOT NULL,
	`raw_text` text,
	`image_refs` text,
	`craving_text` text,
	`available_food_context` text,
	`meal_name` text,
	`actual_eaten` integer,
	`eaten_by_user` integer,
	`for_person` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `food_event_user_occurred_idx` ON `food_event` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `food_event_type_idx` ON `food_event` (`user_id`,`event_type`);--> statement-breakpoint
CREATE TABLE `food_event_item` (
	`id` text PRIMARY KEY NOT NULL,
	`food_event_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`role` text NOT NULL,
	`quantity` real,
	`unit` text,
	`calories_estimated` real,
	`protein_g_estimated` real,
	`carbs_g_estimated` real,
	`fat_g_estimated` real,
	`estimate_confidence` real,
	`estimate_source` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`food_event_id`) REFERENCES `food_event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `food_event_item_event_idx` ON `food_event_item` (`food_event_id`);--> statement-breakpoint
CREATE INDEX `food_event_item_name_idx` ON `food_event_item` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `meal_outcome` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`food_event_id` text NOT NULL,
	`satisfaction_score` integer,
	`hunger_after` integer,
	`energy_after` integer,
	`cravings_after` integer,
	`mood_after` text,
	`notes` text,
	`recipe_candidate` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_event_id`) REFERENCES `food_event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meal_outcome_event_idx` ON `meal_outcome` (`food_event_id`);--> statement-breakpoint
CREATE INDEX `meal_outcome_user_idx` ON `meal_outcome` (`user_id`);--> statement-breakpoint
CREATE TABLE `recipe` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`source_food_event_id` text,
	`ingredients` text NOT NULL,
	`steps` text NOT NULL,
	`protein_source` text,
	`tags` text NOT NULL,
	`estimated_calories` real,
	`estimated_protein_g` real,
	`estimated_carbs_g` real,
	`estimated_fat_g` real,
	`personal_rating` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_food_event_id`) REFERENCES `food_event`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `recipe_user_active_idx` ON `recipe` (`user_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `recipe_title_idx` ON `recipe` (`user_id`,`title`);--> statement-breakpoint
CREATE TABLE `menu_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`generated_from` text NOT NULL,
	`items` text NOT NULL,
	`shopping_gaps` text NOT NULL,
	`card` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `menu_plan_user_start_idx` ON `menu_plan` (`user_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `recommendation` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`food_event_id` text,
	`requested_at` text NOT NULL,
	`craving_text` text,
	`goal_context` text,
	`available_food_snapshot` text NOT NULL,
	`engine_version` text NOT NULL,
	`recommended_title` text NOT NULL,
	`recommendation_reason` text NOT NULL,
	`options` text NOT NULL,
	`selected_option` text,
	`card` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_event_id`) REFERENCES `food_event`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `recommendation_user_requested_idx` ON `recommendation` (`user_id`,`requested_at`);