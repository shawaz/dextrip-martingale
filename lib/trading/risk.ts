export const STARTING_BANKROLL = 100;
export const MAX_RISK_PER_TRADE = 0.03;
export const HIGH_CONVICTION_RISK = 0.05;
export const DAILY_LOSS_LIMIT_PCT = 0.08;

export function calculateStake(bankroll: number, confidence: number, score: number) {
  const riskPct = confidence >= 0.82 && score >= 85 ? HIGH_CONVICTION_RISK : MAX_RISK_PER_TRADE;
  return Number((bankroll * riskPct).toFixed(2));
}

export function calculatePnl(entryPrice: number, exitPrice: number, signal: "UP" | "DOWN" | "HOLD", stake: number) {
  if (signal === "HOLD") return 0;
  if ((signal === "UP" && exitPrice > entryPrice) || (signal === "DOWN" && exitPrice < entryPrice)) {
    return Number((stake * 0.95).toFixed(2));
  }
  return Number((-stake).toFixed(2));
}

export function exceedsDailyLossLimit(bankroll: number, dailyPnl: number) {
  return dailyPnl <= -(bankroll * DAILY_LOSS_LIMIT_PCT);
}
