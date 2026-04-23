CREATE TABLE `agent_strategy_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`strategy_id` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`initials` text NOT NULL,
	`color` text NOT NULL,
	`timeframe` text NOT NULL,
	`preferred_strategy` text,
	`promoted` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`won` integer DEFAULT 0 NOT NULL,
	`loss` integer DEFAULT 0 NOT NULL,
	`win_rate` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`asset` text NOT NULL,
	`timeframe` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`entry_price` real NOT NULL,
	`exit_price` real,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `strategies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`score` integer NOT NULL,
	`report` text NOT NULL,
	`when_to_use` text NOT NULL,
	`weakness` text NOT NULL,
	`improve_note` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`round_id` text NOT NULL,
	`strategy_id` text NOT NULL,
	`signal` text NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`strategy_score` integer DEFAULT 0 NOT NULL,
	`report` text DEFAULT '' NOT NULL,
	`entry_price` real NOT NULL,
	`exit_price` real,
	`result` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
