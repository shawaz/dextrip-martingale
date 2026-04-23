import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function isoNoMs(value: string) {
  return value.replace('.000Z', 'Z');
}

function outcomeFromPrices(openPrice?: number | null, closePrice?: number | null): "UP" | "DOWN" | null {
  if (openPrice == null || closePrice == null) return null;
  return closePrice >= openPrice ? "UP" : "DOWN";
}

export function calculateRsi(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = prices[i - 1] - prices[i]; // Reverse order in recentResults (most recent first)
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
  const intervalWord = intervalMinutes === 5 ? "five" : "fifteen";

  try {
    const bullpenPath = "/opt/homebrew/bin/bullpen";
    let payload: any = {};
    try {
      const { stdout } = await execFileAsync(bullpenPath, ["polymarket", "event", slug, "--output", "json"]);
      payload = JSON.parse(stdout);
    } catch (e) {
      console.error("Bullpen CLI failed, falling back to scraping:", e);
    }

    const page = await fetch(`https://polymarket.com/event/${slug}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    }).then((response) => response.text()).catch(() => "");

    const match = page.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    const nextData = match?.[1] ? JSON.parse(match[1]) : null;
    const queries = nextData?.props?.pageProps?.dehydratedState?.queries ?? [];

    const startIsoNormalized = isoNoMs(startTimeIso);
    const endIso = isoNoMs(new Date(new Date(startTimeIso).getTime() + intervalMinutes * 60 * 1000).toISOString());
    const nowTs = Date.now();
    let finishedResults: any[] = [];
    for (const q of queries) {
      const results = q?.state?.data?.data?.results;
      if (Array.isArray(results) && results.length > 0 && results[0].startTime && results[0].closePrice) {
        finishedResults = results
          .filter((row: any) => new Date(row.endTime).getTime() <= nowTs)
          .map((row: any) => ({
            startTime: row.startTime,
            endTime: row.endTime,
            openPrice: Number(row.openPrice),
            closePrice: Number(row.closePrice),
            direction: Number(row.closePrice) >= Number(row.openPrice) ? "UP" : "DOWN",
          }))
          .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());
        
        if (finishedResults.length > 0) break;
      }
    }

    const exactWindow = finishedResults.find((row: any) => isoNoMs(row.startTime) === startIsoNormalized && isoNoMs(row.endTime) === endIso);
    const liveWindow = queries.find((query: any) => Array.isArray(query?.queryKey) && query.queryKey[0] === 'crypto-prices' && query.queryKey[1] === 'price' && query.queryKey[2] === 'BTC' && query.queryKey[3] === startIsoNormalized && query.queryKey[5] === endIso)?.state?.data;

    const nextText = nextData ? JSON.stringify(nextData) : "";
    const fallbackPriceToBeatMatch = nextText.match(new RegExp(`"slug":"${slug}"[\\s\\S]*?"eventMetadata":\{[^}]*?"priceToBeat":([0-9.]+)`));
    const fallbackFinalPriceMatch = nextText.match(new RegExp(`"slug":"${slug}"[\\s\\S]*?"eventMetadata":\{[^}]*?"finalPrice":([0-9.]+)`));

    const priceToBeat = exactWindow?.openPrice ?? liveWindow?.openPrice ?? (fallbackPriceToBeatMatch ? Number(fallbackPriceToBeatMatch[1]) : null);
    const finalPrice = exactWindow?.closePrice ?? liveWindow?.closePrice ?? (fallbackFinalPriceMatch ? Number(fallbackFinalPriceMatch[1]) : null);

    const outcomes = payload.markets?.[0]?.outcomes ?? [];
    const up = outcomes.find((outcome: any) => outcome.name?.toLowerCase() === "up")?.price;
    const down = outcomes.find((outcome: any) => outcome.name?.toLowerCase() === "down")?.price;
    
    // Outcome from prices or explicit resolution
    let resolvedDirection: "UP" | "DOWN" | null = null;
    if (up === 1) resolvedDirection = "UP";
    else if (down === 1) resolvedDirection = "DOWN";
    else resolvedDirection = outcomeFromPrices(priceToBeat, finalPrice);

    const rsi = calculateRsi(finishedResults.map((r: any) => r.closePrice), 14);

    return {
      slug,
      title: payload.title ?? slug,
      resolvedDirection,
      priceToBeat,
      finalPrice,
      resolutionSource: payload.resolution_source,
      recentResults: finishedResults,
      rsi,
    };
  } catch (err) {
    console.error("Polymarket truth fetch failed:", err);
    return null;
  }
}
