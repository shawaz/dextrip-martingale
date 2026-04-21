type RankedAgent = {
  id: string;
  totalPnl: number;
  winRate: number;
  won: number;
  loss: number;
  maxDrawdown: number;
  bankroll: number;
  startingBankroll: number;
};

export function promotionScore(agent: RankedAgent): number {
  const sampleSize = agent.won + agent.loss;
  const roi = agent.startingBankroll > 0 ? (agent.totalPnl / agent.startingBankroll) * 100 : 0;
  const sampleConfidence = Math.min(sampleSize, 12) * 1.5;
  const consistency = agent.winRate * 0.45;
  const pnlWeight = roi * 1.8;
  const drawdownPenalty = agent.maxDrawdown * 0.7;
  const inactivityPenalty = sampleSize < 4 ? (4 - sampleSize) * 8 : 0;

  return Number((pnlWeight + consistency + sampleConfidence - drawdownPenalty - inactivityPenalty).toFixed(2));
}

export function pickPromotedAgent<T extends RankedAgent>(agents: T[]): T | undefined {
  return [...agents].sort((a, b) => {
    return promotionScore(b) - promotionScore(a)
      || b.totalPnl - a.totalPnl
      || b.winRate - a.winRate
      || a.maxDrawdown - b.maxDrawdown
      || b.won - a.won;
  })[0];
}
