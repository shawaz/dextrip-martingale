/**
 * Lightweight /api/btc-5m/recommended — returns only trade recommendations.
 * Used by the Python executor — avoids running the full 300+ line dashboard handler.
 */

import { NextResponse } from "next/server";
import { db } from "@/db/index";
import { agents } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

import { STREAK_AGENTS, computeAgentSignal } from "@/lib/core/streak";
import { calculateRsi } from "@/lib/core/rsi";
import { fetchBtcPrice } from "@/lib/core/price";
import { getSettingsMap } from "@/lib/core/settings";
import { computeWindow } from "@/lib/core/rounds";
import { ladderForAgent } from "@/lib/core/agents";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { roundId, windowTs, startTimeIso, endTimeIso } = computeWindow();
    const btcPrice = await fetchBtcPrice();
    const settingsMap = await getSettingsMap();

    const globalTarget = settingsMap.get("martingale_target_profit") ?? 5;
    const globalMultiplier = settingsMap.get("martingale_multiplier") ?? 3;
    const globalSteps = settingsMap.get("martingale_ladder_steps") ?? 8;

    // Import rounds schema for closed rounds
    const { rounds: roundsTable } = await import("@/db/schema");
    const closed = await db()
      .select()
      .from(roundsTable)
      .where(eq(roundsTable.status, "closed"))
      .orderBy(desc(roundsTable.startTime))
      .limit(20);

    const recentDirections = closed
      .map((r) => r.resolvedDirection)
      .filter((d): d is string => Boolean(d));

    const rsiPrices = closed
      .map((r) => Number(r.exitPrice || r.entryPrice))
      .filter((p) => p > 0)
      .reverse();
    if (btcPrice > 0) rsiPrices.push(btcPrice);
    const rsi = calculateRsi(rsiPrices, 14);

    const allAgents = await db()
      .select()
      .from(agents)
      .where(eq(agents.timeframe, "5m"));

    const recommended: Array<{
      name: string;
      agentId: string;
      direction: string;
      stake: number;
      slug: string;
      isLive: boolean;
    }> = [];

    for (const streak of STREAK_AGENTS) {
      const signal = computeAgentSignal(streak, recentDirections, rsi);
      if (!signal) continue;

      const { ladder } = ladderForAgent(
        streak.id,
        settingsMap,
        globalTarget,
        globalMultiplier,
        globalSteps,
      );

      // Check for pending trade
      const { trades: tradesTable } = await import("@/db/schema");
      const pending = await db()
        .select()
        .from(tradesTable)
        .where(eq(tradesTable.roundId, roundId))
        .limit(1);

      // Simple step detection — use first step if no pending
      const stake = ladder[0];

      const agent = allAgents.find((a) => a.id === streak.id);

      recommended.push({
        name: streak.name,
        agentId: streak.id,
        direction: signal,
        stake,
        slug: `btc-updown-5m-${windowTs}`,
        isLive: agent?.isLive === 1,
      });
    }

    return NextResponse.json({
      currentWindow: { roundId, startTime: startTimeIso, endTime: endTimeIso },
      btcPrice,
      targetProfit: globalTarget,
      recommendedTrades: recommended,
    });
  } catch (e) {
    console.error("[API] /recommended error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
