import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

export async function fetchPolymarketRoundTruth(startTimeIso: string, intervalMinutes: number = 15): Promise<PolymarketRoundTruth | null> {
  const slug = polymarketSlugForRound(startTimeIso, intervalMinutes);
  const timestamp = Math.floor(new Date(startTimeIso).getTime() / 1000);
  const bullpenPath = "/opt/homebrew/bin/bullpen";

  let recentResults: any[] = [];
  let priceToBeat: number | null = null;
  let finalPrice: number | null = null;
  let resolvedDirection: "UP" | "DOWN" | null = null;

  try {
    const { stdout: eventOut } = await execFileAsync(bullpenPath, ["polymarket", "event", slug, "--output", "json"], { timeout: 15000 });
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
    const { stdout: tradesOut } = await execFileAsync(bullpenPath, ["polymarket", "trades", slug, "--output", "json"], { timeout: 15000 });
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