/** Shared types for the Dextrip Martingale core library. */

export type Direction = "UP" | "DOWN";

export type StreakAgent = {
  id: string;
  name: string;
} & (
  | { trigger: "always"; signal: Direction }
  | { trigger: "streak"; streak: number }
  | { trigger: "rsi" }
);

export const STREAK_AGENTS: StreakAgent[] = [
  { id: "EVERY_UP_5M", name: "Every UP", trigger: "always", signal: "UP" },
  { id: "EVERY_DOWN_5M", name: "Every DOWN", trigger: "always", signal: "DOWN" },
  { id: "PREVIOUS_5M", name: "Previous", trigger: "streak", streak: 2 },
  { id: "PREVIOUS_3_5M", name: "Previous 3", trigger: "streak", streak: 3 },
  { id: "PREVIOUS_5_5M", name: "Previous 5", trigger: "streak", streak: 5 },
  { id: "RSI_5M", name: "RSI", trigger: "rsi" },
];

export type MarketState = {
  price: number;
  trendDirection: "up" | "down" | "flat";
  trendStrength: number;
  volatilityLevel: "low" | "medium" | "high";
  regime: "trend" | "range" | "breakout" | "chaos";
  volumeExpansion: number;
  rsiZone: "oversold" | "neutral" | "overbought";
  vwapDistancePct: number;
  breakout: boolean;
  liquiditySweep: boolean;
  emaSlope: 1 | 0 | -1;
  highVolume: boolean;
};

export type AgentTradeState = {
  currentStep: number;
  invested: number;
  profit: number;
  loss: number;
  roundsCompleted: number;
  pending: boolean;
  balance: number;
};

export type PolymarketPriceCheck = {
  price: number;
  belowThreshold: boolean;
  tokenId: string | null;
  skipped: boolean;
  reason?: string;
};
