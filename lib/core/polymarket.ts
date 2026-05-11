/**
 * Polymarket integration — price check + outcome resolution.
 * 
 * KEY RULE: Only trade if share price is BELOW $0.50.
 * This ensures we only bet when the market gives favorable odds.
 */

import { type PolymarketPriceCheck } from "./types";

const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";

/** Round ID like "BTC5M-1715123400" → Polymarket slug "btc-updown-5m-1715123400" */
export function roundIdToSlug(roundId: string): string {
  const parts = roundId.split("-");
  const ts = parts[parts.length - 1];
  return `btc-updown-5m-${ts}`;
}

/** Convert window timestamp to polymarket slug */
export function windowTsToSlug(windowTs: number): string {
  return `btc-updown-5m-${windowTs}`;
}

/**
 * Fetch Polymarket outcome prices for a given market slug.
 * Returns [upPrice, downPrice] or null.
 * Price = the current best-bid or mid-price for each outcome token.
 */
async function fetchOutcomePrices(
  slug: string,
): Promise<[number, number] | null> {
  try {
    // Use gamma API for market data (faster than CLOB for prices)
    const res = await fetch(`${GAMMA_API}/markets/slug/${slug}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const raw = await res.text();
    const cleaned = raw.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
    const data = JSON.parse(cleaned);
    const market = Array.isArray(data) ? data[0] : data;

    // outcomePrices is a JSON string array like ["0.48", "0.52"]
    const pricesRaw = market?.outcomePrices;
    if (typeof pricesRaw === "string") {
      const parsed = JSON.parse(pricesRaw) as string[];
      if (parsed && parsed.length >= 2) {
        return [Number(parsed[0]), Number(parsed[1])];
      }
    }
    if (Array.isArray(pricesRaw) && pricesRaw.length >= 2) {
      return [Number(pricesRaw[0]), Number(pricesRaw[1])];
    }
    return null;
  } catch (e) {
    console.error(`[core/polymarket] fetchOutcomePrices(${slug}) failed:`, e);
    return null;
  }
}

/** Get token IDs from the market slug (needed for CLOB orders) */
async function fetchTokenIds(
  slug: string,
): Promise<[string, string] | null> {
  try {
    const res = await fetch(`${GAMMA_API}/markets/slug/${slug}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const market = Array.isArray(data) ? data[0] : data;
    const ids = JSON.parse(market.clobTokenIds ?? "[]");
    return ids.length >= 2 ? [ids[0], ids[1]] : null;
  } catch {
    return null;
  }
}

/**
 * Check if a trade should proceed based on Polymarket share price.
 * 
 * Rules:
 * - Price < $0.50 → proceed (belowThreshold: true)
 * - Price >= $0.50 → SKIP (belowThreshold: false, skipped: true)
 * - Price unavailable → proceed (conservative: let paper trades run)
 * 
 * @param slug - Polymarket market slug
 * @param direction - "UP" or "DOWN"
 * @returns PolymarketPriceCheck with decision
 */
export async function checkPriceBelowThreshold(
  slug: string,
  direction: "UP" | "DOWN",
): Promise<PolymarketPriceCheck> {
  const prices = await fetchOutcomePrices(slug);
  const tokenIds = await fetchTokenIds(slug);

  if (!prices) {
    return {
      price: 0,
      belowThreshold: true, // Conservative: let trade proceed if we can't check
      tokenId: null,
      skipped: false,
      reason: "Price unavailable from Polymarket — proceeding",
    };
  }

  const upPrice = prices[0];
  const downPrice = prices[1];
  const price = direction === "UP" ? upPrice : downPrice;
  const tokenId =
    tokenIds?.[direction === "UP" ? 0 : 1] ?? null;
  const belowThreshold = price < 0.50;

  return {
    price,
    belowThreshold,
    tokenId,
    skipped: !belowThreshold,
    reason: belowThreshold
      ? `Price $${price.toFixed(4)} < $0.50 — proceeding`
      : `Price $${price.toFixed(4)} >= $0.50 — SKIPPING (unfavorable odds)`,
  };
}

/**
 * Resolve a round outcome from Polymarket.
 * Checks if UP or DOWN token has resolved to 1.0.
 */
export async function fetchPolymarketOutcome(
  roundId: string,
): Promise<"UP" | "DOWN" | null> {
  const slug = roundIdToSlug(roundId);
  try {
    const res = await fetch(`${GAMMA_API}/markets/slug/${slug}`, {
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
