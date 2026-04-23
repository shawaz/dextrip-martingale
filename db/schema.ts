import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  initials: text("initials").notNull(),
  color: text("color").notNull(),
  timeframe: text("timeframe").notNull(),
  preferredStrategy: text("preferred_strategy"),
  promoted: integer("promoted", { mode: "boolean" }).notNull().default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  won: integer("won").notNull().default(0),
  loss: integer("loss").notNull().default(0),
  winRate: real("win_rate").notNull().default(0),
  bankroll: real("bankroll").notNull().default(100),
  startingBankroll: real("starting_bankroll").notNull().default(100),
  totalPnl: real("total_pnl").notNull().default(0),
  dailyPnl: real("daily_pnl").notNull().default(0),
  maxDrawdown: real("max_drawdown").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const strategies = sqliteTable("strategies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  score: integer("score").notNull(),
  report: text("report").notNull(),
  whenToUse: text("when_to_use").notNull(),
  weakness: text("weakness").notNull(),
  improveNote: text("improve_note").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const agentStrategyCards = sqliteTable("agent_strategy_cards", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  strategyId: text("strategy_id").notNull(),
  priority: integer("priority").notNull().default(0),
});

export const rounds = sqliteTable("rounds", {
  id: text("id").primaryKey(),
  roundId: text("round_id").notNull(),
  asset: text("asset").notNull(),
  timeframe: text("timeframe").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  officialEntryPrice: real("official_entry_price"),
  officialExitPrice: real("official_exit_price"),
  priceSource: text("price_source").notNull().default("binance"),
  externalMarketSlug: text("external_market_slug"),
  resolvedDirection: text("resolved_direction"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const trades = sqliteTable("trades", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  roundId: text("round_id").notNull(),
  strategyId: text("strategy_id").notNull(),
  signal: text("signal").notNull(),
  confidence: real("confidence").notNull().default(0),
  strategyScore: integer("strategy_score").notNull().default(0),
  stake: real("stake").notNull().default(0),
  pnl: real("pnl").notNull().default(0),
  report: text("report").notNull().default(""),
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  result: text("result").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
