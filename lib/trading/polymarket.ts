import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const BULLPEN_PATH = process.env.BULLPEN_PATH || "/opt/homebrew/bin/bullpen";

function outcomeFromPrices(openPrice?: number | null, closePrice?: number | null): "UP" | "DOWN" | null {
  if (openPrice == null || closePrice == null) return null;
  return closePrice >= openPrice ? "UP" : "DOWN";
}

export function calculateRsi(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = prices[i - 1] - prices[i];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  if (losses === 0) return 100;
  
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

export type PolymarketRoundTruth = {
  slug: string;
  title: string;
  resolvedDirection: "UP" | "DOWN" | null;
  priceToBeat?: number | null;
  finalPrice?: number | null;
  resolutionSource?: string;
  recentResults?: Array<{ startTime: string; endTime: string; openPrice: number; closePrice: number; direction: "UP" | "DOWN" }>;
  rsi?: number | null;
};

export function polymarketSlugForRound(startTimeIso: string, intervalMinutes: number = 15) {
  return `btc-updown-${intervalMinutes}m-${Math.floor(new Date(startTimeIso).getTime() / 1000)}`;
}

export async function fetchPolymarketSharePrice(slug: string, outcome: "UP" | "DOWN"): Promise<number | null> {
  try {
    const res = await fetch(`https://gamma-api.polymarket.com/markets/slug/${slug}`, {
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const raw = await res.text()
    const cleaned = raw.replace(/[\x00-\x1f\x7f-\x9f]/g, "")
    const data = JSON.parse(cleaned)
    const market = Array.isArray(data) ? data[0] : data

    const outcomes: string[] = JSON.parse(market.outcomes ?? "[]")
    const prices: string[] = JSON.parse(market.outcomePrices ?? "[]")

    const index = outcomes.findIndex((name) => name.toUpperCase() === outcome)
    if (index === -1 || !prices[index]) return null

    return Number(prices[index])
  } catch {
    return null
  }
}

export async function fetchPolymarketRoundTruth(startTimeIso: string, intervalMinutes: number = 15): Promise<PolymarketRoundTruth | null> {
  const slug = polymarketSlugForRound(startTimeIso, intervalMinutes);
  const timestamp = Math.floor(new Date(startTimeIso).getTime() / 1000);

  let recentResults: any[] = [];
  let priceToBeat: number | null = null;
  let finalPrice: number | null = null;
  let resolvedDirection: "UP" | "DOWN" | null = null;

  try {
    const { stdout: eventOut } = await execFileAsync(BULLPEN_PATH, ["polymarket", "event", slug, "--output", "json"], { timeout: 15000 });
    const eventData = JSON.parse(eventOut);
    
    const outcomes = eventData?.markets?.[0]?.outcomes ?? [];
    const upOutcome = outcomes.find((o: any) => o.name?.toLowerCase() === "up");
    const downOutcome = outcomes.find((o: any) => o.name?.toLowerCase() === "down");

    if (upOutcome?.price === 1) resolvedDirection = "UP";
    else if (downOutcome?.price === 1) resolvedDirection = "DOWN";
    
    priceToBeat = upOutcome?.price ?? null;
    finalPrice = upOutcome?.price ?? null;
  } catch (e) {
    console.log("Bullpen event fetch failed:", e);
  }

  try {
    const { stdout: tradesOut } = await execFileAsync(BULLPEN_PATH, ["polymarket", "trades", slug, "--output", "json"], { timeout: 15000 });
    const tradesData = JSON.parse(tradesOut);
    
    if (tradesData?.trades?.length > 0) {
      const tradeMap = new Map<number, { price: number; side: string; timestamp: number }>();
      
      for (const trade of tradesData.trades || []) {
        const price = Number(trade.price);
        const side = trade.side || trade.outcome || "";
        const ts = Math.floor(new Date(trade.timestamp || trade.createdAt).getTime() / 1000);
        const windowStart = Math.floor(ts / (intervalMinutes * 60)) * (intervalMinutes * 60);
        
        const existing = tradeMap.get(windowStart);
        if (!existing || price > existing.price) {
          tradeMap.set(windowStart, { price, side, timestamp: ts });
        }
      }

      const sortedWindows = Array.from(tradeMap.keys()).sort((a, b) => b - a).slice(0, 30);
      
      recentResults = sortedWindows.map(ts => {
        const data = tradeMap.get(ts)!;
        const windowEnd = ts + intervalMinutes * 60;
        const direction = (data.side.toLowerCase() === "up" || data.price >= 0.5) ? "UP" : "DOWN";
        return {
          startTime: new Date(ts * 1000).toISOString(),
          endTime: new Date(windowEnd * 1000).toISOString(),
          openPrice: data.price,
          closePrice: data.price,
          direction,
        };
      });
    }
  } catch (e) {
    console.log("Bullpen trades fetch failed:", e);
  }

  if (recentResults.length > 0) {
    const currentWindowStart = Math.floor(Date.now() / (intervalMinutes * 60 * 1000)) * (intervalMinutes * 60 * 1000);
    const targetStart = Math.floor(timestamp / (intervalMinutes * 60)) * (intervalMinutes * 60 * 1000);
    
    if (targetStart >= currentWindowStart) {
      priceToBeat = recentResults[0].openPrice;
      finalPrice = recentResults[0].openPrice;
    }
  }

  return {
    slug,
    title: slug,
    resolvedDirection,
    priceToBeat,
    finalPrice,
    recentResults,
  };
}

export async function fetchPolymarketOutcome(roundId: string): Promise<"UP" | "DOWN" | null> {
  const parts = roundId.split("-");
  const ts = parts[parts.length - 1];
  if (!ts || !/^\d+$/.test(ts)) return null;

  const slug = `btc-updown-5m-${ts}`;
  try {
    const res = await fetch(`https://gamma-api.polymarket.com/markets/slug/${slug}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const raw = await res.text();
    const cleaned = raw.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
    const data = JSON.parse(cleaned);
    const market = Array.isArray(data) ? data[0] : data;
    const prices = market?.outcomePrices as string[] | undefined;
    if (!prices || prices.length < 2) return null;
    if (prices[0] === "1") return "UP";
    if (prices[1] === "1") return "DOWN";
    return null;
  } catch {
    return null;
  }
}