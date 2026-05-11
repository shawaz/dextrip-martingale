CREATE TABLE "wallet_balances" (
	"id" integer PRIMARY KEY NOT NULL,
	"usdc_balance" real DEFAULT 0 NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "polymarket_price" real;