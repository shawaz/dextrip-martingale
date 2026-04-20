import { MarketSnapshot, StrategyCard, StrategyDecision, StrategyName, Timeframe, TradeSignal } from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeRsi(closes: number[], period = 14): number {
  if (closes.length <= period) {
    return 50;
  }

  let gains = 0;
  let losses = 0;

  for (let index = closes.length - period; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1];
    if (delta >= 0) {
      gains += delta;
    } else {
      losses += Math.abs(delta);
    }
  }

  if (losses === 0) {
    return 100;
  }

  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

export const strategyCards: StrategyCard[] = [
  {
    name: "Volume Surge",
    description: "Trades breakout candles when current volume spikes above the recent baseline.",
    bestFor: ["15m", "1h"],
    improvement: "Add trend filter so surges only fire with higher timeframe alignment.",
  },
  {
    name: "RSI Reversal",
    description: "Looks for overstretched moves and fades them when RSI reaches extremes.",
    bestFor: ["15m", "1h", "4h"],
    improvement: "Combine RSI with support and resistance zones to avoid catching falling knives.",
  },
  {
    name: "Momentum Break",
    description: "Enters when price breaks out of a recent range with directional force.",
    bestFor: ["15m", "1h"],
    improvement: "Require breakout retest confirmation before sizing up.",
  },
  {
    name: "Trend Ride",
    description: "Follows sustained directional moves using moving average slope and higher highs or lows.",
    bestFor: ["1h", "4h"],
    improvement: "Add trailing stop logic so winners are not cut too early.",
  },
  {
    name: "VWAP Reclaim",
    description: "Buys or sells when price reclaims VWAP with supporting volume.",
    bestFor: ["15m", "1h"],
    improvement: "Score the reclaim by session strength to avoid flat markets.",
  },
];

export function getStrategyCardsForTimeframe(timeframe: Timeframe): StrategyCard[] {
  return strategyCards.filter((card) => card.bestFor.includes(timeframe));
}

export function evaluateVolumeSurge(snapshot: MarketSnapshot): StrategyDecision {
  const candles = snapshot.candles;
  const current = candles.at(-1);
  const previous = candles.slice(-4, -1);

  if (!current || previous.length < 3) {
    return {
      strategy: "Volume Surge",
      signal: "HOLD",
      confidence: 0.5,
      shouldTrade: false,
      reasoning: "Not enough candle history to evaluate the surge setup.",
      metrics: {},
    };
  }

  const baselineVolume = average(previous.map((candle) => candle.volume));
  const volumeRatio = baselineVolume > 0 ? current.volume / baselineVolume : 0;
  const momentumPct = ((current.close - current.open) / current.open) * 100;
  const absoluteMomentum = Math.abs(momentumPct);
  const confidence = clamp(0.45 + (volumeRatio - 1) * 0.18 + absoluteMomentum * 0.15, 0.45, 0.92);
  const signal = volumeRatio >= 1.8 && absoluteMomentum >= 0.2 ? (momentumPct >= 0 ? "UP" : "DOWN") : "HOLD";

  return {
    strategy: "Volume Surge",
    signal,
    confidence,
    shouldTrade: signal !== "HOLD" && confidence >= 0.58,
    reasoning:
      signal === "HOLD"
        ? `Volume ratio is ${volumeRatio.toFixed(2)}x with ${momentumPct.toFixed(2)}% momentum, below trigger.`
        : `Volume expanded to ${volumeRatio.toFixed(2)}x baseline with ${momentumPct.toFixed(2)}% momentum.`,
    metrics: {
      volumeRatio,
      momentumPct,
      baselineVolume,
    },
  };
}

export function evaluateRsiReversal(snapshot: MarketSnapshot): StrategyDecision {
  const closes = snapshot.candles.map((candle) => candle.close);
  const rsi = computeRsi(closes, 14);
  const recentMovePct = closes.length >= 4 ? ((closes.at(-1)! - closes.at(-4)!) / closes.at(-4)!) * 100 : 0;

  let signal: TradeSignal = "HOLD";
  if (rsi <= 30 && recentMovePct < -0.25) {
    signal = "UP";
  } else if (rsi >= 70 && recentMovePct > 0.25) {
    signal = "DOWN";
  }

  const confidence = clamp(0.48 + Math.abs(50 - rsi) / 100 + Math.abs(recentMovePct) * 0.12, 0.48, 0.9);

  return {
    strategy: "RSI Reversal",
    signal,
    confidence,
    shouldTrade: signal !== "HOLD" && confidence >= 0.57,
    reasoning:
      signal === "HOLD"
        ? `RSI is ${rsi.toFixed(1)} with ${recentMovePct.toFixed(2)}% move, not stretched enough.`
        : `RSI reached ${rsi.toFixed(1)} after ${recentMovePct.toFixed(2)}% move, supporting reversal.`,
    metrics: {
      rsi,
      recentMovePct,
    },
  };
}

export function evaluateMomentumBreak(snapshot: MarketSnapshot): StrategyDecision {
  const candles = snapshot.candles;
  const current = candles.at(-1);
  const range = candles.slice(-12, -2);

  if (!current || range.length < 5) {
    return {
      strategy: "Momentum Break",
      signal: "HOLD",
      confidence: 0.5,
      shouldTrade: false,
      reasoning: "Not enough candles to evaluate breakout.",
      metrics: {},
    };
  }

  const rangeHigh = Math.max(...range.map((candle) => candle.high));
  const rangeLow = Math.min(...range.map((candle) => candle.low));
  const breakoutUp = current.close > rangeHigh;
  const breakoutDown = current.close < rangeLow;
  const distancePct = breakoutUp
    ? ((current.close - rangeHigh) / rangeHigh) * 100
    : breakoutDown
      ? ((rangeLow - current.close) / rangeLow) * 100
      : 0;
  const signal = breakoutUp ? "UP" : breakoutDown ? "DOWN" : "HOLD";
  const confidence = clamp(0.47 + distancePct * 3.2, 0.47, 0.88);

  return {
    strategy: "Momentum Break",
    signal,
    confidence,
    shouldTrade: signal !== "HOLD" && confidence >= 0.56,
    reasoning:
      signal === "HOLD"
        ? "Price is still inside the recent range."
        : `Price broke ${signal === "UP" ? "above" : "below"} range by ${distancePct.toFixed(2)}%.`,
    metrics: {
      rangeHigh,
      rangeLow,
      distancePct,
    },
  };
}

export function evaluateTrendRide(snapshot: MarketSnapshot): StrategyDecision {
  const candles = snapshot.candles.slice(-10);
  if (candles.length < 10) {
    return {
      strategy: "Trend Ride",
      signal: "HOLD",
      confidence: 0.5,
      shouldTrade: false,
      reasoning: "Not enough candles to evaluate trend.",
      metrics: {},
    };
  }

  const closes = candles.map((candle) => candle.close);
  const fast = average(closes.slice(-4));
  const slow = average(closes);
  const slopePct = ((closes.at(-1)! - closes[0]) / closes[0]) * 100;
  const signal: TradeSignal = fast > slow && slopePct > 0.35 ? "UP" : fast < slow && slopePct < -0.35 ? "DOWN" : "HOLD";
  const confidence = clamp(0.5 + Math.abs(slopePct) * 0.18, 0.5, 0.89);

  return {
    strategy: "Trend Ride",
    signal,
    confidence,
    shouldTrade: signal !== "HOLD" && confidence >= 0.59,
    reasoning:
      signal === "HOLD"
        ? `Trend slope is ${slopePct.toFixed(2)}%, not strong enough.`
        : `Fast average crossed ${signal === "UP" ? "above" : "below"} slow average with ${slopePct.toFixed(2)}% slope.`,
    metrics: {
      fast,
      slow,
      slopePct,
    },
  };
}

export function evaluateVwapReclaim(snapshot: MarketSnapshot): StrategyDecision {
  const candles = snapshot.candles.slice(-8);
  const current = candles.at(-1);
  if (!current || candles.length < 5) {
    return {
      strategy: "VWAP Reclaim",
      signal: "HOLD",
      confidence: 0.5,
      shouldTrade: false,
      reasoning: "Not enough candles to evaluate VWAP reclaim.",
      metrics: {},
    };
  }

  let cumulativeVolume = 0;
  let cumulativePriceVolume = 0;
  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeVolume += candle.volume;
    cumulativePriceVolume += typicalPrice * candle.volume;
  }

  const vwap = cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : current.close;
  const distancePct = ((current.close - vwap) / vwap) * 100;
  const signal: TradeSignal = distancePct > 0.15 ? "UP" : distancePct < -0.15 ? "DOWN" : "HOLD";
  const confidence = clamp(0.48 + Math.abs(distancePct) * 0.9, 0.48, 0.87);

  return {
    strategy: "VWAP Reclaim",
    signal,
    confidence,
    shouldTrade: signal !== "HOLD" && confidence >= 0.57,
    reasoning:
      signal === "HOLD"
        ? `Price is hugging VWAP with only ${distancePct.toFixed(2)}% separation.`
        : `Price reclaimed ${signal === "UP" ? "above" : "below"} VWAP by ${distancePct.toFixed(2)}%.`,
    metrics: {
      vwap,
      distancePct,
    },
  };
}

export function evaluateStrategySet(snapshot: MarketSnapshot): StrategyDecision[] {
  return [
    evaluateVolumeSurge(snapshot),
    evaluateRsiReversal(snapshot),
    evaluateMomentumBreak(snapshot),
    evaluateTrendRide(snapshot),
    evaluateVwapReclaim(snapshot),
  ];
}

export function getPreferredStrategy(name: string): StrategyName | undefined {
  const normalized = name.toLowerCase();

  if (normalized.includes("lisa") || normalized.includes("surge")) return "Volume Surge";
  if (normalized.includes("bart") || normalized.includes("momentum")) return "Momentum Break";
  if (normalized.includes("marge") || normalized.includes("vwap")) return "VWAP Reclaim";
  if (normalized.includes("homer") || normalized.includes("rsi")) return "RSI Reversal";
  if (normalized.includes("mr burns") || normalized.includes("trend")) return "Trend Ride";

  return undefined;
}

export function chooseFallbackDecision(decisions: StrategyDecision[], preferredStrategy?: StrategyName): StrategyDecision {
  const preferred = preferredStrategy ? decisions.find((decision) => decision.strategy === preferredStrategy) : undefined;

  if (preferred && preferred.shouldTrade) {
    return preferred;
  }

  const tradable = decisions.filter((decision) => decision.shouldTrade);
  if (tradable.length === 0) {
    return preferred ?? decisions[0];
  }

  return tradable.sort((left, right) => right.confidence - left.confidence)[0];
}
