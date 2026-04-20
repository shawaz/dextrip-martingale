import { Candle, MarketSnapshot, Timeframe } from "./types";

function parseCandle(raw: unknown): Candle {
  const row = raw as [number, string, string, string, string, string, number];

  return {
    openTime: row[0],
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: row[6],
  };
}

function toBinanceInterval(timeframe: Timeframe): string {
  if (timeframe === "15m") return "15m";
  if (timeframe === "1h") return "1h";
  return "4h";
}

export async function fetchMarketSnapshot(symbol: string, timeframe: Timeframe, limit: number): Promise<MarketSnapshot> {
  const interval = toBinanceInterval(timeframe);

  const [tickerRes, candlesRes] = await Promise.all([
    fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`),
    fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`),
  ]);

  if (!tickerRes.ok) {
    throw new Error(`Failed to fetch ticker price: ${tickerRes.status}`);
  }

  if (!candlesRes.ok) {
    throw new Error(`Failed to fetch candles: ${candlesRes.status}`);
  }

  const tickerJson = (await tickerRes.json()) as { price?: string };
  const candlesJson = (await candlesRes.json()) as unknown[];

  return {
    symbol,
    timeframe,
    price: Number(tickerJson.price),
    fetchedAt: new Date().toISOString(),
    candles: candlesJson.map(parseCandle),
  };
}
