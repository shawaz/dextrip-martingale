/**
 * Binance BTC price and klines — single source of truth.
 * Merges the old lib/trading/market-data.ts and inline fetchBtcPrice().
 */

import { type MarketState } from "./types";

const BINANCE_BASE = "https://api.binance.com/api/v3";

/** Simple ticker price — fast, low latency. */
export async function fetchBtcPrice(): Promise<number> {
  try {
    const res = await fetch(`${BINANCE_BASE}/ticker/price?symbol=BTCUSDT`);
    const data = (await res.json()) as { price?: string };
    const price = Number(data.price ?? 0);
    return price > 0 && !isNaN(price) ? price : 0;
  } catch (e) {
    console.error("[core/price] fetchBtcPrice failed:", e);
    return 0;
  }
}

/** Full 1m klines — used for MarketState computation. Also returns the last close as price. */
export async function fetchKlines(
  limit = 30,
): Promise<{ closes: number[]; volumes: number[]; price: number }> {
  try {
    const res = await fetch(
      `${BINANCE_BASE}/klines?symbol=BTCUSDT&interval=1m&limit=${limit}`,
    );
    const candles = (await res.json()) as Array<
      [number, string, string, string, string, string]
    >;
    const closes = candles.map((c) => Number(c[4]));
    const volumes = candles.map((c) => Number(c[5]));
    return {
      closes,
      volumes,
      price: closes.length > 0 ? closes[closes.length - 1] : 0,
    };
  } catch (e) {
    console.error("[core/price] fetchKlines failed:", e);
    return { closes: [], volumes: [], price: 0 };
  }
}

/** Build full MarketState from klines + current price. */
export function buildMarketState(
  price: number,
  closes: number[],
  volumes: number[],
): MarketState {
  if (!closes.length) {
    return emptyMarketState(price);
  }

  const current =
    closes.length > 0 ? closes[closes.length - 1] : price;
  const previous =
    closes.length >= 5 ? closes[closes.length - 5] : current;
  const trendMovePct = previous
    ? ((current - previous) / previous) * 100
    : 0;

  const avgVolume =
    volumes.slice(-6, -1).reduce((s, v) => s + v, 0) /
    Math.max(1, volumes.slice(-6, -1).length);
  const lastVolume =
    volumes.length > 0 ? volumes[volumes.length - 1] : avgVolume;
  const volumeExpansion =
    avgVolume > 0 ? lastVolume / avgVolume : 1;

  const high = Math.max(...closes.slice(-8));
  const low = Math.min(...closes.slice(-8));
  const breakout = current >= high || current <= low;

  const vwapApprox =
    closes.reduce((s, v, i) => s + v * volumes[i], 0) /
    Math.max(1, volumes.reduce((s, v) => s + v, 0));
  const vwapDistancePct = vwapApprox
    ? ((current - vwapApprox) / vwapApprox) * 100
    : 0;

  // RSI from closes
  let rsi = 50;
  const rsiCloses = closes.slice(-15);
  if (rsiCloses.length >= 15) {
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < rsiCloses.length; i++) {
      const diff = rsiCloses[i] - rsiCloses[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    rsi = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
  }

  const volatilityLevel =
    Math.abs(trendMovePct) > 1
      ? "high"
      : Math.abs(trendMovePct) > 0.35
        ? "medium"
        : "low";
  const trendDirection: "up" | "down" | "flat" =
    trendMovePct > 0.25 ? "up" : trendMovePct < -0.25 ? "down" : "flat";
  const trendStrength = Math.min(20, Math.abs(trendMovePct) * 8);
  const liquiditySweep = Math.abs(vwapDistancePct) > 0.6 && breakout;
  const regime: MarketState["regime"] =
    breakout && volumeExpansion > 1.35
      ? "breakout"
      : volatilityLevel === "high" && trendDirection === "flat"
        ? "chaos"
        : trendDirection === "flat"
          ? "range"
          : "trend";

  // EMA slope
  const emaPeriod = 21;
  const emaMultiplier = 2 / (emaPeriod + 1);
  const emaValues: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < emaPeriod) {
      const slice = closes.slice(0, i + 1);
      emaValues.push(slice.reduce((s, v) => s + v, 0) / slice.length);
    } else {
      emaValues.push(
        closes[i] * emaMultiplier + emaValues[i - 1] * (1 - emaMultiplier),
      );
    }
  }
  const emaRecent = emaValues.slice(-3);
  let emaSlope: 1 | 0 | -1 = 0;
  if (emaRecent.length >= 3) {
    if (
      emaRecent[2] > emaRecent[0] &&
      ((emaRecent[2] - emaRecent[0]) / (emaRecent[0] || 1)) * 100 > 0.01
    )
      emaSlope = 1;
    else if (
      emaRecent[2] < emaRecent[0] &&
      ((emaRecent[0] - emaRecent[2]) / (emaRecent[0] || 1)) * 100 > 0.01
    )
      emaSlope = -1;
  }
  const highVolume = volumeExpansion > 1.5;

  return {
    price,
    trendDirection,
    trendStrength: isNaN(trendStrength)
      ? 0
      : Number(trendStrength.toFixed(1)),
    volatilityLevel,
    regime,
    volumeExpansion,
    rsiZone: rsi <= 35 ? "oversold" : rsi >= 65 ? "overbought" : "neutral",
    vwapDistancePct,
    breakout,
    liquiditySweep,
    emaSlope,
    highVolume,
  };
}

function emptyMarketState(price: number): MarketState {
  return {
    price,
    trendDirection: "flat",
    trendStrength: 0,
    volatilityLevel: "low",
    regime: "range",
    volumeExpansion: 1,
    rsiZone: "neutral",
    vwapDistancePct: 0,
    breakout: false,
    liquiditySweep: false,
    emaSlope: 0,
    highVolume: false,
  };
}
