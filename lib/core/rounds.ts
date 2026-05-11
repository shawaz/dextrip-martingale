/**
 * Round lifecycle — create, close, query.
 */

import { eq, and, desc, lt } from "drizzle-orm";
import { db, rounds } from "@/db/index";
import { roundIdToSlug, fetchPolymarketOutcome } from "./polymarket";
import { fetchBtcPrice } from "./price";

/** Create a new round for the current 5-minute window. */
export async function createRound(params: {
  roundId: string;
  startTime: string;
  endTime: string;
  entryPrice: number;
}): Promise<{ created: boolean; id?: string }> {
  const existing = await db().query.rounds.findFirst({
    where: eq(rounds.roundId, params.roundId),
  });
  if (existing) return { created: false };

  const slug = roundIdToSlug(params.roundId);
  const id = crypto.randomUUID();
  await db()
    .insert(rounds)
    .values({
      id,
      roundId: params.roundId,
      asset: "BTC",
      timeframe: "5m",
      startTime: params.startTime,
      endTime: params.endTime,
      entryPrice: params.entryPrice,
      status: "open",
      externalMarketSlug: slug,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  return { created: true, id };
}

/** Close a round and resolve its direction. */
export async function closeRound(params: {
  roundId: string;
  btcPrice: number;
}): Promise<{ direction: string | null; source: string }> {
  const round = await db().query.rounds.findFirst({
    where: eq(rounds.roundId, params.roundId),
  });
  if (!round || round.status === "closed") {
    return { direction: round?.resolvedDirection ?? null, source: "cached" };
  }

  let direction: string | null = null;
  let source = "binance";

  // Try Polymarket first
  try {
    const polyDir = await fetchPolymarketOutcome(params.roundId);
    if (polyDir) {
      direction = polyDir;
      source = "polymarket";
    }
  } catch {}

  // Fallback to Binance price comparison
  if (!direction) {
    const entryPrice = Number(round.entryPrice);
    if (params.btcPrice > entryPrice) direction = "UP";
    else if (params.btcPrice < entryPrice) direction = "DOWN";
  }

  await db()
    .update(rounds)
    .set({
      exitPrice: params.btcPrice,
      resolvedDirection: direction,
      status: "closed",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(rounds.id, round.id));

  return { direction, source };
}

/** Get recently closed rounds (for streak detection). */
export async function getClosedRounds(limit = 50) {
  return db()
    .select()
    .from(rounds)
    .where(
      and(eq(rounds.timeframe, "5m"), eq(rounds.status, "closed")),
    )
    .orderBy(desc(rounds.startTime))
    .limit(limit);
}

/** Get open rounds that should be resolved (older than given startTime). */
export async function getOpenRoundsToResolve(beforeStartTime: string) {
  return db()
    .select()
    .from(rounds)
    .where(
      and(
        eq(rounds.timeframe, "5m"),
        eq(rounds.status, "open"),
        lt(rounds.startTime, beforeStartTime),
      ),
    )
    .orderBy(desc(rounds.startTime))
    .limit(5);
}

/** Compute window info for the current time. */
export function computeWindow() {
  const now = new Date();
  const intervalS = 300;
  const currentTs = Math.floor(now.getTime() / 1000);
  const windowTs = currentTs - (currentTs % intervalS);
  const startTimeIso = new Date(windowTs * 1000).toISOString();
  const endTimeIso = new Date((windowTs + intervalS) * 1000).toISOString();
  const roundId = `BTC5M-${windowTs}`;
  return { roundId, windowTs, startTimeIso, endTimeIso };
}
