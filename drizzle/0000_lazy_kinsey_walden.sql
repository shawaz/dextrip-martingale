CREATE TABLE "agent_strategy_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"strategy_id" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"initials" text NOT NULL,
	"color" text NOT NULL,
	"timeframe" text NOT NULL,
	"preferred_strategy" text,
	"promoted" integer DEFAULT 0 NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"is_live" integer DEFAULT 0 NOT NULL,
	"won" integer DEFAULT 0 NOT NULL,
	"loss" integer DEFAULT 0 NOT NULL,
	"win_rate" real DEFAULT 0 NOT NULL,
	"bankroll" real DEFAULT 100 NOT NULL,
	"starting_bankroll" real DEFAULT 100 NOT NULL,
	"total_pnl" real DEFAULT 0 NOT NULL,
	"daily_pnl" real DEFAULT 0 NOT NULL,
	"max_drawdown" real DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"asset" text NOT NULL,
	"timeframe" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"entry_price" real DEFAULT 0 NOT NULL,
	"exit_price" real,
	"official_entry_price" real,
	"official_exit_price" real,
	"price_source" text DEFAULT 'binance' NOT NULL,
	"external_market_slug" text,
	"resolved_direction" text,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"score" integer NOT NULL,
	"report" text NOT NULL,
	"when_to_use" text NOT NULL,
	"weakness" text NOT NULL,
	"improve_note" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"round_id" text NOT NULL,
	"strategy_id" text NOT NULL,
	"signal" text NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"strategy_score" integer DEFAULT 0 NOT NULL,
	"stake" real DEFAULT 0 NOT NULL,
	"target_profit_snapshot" real DEFAULT 5 NOT NULL,
	"pnl" real DEFAULT 0 NOT NULL,
	"report" text DEFAULT '' NOT NULL,
	"entry_price" real DEFAULT 0 NOT NULL,
	"exit_price" real,
	"result" text NOT NULL,
	"trade_mode" text DEFAULT 'paper' NOT NULL,
	"external_order_id" text,
	"order_status" text DEFAULT 'idle' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
