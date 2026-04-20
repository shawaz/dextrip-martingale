export type TradeSignal = "UP" | "DOWN" | "HOLD";

export type StrategyName = "Volume Surge" | "RSI Reversal" | "Momentum Break" | "Trend Ride" | "VWAP Reclaim";
export type Timeframe = "15m" | "1h" | "4h";

export interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketSnapshot {
  symbol: string;
  timeframe: Timeframe;
  price: number;
  fetchedAt: string;
  candles: Candle[];
}

export interface StrategyDecision {
  strategy: StrategyName;
  signal: TradeSignal;
  confidence: number;
  shouldTrade: boolean;
  reasoning: string;
  metrics: Record<string, number>;
}

export interface StrategyCard {
  name: StrategyName;
  description: string;
  bestFor: Timeframe[];
  improvement: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  initials: string;
  color: string;
  bankroll: number;
  timeframe: Timeframe;
  preferredStrategy?: StrategyName;
  strategyCards: StrategyCard[];
  won?: number;
  loss?: number;
  winRate?: number;
  isPromoted?: boolean;
}

export interface RoundWindow {
  roundId: string;
  asset: string;
  timeframe: Timeframe;
  startTime: string;
  endTime: string;
  entryPrice: number;
  status: "active" | "closed";
  documentId?: string;
}

export interface ExecutionPlan {
  signal: Exclude<TradeSignal, "HOLD">;
  outcome: "Yes" | "No";
  stakeUsd: number;
  marketSlug: string;
}

export interface ExecutedTrade {
  ok: boolean;
  dryRun: boolean;
  externalId?: string;
  raw?: unknown;
}

export interface AgentTradeRecord {
  agentId: string;
  roundId: string;
  strategyName: StrategyName;
  signal: Exclude<TradeSignal, "HOLD">;
  entry: number;
  result: "pending" | "won" | "loss";
}
