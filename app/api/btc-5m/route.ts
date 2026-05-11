/**
 * BTC-5M Dashboard API — HTTP handler only.
 * All business logic delegates to lib/core/*.
 */

import { NextResponse } from "next/server";
import { db } from "@/db/index";
import { agents, trades, rounds as roundsTable } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

import {
  STREAK_AGENTS,
  computeAgentSignal,
} from "@/lib/core/streak";
import { calculateRsi } from "@/lib/core/rsi";
import {
  fetchBtcPrice,
  fetchKlines,
  buildMarketState,
} from "@/lib/core/price";
import {
  getSettingsMap,
  getTargetProfit,
  getMultiplier,
  getLadderSteps,
  getTrendStrengthThreshold,
  saveSetting,
  clearSettingsCache,
  perAgentVal,
} from "@/lib/core/settings";
import { computeWindow } from "@/lib/core/rounds";
import {
  getRecentTradesByAgent,
  computeAgentState,
} from "@/lib/core/trades";
import {
  seedAgents,
  toggleLiveAgent,
  ladderForAgent,
} from "@/lib/core/agents";
import { buildLadder } from "@/lib/core/streak-machine";

// ─── Wallet ─────────────────────────────────────────────────────────

let walletCache: { balance: number; address: string; at: number } | null = null;

async function getWalletBalance() {
  const key = process.env.POLYMARKET_PRIVATE_KEY;
  const funder = process.env.POLYMARKET_FUNDER;
  if (!key || !funder) return { connected: false, balance: null, wallet: null };

  const now = Date.now();
  if (walletCache && now - walletCache.at < 30_000) {
    return {
      connected: true,
      balance: walletCache.balance,
      wallet: walletCache.address,
    };
  }

  try {
    const res = await fetch(
      `https://clob.polymarket.com/balance-allowance?asset_type=0&_=${now}`,
      {
        headers: {
          "POLYMARKET-API-KEY": key,
          "Cache-Control": "no-cache",
        },
      },
    );
    if (!res.ok) return { connected: true, balance: null, wallet: funder };
    const data = await res.json();
    const balance = data.balance ? data.balance / 1_000_000 : 0;
    walletCache = { balance, address: funder, at: now };
    return { connected: true, balance, wallet: funder };
  } catch {
    return { connected: true, balance: null, wallet: funder };
  }
}

// ─── GET Handler ────────────────────────────────────────────────────

export async function GET(req: Request) {
  // Keep-alive ping to Railway
  fetch("https://loving-rejoicing-production-592c.up.railway.app", {
    method: "HEAD",
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});

  try {
    const { searchParams } = new URL(req.url);

    // ── Handle settings updates ────────────────────────────────────
    const applyNext = searchParams.get("applyNextWindow") === "true";
    if (applyNext) {
      const updates: [string, string][] = [];
      const newTarget = searchParams.get("target");
      const newMultiplier = searchParams.get("multiplier");
      const newSteps = searchParams.get("steps");
      const newTrend = searchParams.get("trendThreshold");

      if (newTarget) { const v = Number(newTarget); if (!isNaN(v) && v > 0) updates.push(["martingale_target_profit", String(v)]); }
      if (newMultiplier) { const v = Number(newMultiplier); if (!isNaN(v) && v > 1) updates.push(["martingale_multiplier", String(v)]); }
      if (newSteps) { const v = Number(newSteps); if (!isNaN(v) && v >= 2 && v <= 20) updates.push(["martingale_ladder_steps", String(v)]); }
      if (newTrend) { const v = Number(newTrend); if (!isNaN(v) && v >= 0 && v <= 20) updates.push(["trend_strength_threshold", String(v)]); }

      for (const [k, v] of updates) await saveSetting(k, v);
    }

    // Per-agent settings
    const saveAgentId = searchParams.get("saveAgent");
    if (saveAgentId) {
      const target = searchParams.get("saveTarget");
      const mult = searchParams.get("saveMultiplier");
      const steps = searchParams.get("saveSteps");
      if (target) await saveSetting(`target_${saveAgentId}`, target);
      if (mult) await saveSetting(`multiplier_${saveAgentId}`, mult);
      if (steps) await saveSetting(`steps_${saveAgentId}`, steps);
    }

    // Toggle live agent
    const toggleAgent = searchParams.get("toggleLive");
    if (toggleAgent) {
      const enabled = searchParams.get("liveEnabled") === "true";
      await toggleLiveAgent(toggleAgent, enabled);
    }

    // ── Load settings + market data ─────────────────────────────────
    await seedAgents();
    const settingsMap = await getSettingsMap();
    const globalTarget = settingsMap.get("martingale_target_profit") ?? 5;
    const globalMultiplier = settingsMap.get("martingale_multiplier") ?? 3;
    const globalSteps = settingsMap.get("martingale_ladder_steps") ?? 8;
    const trendThreshold = settingsMap.get("trend_strength_threshold") ?? 8;
    const displayTarget = globalTarget;
    const displayMultiplier = globalMultiplier;
    const displaySteps = globalSteps;

    const { roundId, startTimeIso, endTimeIso } = computeWindow();
    const wallet = await getWalletBalance();

    // Market data (single fetch)
    const { closes, volumes, price: klinePrice } = await fetchKlines(30);
    const btcPrice = klinePrice || (await fetchBtcPrice());
    const marketState = closes.length
      ? buildMarketState(btcPrice || klinePrice, closes, volumes)
      : null;

    // RSI
    const recentCloses = [...closes].reverse();
    const rsi = calculateRsi(
      btcPrice ? [...recentCloses.slice(0, 19), btcPrice] : recentCloses.slice(0, 20),
      14,
    );

    // ── Recent closed rounds for streak signals ──────────────────────
    const closed = await db()
      .select()
      .from(roundsTable)
      .where(
        and(eq(roundsTable.timeframe, "5m"), eq(roundsTable.status, "closed")),
      )
      .orderBy(desc(roundsTable.startTime))
      .limit(50);

    const recentDirections = closed
      .map((r) => r.resolvedDirection)
      .filter((d): d is string => Boolean(d));

    // ── Build agent rows ────────────────────────────────────────────
    const agentRows = await db()
      .select()
      .from(agents)
      .where(eq(agents.timeframe, "5m"));

    const paperTradesByAgent = await getRecentTradesByAgent("streak-5m", "paper", 200);
    const liveTradesByAgent = await getRecentTradesByAgent("streak-5m", "live", 200);

    const rows = STREAK_AGENTS.map((streak) => {
      const agent = agentRows.find((a) => a.id === streak.id);
      const { ladder, target: agentTarget } = ladderForAgent(
        streak.id,
        settingsMap,
        globalTarget,
        globalMultiplier,
        globalSteps,
      );

      const paperTrades = (paperTradesByAgent.get(streak.id) ?? [])
        .filter((t) => t.roundId.startsWith("BTC5M-"))
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );

      const state = computeAgentState(
        paperTrades.map((t) => ({
          stake: Number(t.stake),
          result: t.result,
          targetProfitSnapshot: Number(t.targetProfitSnapshot ?? agentTarget),
        })),
        ladder,
      );

      // Compute signal
      const signal = computeAgentSignal(
        streak,
        recentDirections,
        rsi,
      );
      const triggerActive =
        streak.trigger === "always"
          ? true
          : signal != null;
      const isLive = agent?.isLive === 1;

      // Live stats
      const liveTrades = (liveTradesByAgent.get(streak.id) ?? []).filter(
        (t) => t.roundId.startsWith("BTC5M-"),
      );
      const liveInvested = liveTrades
        .filter((t) => t.result === "pending")
        .reduce((s, t) => s + Number(t.stake), 0);
      const liveProfit = liveTrades
        .filter((t) => t.result !== "pending")
        .reduce((s, t) => s + Number(t.pnl ?? 0), 0);

      return {
        id: streak.id,
        name: streak.name,
        direction: signal ?? (streak.trigger === "always" ? (streak as any).signal : "UP"),
        roundsCompleted: state.roundsCompleted,
        currentStep: state.currentStep,
        previousStep: state.currentStep > 0 ? state.currentStep - 1 : 0,
        invested: state.invested,
        liveInvested,
        targetProfit: globalTarget,
        agentTarget,
        agentMultiplier: settingsMap.get(`multiplier_${streak.id}`) ?? globalMultiplier,
        agentSteps: settingsMap.get(`steps_${streak.id}`) ?? globalSteps,
        profit: state.profit,
        liveProfit,
        loss: state.loss,
        balance: state.profit - state.loss,
        realBalance: state.profit - state.loss,
        capital: (agent?.startingBankroll ?? 1000) + state.profit - state.loss,
        ladder,
        status: state.pending
          ? "active"
          : triggerActive
            ? "ready"
            : state.currentStep > 0
              ? "active"
              : "idle",
        triggerActive,
        isLive,
      };
    });

    // Recommended trades (for Python executor)
    const recommendedTrades = rows
      .filter((r) => r.triggerActive)
      .map((r) => ({
        name: r.name,
        agentId: r.id,
        direction: r.direction,
        stake: r.ladder[r.currentStep - 1] || r.ladder[0],
      }));

    // ── Trade history ───────────────────────────────────────────────
    const allRecentTrades = await db()
      .select()
      .from(trades)
      .where(eq(trades.strategyId, "streak-5m"))
      .orderBy(desc(trades.createdAt))
      .limit(200);

    const paperRecent = allRecentTrades.filter((t) => t.tradeMode !== "live");
    const liveRecent = allRecentTrades.filter((t) => t.tradeMode === "live");

    // ── Stats ───────────────────────────────────────────────────────
    const totalInvested = rows.reduce((s, r) => s + r.invested, 0);
    const totalStartingCapital = STREAK_AGENTS.reduce((s, streak) => {
      const a = agentRows.find((r) => r.id === streak.id);
      return s + (a?.startingBankroll ?? 1000);
    }, 0);

    const [paperPnl] = await db()
      .select({
        total: sql<number>`COALESCE(SUM(CASE WHEN result = 'won' THEN stake WHEN result = 'loss' THEN -stake END), 0)`,
      })
      .from(trades)
      .where(
        and(
          eq(trades.strategyId, "streak-5m"),
          eq(trades.tradeMode, "paper"),
        ),
      );
    const totalEarnings = paperPnl?.total ?? 0;
    const totalBalance = totalEarnings - totalInvested;

    const [liveAgg] = await db()
      .select({
        invested: sql<number>`COALESCE(SUM(stake), 0)`,
        pnl: sql<number>`COALESCE(SUM(pnl), 0)`,
      })
      .from(trades)
      .where(
        and(
          eq(trades.strategyId, "streak-5m"),
          eq(trades.tradeMode, "live"),
        ),
      );

    return NextResponse.json({
      currentWindow: { roundId, startTime: startTimeIso, endTime: endTimeIso },
      rows,
      recommendedTrades,
      recentResultsIcons: recentDirections.map((d) => (d === "UP" ? "↑" : "↓")),
      recentTrades: paperRecent.map((t) => ({ ...t })),
      liveHistory: liveRecent,
      liveFocus: rows.filter(
        (r) =>
          r.triggerActive &&
          (r.id === "PREVIOUS_3_5M" || r.id === "PREVIOUS_5_5M"),
      ),
      rsi,
      trend: marketState
        ? {
            direction: marketState.trendDirection,
            strength: marketState.trendStrength,
          }
        : null,
      trendStrengthThreshold: trendThreshold,
      wallet,
      stats: {
        invested: totalInvested,
        profits: totalEarnings,
        balance: totalBalance,
        capital: totalStartingCapital + totalBalance,
      },
      liveStats: {
        invested: liveAgg?.invested ?? 0,
        profits: liveAgg?.pnl ?? 0,
        balance: (wallet?.balance ?? 0) || (liveAgg?.pnl ?? 0) - (liveAgg?.invested ?? 0),
        capital: (wallet?.balance ?? 0) || 1000,
      },
      displayTargetProfit: displayTarget,
      displayMultiplier,
      displayLadderSteps: displaySteps,
      displayTrendThreshold: trendThreshold,
    });
  } catch (e) {
    console.error("[API] /api/btc-5m error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
