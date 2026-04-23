import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { agentStrategyCards, strategies, trades } from "@/db/schema";

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
};

export async function buildMarketState(price: number): Promise<MarketState> {
  const response = await fetch("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=20");
  const candles = (await response.json()) as Array<[number, string, string, string, string, string]>;
  const closes = candles.map((row) => Number(row[4]));
  const volumes = candles.map((row) => Number(row[5]));
  const current = closes.at(-1) ?? price;
  const previous = closes.at(-5) ?? current;
  const trendMovePct = previous ? ((current - previous) / previous) * 100 : 0;
  const avgVolume = volumes.slice(-6, -1).reduce((sum, value) => sum + value, 0) / Math.max(1, volumes.slice(-6, -1).length);
  const volumeExpansion = avgVolume > 0 ? (volumes.at(-1) ?? avgVolume) / avgVolume : 1;
  const high = Math.max(...closes.slice(-8));
  const low = Math.min(...closes.slice(-8));
  const breakout = current >= high || current <= low;
  const vwapApprox = closes.reduce((sum, value, index) => sum + value * volumes[index], 0) / Math.max(1, volumes.reduce((sum, value) => sum + value, 0));
  const vwapDistancePct = vwapApprox ? ((current - vwapApprox) / vwapApprox) * 100 : 0;

  const gains = closes.slice(-14).reduce((sum, value, index, array) => {
    if (index === 0) return sum;
    return sum + Math.max(0, value - array[index - 1]);
  }, 0);
  const losses = closes.slice(-14).reduce((sum, value, index, array) => {
    if (index === 0) return sum;
    return sum + Math.max(0, array[index - 1] - value);
  }, 0);
  const rs = losses === 0 ? 100 : gains / losses;
  const rsi = 100 - 100 / (1 + rs);

  const volatilityLevel = Math.abs(trendMovePct) > 1 ? "high" : Math.abs(trendMovePct) > 0.35 ? "medium" : "low";
  const trendDirection = trendMovePct > 0.25 ? "up" : trendMovePct < -0.25 ? "down" : "flat";
  const trendStrength = Math.min(20, Math.abs(trendMovePct) * 8);
  const liquiditySweep = Math.abs(vwapDistancePct) > 0.6 && breakout;
  const regime = breakout && volumeExpansion > 1.35 ? "breakout" : volatilityLevel === "high" && trendDirection === "flat" ? "chaos" : trendDirection === "flat" ? "range" : "trend";

  return {
    price,
    trendDirection,
    trendStrength,
    volatilityLevel,
    regime,
    volumeExpansion,
    rsiZone: rsi <= 35 ? "oversold" : rsi >= 65 ? "overbought" : "neutral",
    vwapDistancePct,
    breakout,
    liquiditySweep,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function marketFitBonus(strategyName: string, marketState: MarketState): number {
  switch (strategyName) {
    case "Volume Surge":
      return (marketState.volumeExpansion > 1.4 ? 8 : 0) + (marketState.trendDirection !== "flat" ? 6 : 0);
    case "RSI Reversal":
      return marketState.rsiZone !== "neutral" ? 10 : -4;
    case "Momentum Break":
      return (marketState.breakout ? 10 : 0) + (marketState.volatilityLevel === "high" ? 6 : 0);
    case "Trend Ride":
      return marketState.trendDirection !== "flat" ? 8 + marketState.trendStrength * 0.3 : -6;
    case "VWAP Reclaim":
      return Math.abs(marketState.vwapDistancePct) < 0.5 ? 7 : 2;
    case "Range Fade":
      return marketState.volatilityLevel === "low" ? 8 : -8;
    case "Trend Pullback":
      return marketState.trendDirection !== "flat" && marketState.volatilityLevel !== "high" ? 8 : 0;
    case "Liquidity Sweep Reversal":
      return marketState.liquiditySweep ? 12 : -3;
    default:
      return 0;
  }
}

function agentPreferenceBonus(strategyName: string, preferred?: string, priority = 2): number {
  if (strategyName === preferred) return 10;
  return priority === 1 ? 6 : 3;
}

async function recentAgentPerformanceBonus(agentId: string): Promise<number> {
  const recentTrades = await db.query.trades.findMany({ where: eq(trades.agentId, agentId), orderBy: desc(trades.createdAt), limit: 5 });
  if (!recentTrades.length) return 0;
  const wins = recentTrades.filter((trade) => trade.result === "won").length;
  const losses = recentTrades.filter((trade) => trade.result === "loss").length;
  return clamp((wins - losses) * 2, -10, 10);
}

async function strategyLearningAdjustment(agentId: string, strategyId: string): Promise<number> {
  const recentTrades = await db.query.trades.findMany({ where: eq(trades.agentId, agentId), orderBy: desc(trades.createdAt), limit: 12 });
  const strategyTrades = recentTrades.filter((trade) => trade.strategyId === strategyId && trade.result !== "pending");
  if (!strategyTrades.length) return 0;

  const wins = strategyTrades.filter((trade) => trade.result === "won").length;
  const losses = strategyTrades.filter((trade) => trade.result === "loss").length;
  const totalPnl = strategyTrades.reduce((sum, trade) => sum + Number(trade.pnl ?? 0), 0);

  return clamp((wins - losses) * 2 + totalPnl * 0.6, -12, 12);
}

async function noTradeDisciplinePenalty(agentId: string): Promise<number> {
  const recentTrades = await db.query.trades.findMany({ where: eq(trades.agentId, agentId), orderBy: desc(trades.createdAt), limit: 6 });
  const recentLosses = recentTrades.filter((trade) => trade.result === "loss").length;
  const pendingHolds = recentTrades.filter((trade) => trade.signal === "HOLD").length;

  if (recentLosses >= 4) return 8;
  if (recentLosses >= 3 && pendingHolds === 0) return 5;
  return 0;
}

async function recentStrategyPerformanceBonus(strategyId: string): Promise<number> {
  const recentTrades = await db.query.trades.findMany({ where: eq(trades.strategyId, strategyId), orderBy: desc(trades.createdAt), limit: 8 });
  if (!recentTrades.length) return 0;
  const wins = recentTrades.filter((trade) => trade.result === "won").length;
  const losses = recentTrades.filter((trade) => trade.result === "loss").length;
  return clamp((wins - losses) * 1.5, -10, 10);
}

function volatilityMismatchPenalty(strategyName: string, marketState: MarketState): number {
  if (strategyName === "Range Fade" && marketState.volatilityLevel === "high") return 10;
  if (strategyName === "RSI Reversal" && marketState.trendStrength > 10) return 7;
  if (strategyName === "Trend Ride" && marketState.trendDirection === "flat") return 8;
  return 0;
}

function regimePenalty(strategyName: string, marketState: MarketState): number {
  if (marketState.regime === "chaos" && ["Range Fade", "RSI Reversal"].includes(strategyName)) return 10;
  if (marketState.regime === "range" && ["Momentum Break", "Trend Ride"].includes(strategyName)) return 8;
  if (marketState.regime === "trend" && strategyName === "Range Fade") return 8;
  if (marketState.regime === "breakout" && strategyName === "Liquidity Sweep Reversal") return 4;
  return 0;
}

async function losingStreakPenalty(agentId: string): Promise<number> {
  const recentTrades = await db.query.trades.findMany({ where: eq(trades.agentId, agentId), orderBy: desc(trades.createdAt), limit: 3 });
  const losingStreak = recentTrades.filter((trade) => trade.result === "loss").length;
  return losingStreak >= 3 ? 8 : losingStreak === 2 ? 4 : 0;
}

function overtradePenalty(priority: number): number {
  return priority > 2 ? 4 : 0;
}

function signalForStrategy(strategyName: string, marketState: MarketState): "UP" | "DOWN" | "HOLD" {
  if (strategyName === "RSI Reversal") {
    if (marketState.rsiZone === "oversold") return "UP";
    if (marketState.rsiZone === "overbought") return "DOWN";
    return "HOLD";
  }

  if (strategyName === "Liquidity Sweep Reversal") {
    if (!marketState.liquiditySweep) return "HOLD";
    return marketState.trendDirection === "down" ? "UP" : "DOWN";
  }

  if (strategyName === "Range Fade") {
    return marketState.vwapDistancePct > 0 ? "DOWN" : "UP";
  }

  return marketState.trendDirection === "down" ? "DOWN" : "UP";
}

function confidenceLabel(confidence: number) {
  if (confidence >= 0.82) return "High";
  if (confidence >= 0.7) return "Medium";
  return "Low";
}

function participationPenalty(signal: "UP" | "DOWN" | "HOLD", marketState: MarketState, score: number, confidence: number) {
  if (signal === "HOLD") return 0;
  let penalty = 0;
  if (marketState.regime === "chaos") penalty += 10;
  if (marketState.volatilityLevel === "high" && confidence < 0.78) penalty += 8;
  if (marketState.trendDirection === "flat" && score < 78) penalty += 6;
  return penalty;
}

async function strategistMentorAdjustment(strategyId: string, signal: "UP" | "DOWN" | "HOLD") {
  const recentTrades = await db.query.trades.findMany({ orderBy: desc(trades.createdAt), limit: 80 });
  const strategyTrades = recentTrades.filter((trade) => trade.strategyId === strategyId && trade.signal !== "HOLD" && trade.result !== "pending" && trade.result !== "skipped");
  const wins = strategyTrades.filter((trade) => trade.result === "won").length;
  const losses = strategyTrades.filter((trade) => trade.result === "loss").length;
  const pnl = strategyTrades.reduce((sum, trade) => sum + Number(trade.pnl ?? 0), 0);
  const crowding = recentTrades.filter((trade) => trade.signal === signal && trade.result === "pending").length;

  let scoreDelta = 0;
  let note = "Mentors see no major objection.";

  if (losses > wins) {
    scoreDelta -= 8;
    note = "Mentors downgraded this setup because recent losses outweigh wins.";
  }
  if (pnl < 0) {
    scoreDelta -= 6;
    note = "Mentors downgraded this setup because recent strategy PnL is negative.";
  }
  if (crowding >= 3 && signal !== "HOLD") {
    scoreDelta -= 7;
    note = `Mentors flagged crowded ${signal} positioning and reduced conviction.`;
  }
  if (wins >= losses + 3 && pnl > 0) {
    scoreDelta += 5;
    note = "Mentors upgraded this setup because recent evidence is supportive.";
  }

  return { scoreDelta, note };
}

export async function selectStrategyForAgent(agent: { id: string; preferredStrategy?: string | null }) {
  const priceResponse = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
  const pricePayload = (await priceResponse.json()) as { price?: string };
  const price = Number(pricePayload.price ?? 0);
  const marketState = await buildMarketState(price);
  const cards = await db.select().from(agentStrategyCards).where(eq(agentStrategyCards.agentId, agent.id));

  const candidates = [] as Array<{ strategyId: string; strategyName: string; score: number; confidence: number; signal: "UP" | "DOWN" | "HOLD"; report: string }>;
  for (const card of cards) {
    const strategy = await db.query.strategies.findFirst({ where: eq(strategies.id, card.strategyId) });
    if (!strategy) continue;

    const signal = signalForStrategy(strategy.name, marketState);
    const mentorAdjustment = await strategistMentorAdjustment(strategy.id, signal);

    const finalScore = clamp(
      strategy.score +
        marketFitBonus(strategy.name, marketState) +
        agentPreferenceBonus(strategy.name, agent.preferredStrategy ?? undefined, card.priority) +
        (await recentStrategyPerformanceBonus(strategy.id)) +
        (await recentAgentPerformanceBonus(agent.id)) +
        (await strategyLearningAdjustment(agent.id, strategy.id)) +
        mentorAdjustment.scoreDelta -
        volatilityMismatchPenalty(strategy.name, marketState) -
        regimePenalty(strategy.name, marketState) -
        (await losingStreakPenalty(agent.id)) -
        (await noTradeDisciplinePenalty(agent.id)) -
        overtradePenalty(card.priority),
      0,
      100,
    );
    const confidence = clamp(0.45 + finalScore / 200 + (marketState.breakout ? 0.05 : 0) - (signal === "HOLD" ? 0.08 : 0), 0.45, 0.95);
    const strictScore = finalScore - participationPenalty(signal, marketState, finalScore, confidence);

    candidates.push({
      strategyId: strategy.id,
      strategyName: strategy.name,
      score: strictScore,
      confidence,
      signal,
      report: `${strategy.report} Fit ${marketFitBonus(strategy.name, marketState).toFixed(0)}, regime ${marketState.regime}, trend ${marketState.trendDirection}, volatility ${marketState.volatilityLevel}, confidence ${confidenceLabel(confidence)}, learned weight ${(await strategyLearningAdjustment(agent.id, strategy.id)).toFixed(0)}. ${mentorAdjustment.note}`,
    });
  }

  const sorted = candidates.sort((left, right) => right.score - left.score);
  const top = sorted[0];
  const directional = sorted.filter((candidate) => candidate.signal !== "HOLD");
  const upCount = directional.filter((candidate) => candidate.signal === "UP").length;
  const downCount = directional.filter((candidate) => candidate.signal === "DOWN").length;
  const dominantSignal = upCount >= downCount ? "UP" : "DOWN";
  const imbalance = Math.abs(upCount - downCount);

  if (!top || top.score < 76 || top.confidence < 0.68 || top.signal === "HOLD") {
    return {
      strategyId: candidates[0]?.strategyId ?? "",
      strategyName: candidates[0]?.strategyName ?? "No strategy",
      score: top?.score ?? 0,
      confidence: top?.confidence ?? 0.45,
      signal: "HOLD" as const,
      report: `No strategy met the stricter participation threshold. Regime ${marketState.regime}, trend ${marketState.trendDirection}, volatility ${marketState.volatilityLevel}, top score ${top?.score ?? 0}, confidence ${confidenceLabel(top?.confidence ?? 0.45)}.`,
      price,
    };
  }

  if (imbalance >= 2 && top.signal === dominantSignal && sorted[1] && sorted[1].signal !== top.signal && sorted[1].score >= 74 && sorted[1].confidence >= 0.66) {
    return {
      ...sorted[1],
      report: `${sorted[1].report} Diversified away from crowded ${dominantSignal} positioning.`,
      price,
    };
  }

  if (top.confidence < 0.72 && marketState.regime !== "breakout") {
    return {
      strategyId: top.strategyId,
      strategyName: top.strategyName,
      score: top.score,
      confidence: top.confidence,
      signal: "HOLD" as const,
      report: `Confidence ${confidenceLabel(top.confidence)} was not strong enough for participation in ${marketState.regime} regime.`,
      price,
    };
  }

  return {
    ...top,
    price,
  };
}
