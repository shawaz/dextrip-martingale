/**
 * Dextrip Paper Trading Bot — single source of truth for all trade logic.
 * 
 * Runs every 10 seconds. On each new 5-minute window:
 *   1. Resolve previous open rounds (Binance + Polymarket)
 *   2. Compute signals for all 6 agents
 *   3. Check Polymarket share price < $0.50
 *   4. Create trades in DB (paper mode)
 *   5. If agent.isLive → execute real Polymarket order
 * 
 * Also sends periodic Telegram summaries every 30 minutes.
 */

import http from "node:http";
import {
  fetchBtcPrice,
} from "@/lib/core/price";
import {
  calculateRsi,
} from "@/lib/core/rsi";
import {
  getSettingsMap,
  clearSettingsCache,
} from "@/lib/core/settings";
import {
  createRound,
  closeRound,
  getClosedRounds,
  getOpenRoundsToResolve,
  computeWindow,
} from "@/lib/core/rounds";
import {
  createTrade,
  resolveTrade,
} from "@/lib/core/trades";
import {
  computeAgentSignal,
  STREAK_AGENTS,
} from "@/lib/core/streak";
import {
  buildLadder,
} from "@/lib/core/streak-machine";
import {
  seedAgents,
  ladderForAgent,
} from "@/lib/core/agents";
import {
  checkPriceBelowThreshold,
  windowTsToSlug,
} from "@/lib/core/polymarket";
import {
  sendTradeAlert,
  sendSummary,
  sendTelegramMessage,
  isTelegramEnabled,
} from "@/lib/telegram/bot";
import { db, agents as agentsTable } from "@/db/index";
import { eq, and, desc } from "drizzle-orm";
import { trades as tradesTable } from "@/db/schema";

// ─── State ──────────────────────────────────────────────────────────

let lastProcessedWindow = 0;

// ─── Live Polymarket Execution ──────────────────────────────────────

/**
 * Place a live market buy order on Polymarket CLOB.
 * Uses the Gamma API token IDs and CLOB REST API directly.
 */
async function executeLiveOrder(params: {
  slug: string;
  direction: "UP" | "DOWN";
  amount: number;
}): Promise<{ success: boolean; orderId?: string; error?: string }> {
  const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
  const funder = process.env.POLYMARKET_FUNDER;
  if (!privateKey || !funder) {
    return { success: false, error: "Missing POLYMARKET_PRIVATE_KEY or FUNDER" };
  }

  try {
    // 1. Get token IDs from Gamma API
    const gammaRes = await fetch(
      `https://gamma-api.polymarket.com/markets/slug/${params.slug}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!gammaRes.ok) {
      return { success: false, error: `Gamma API returned ${gammaRes.status}` };
    }
    const data = await gammaRes.json();
    const market = Array.isArray(data) ? data[0] : data;
    const tokenIds: string[] = JSON.parse(market.clobTokenIds ?? "[]");
    if (tokenIds.length < 2) {
      return { success: false, error: "No token IDs found" };
    }

    const tokenId = params.direction === "UP" ? tokenIds[0] : tokenIds[1];
    const amount = Math.round(params.amount * 100) / 100; // Round to 2 decimals

    // 2. Place market order via CLOB API (requires py_clob_client)
    // For now, shell out to the Python executor or bullpen CLI
    const { execSync } = await import("node:child_process");

    // Try bullpen CLI first
    try {
      const outcome = params.direction;
      const cmd = `bullpen polymarket buy "${params.slug}" ${outcome} ${amount.toFixed(2)} --yes`;
      console.log(`[LIVE EXEC] ${cmd}`);
      const result = execSync(cmd, {
        encoding: "utf8",
        timeout: 15000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      console.log(`[LIVE SUCCESS] ${result.substring(0, 200)}`);
      return { success: true, orderId: `bullpen-${Date.now()}` };
    } catch (bullpenErr: any) {
      // If bullpen fails, try Python executor
      console.log(`[LIVE] bullpen failed, trying python executor...`);
      try {
        const pythonCmd = `python3 martingale_executor.py --single --slug "${params.slug}" --direction ${params.direction} --amount ${amount.toFixed(2)}`;
        const result = execSync(pythonCmd, {
          encoding: "utf8",
          timeout: 15000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        console.log(`[LIVE PYTHON] ${result.substring(0, 200)}`);
        return { success: true, orderId: `python-${Date.now()}` };
      } catch (pyErr: any) {
        return {
          success: false,
          error: `bullpen: ${bullpenErr.message}, python: ${pyErr.message}`,
        };
      }
    }
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ─── Main Cycle ─────────────────────────────────────────────────────

async function runCycle() {
  const { roundId, windowTs, startTimeIso, endTimeIso } = computeWindow();
  const isNewWindow = windowTs !== lastProcessedWindow;

  // Fetch BTC price
  const btcPrice = await fetchBtcPrice();
  if (!btcPrice || isNaN(btcPrice)) return;

  const now = new Date().toISOString();

  // ── Resolve previous open rounds ──────────────────────────────────
  const openRounds = await getOpenRoundsToResolve(startTimeIso);
  for (const openRound of openRounds) {
    const { direction, source } = await closeRound({
      roundId: openRound.roundId,
      btcPrice,
    });

    // Resolve all pending trades for this round
    const roundTrades = await db()
      .select()
      .from(tradesTable)
      .where(
        and(
          eq(tradesTable.roundId, openRound.roundId),
          eq(tradesTable.result, "pending"),
        ),
      );

    for (const trade of roundTrades) {
      const { won, pnl } = await resolveTrade({
        tradeId: trade.id,
        direction,
        exitPrice: btcPrice,
      });

      console.log(
        `[RESOLVE] ${trade.agentId} | ${openRound.roundId} | ` +
          `signal:${trade.signal} | actual:${direction} (${source}) | ` +
          `result:${won ? "WON" : "LOSS"} | pnl:$${pnl.toFixed(2)}`,
      );

      // Telegram alert
      await sendTradeAlert(
        "resolved",
        trade.agentId,
        openRound.roundId,
        trade.signal,
        Number(trade.stake),
        0,
        0,
        won ? "won" : "loss",
        pnl,
      );
    }

    console.log(
      `[RESOLVE] Round ${openRound.roundId} closed | ` +
        `direction:${direction} | src:${source} | ` +
        `entry:$${Number(openRound.entryPrice).toFixed(2)} | ` +
        `exit:$${btcPrice.toFixed(2)}`,
    );
  }

  // ── New window: create round and trades ───────────────────────────
  if (isNewWindow) {
    lastProcessedWindow = windowTs;

    // Seed agents + load settings
    await seedAgents();
    const settingsMap = await getSettingsMap();
    const globalTarget = settingsMap.get("martingale_target_profit") ?? 5;
    const globalMultiplier = settingsMap.get("martingale_multiplier") ?? 3;
    const globalSteps = settingsMap.get("martingale_ladder_steps") ?? 8;
    const globalLadder = buildLadder(globalTarget, globalMultiplier, globalSteps);

    console.log(
      `\n[${now}] New window: ${roundId} | BTC: $${btcPrice.toFixed(2)} | ` +
        `Target:$${globalTarget} | ${globalMultiplier}x | ${globalSteps} steps`,
    );

    // Create round
    const roundResult = await createRound({
      roundId,
      startTime: startTimeIso,
      endTime: endTimeIso,
      entryPrice: btcPrice,
    });
    if (roundResult.created) {
      console.log(`[ROUND] Created ${roundId} at $${btcPrice.toFixed(2)}`);
    }

    // Get recent directions for streak signals
    const closedRounds = await getClosedRounds(50);
    const recentDirections = closedRounds
      .map((r) => r.resolvedDirection)
      .filter((d): d is string => Boolean(d));

    // RSI
    const rsiPrices = closedRounds
      .slice(0, 20)
      .map((r) => Number(r.exitPrice || r.entryPrice))
      .filter((p) => p > 0)
      .reverse();
    if (btcPrice > 0) rsiPrices.push(btcPrice);
    const rsi = calculateRsi(rsiPrices, 14);

    // Load all agents for live status
    const allAgents = await db()
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.timeframe, "5m"));

    // Slug for price checks
    const slug = windowTsToSlug(windowTs);

    // Evaluate each agent
    for (const streak of STREAK_AGENTS) {
      const signal = computeAgentSignal(streak, recentDirections, rsi);
      if (!signal) continue;

      const { ladder, target: agentTarget } = ladderForAgent(
        streak.id,
        settingsMap,
        globalTarget,
        globalMultiplier,
        globalSteps,
      );

      // Get agent state to determine current ladder step
      const agentTrades = await db()
        .select()
        .from(tradesTable)
        .where(
          and(
            eq(tradesTable.agentId, streak.id),
            eq(tradesTable.strategyId, "streak-5m"),
            eq(tradesTable.tradeMode, "paper"),
          ),
        )
        .orderBy(desc(tradesTable.createdAt))
        .limit(50);

      // Check for existing pending trade
      const hasPending = agentTrades.some(
        (t) => t.result === "pending" && t.roundId === roundId,
      );
      if (hasPending) {
        console.log(`[SKIP] ${streak.id} already has pending trade`);
        continue;
      }

      // Compute current step
      let currentStep = 0;
      for (const t of agentTrades.filter((t) => t.result !== "pending").reverse()) {
        if (t.result === "won") break;
        const stepIdx = ladder.indexOf(Number(t.stake));
        currentStep = stepIdx >= 0 ? stepIdx + 1 : currentStep + 1;
      }

      const nextStep = Math.max(0, currentStep);
      const stake = ladder[nextStep] ?? ladder[0];

      // Check if this agent is live
      const agentRow = allAgents.find((a) => a.id === streak.id);
      const isLive = agentRow?.isLive === 1;
      const tradeMode = isLive ? "live" : "paper";

      // Create trade (includes $0.50 Polymarket price check)
      const tradeResult = await createTrade({
        agentId: streak.id,
        roundId,
        windowTs,
        signal,
        stake,
        agentTarget,
        entryPrice: btcPrice,
        tradeMode,
        ladderStep: nextStep + 1,
        ladderLength: ladder.length,
      });

      if (tradeResult.skipped) {
        console.log(
          `[SKIP] ${streak.id} | ${signal} | ${tradeResult.reason}`,
        );
        continue;
      }

      if (!tradeResult.created) continue;

      console.log(
        `[TRADE] ${streak.id} | signal:${signal} | stake:$${stake} | ` +
          `step:${nextStep + 1}/${ladder.length} | ` +
          `RSI:${rsi?.toFixed(1) ?? "N/A"} | ` +
          `polyPrice:$${(tradeResult.polymarketPrice ?? 0).toFixed(4)}`,
      );

      // Telegram alert
      await sendTradeAlert(
        "created",
        streak.id,
        roundId,
        signal,
        stake,
        nextStep + 1,
        ladder.length,
      );

      // ── Live execution ─────────────────────────────────────────
      if (isLive) {
        console.log(
          `[LIVE] Executing real order for ${streak.id}: ${signal} $${stake}`,
        );
        const liveResult = await executeLiveOrder({
          slug,
          direction: signal,
          amount: stake,
        });

        // Update trade with order result
        if (tradeResult.tradeId) {
          await db()
            .update(tradesTable)
            .set({
              orderStatus: liveResult.success ? "submitted" : "failed",
              externalOrderId: liveResult.orderId ?? null,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(tradesTable.id, tradeResult.tradeId));
        }

        if (liveResult.success) {
          console.log(`[LIVE OK] ${streak.id} order placed: ${liveResult.orderId}`);
          await sendTelegramMessage(
            `✅ <b>LIVE ORDER</b> ${streak.name}\n` +
              `${signal} $${stake.toFixed(2)} on ${slug}\n` +
              `Order: ${liveResult.orderId}`,
          );
        } else {
          console.error(`[LIVE FAIL] ${streak.id}: ${liveResult.error}`);
          await sendTelegramMessage(
            `❌ <b>LIVE ORDER FAILED</b> ${streak.name}\n` +
              `${signal} $${stake.toFixed(2)}\n` +
              `Error: ${liveResult.error}`,
          );
        }
      }
    }

    const prevDir = recentDirections[0] ?? "N/A";
    console.log(
      `[SUMMARY] RSI:${rsi?.toFixed(1) ?? "N/A"} | prev:${prevDir}`,
    );
  }
}

// ─── Periodic Summary ───────────────────────────────────────────────

async function sendPeriodicSummary() {
  if (!isTelegramEnabled()) return;
  try {
    const allTrades = await db()
      .select()
      .from(tradesTable)
      .where(
        and(
          eq(tradesTable.strategyId, "streak-5m"),
          eq(tradesTable.tradeMode, "paper"),
        ),
      );

    const settingsMap = await getSettingsMap();
    const globalTarget = settingsMap.get("martingale_target_profit") ?? 5;

    let totalProfit = 0;
    let totalLoss = 0;
    let totalRounds = 0;
    let totalWins = 0;
    const agentStats: Array<{
      id: string;
      name: string;
      profit: number;
      loss: number;
      balance: number;
      currentStep: number;
    }> = [];

    for (const streak of STREAK_AGENTS) {
      const agentTrades = allTrades
        .filter((t) => t.agentId === streak.id)
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() -
            new Date(b.createdAt).getTime(),
        );

      let profit = 0;
      let loss = 0;
      let rounds = 0;
      let wins = 0;
      let step = 0;

      for (const t of agentTrades) {
        if (t.result === "pending") continue;
        rounds++;
        if (t.result === "won") {
          wins++;
          profit += Number(t.targetProfitSnapshot ?? globalTarget);
          step = 0;
        } else {
          loss += Number(t.stake);
          step++;
        }
      }

      totalProfit += profit;
      totalLoss += loss;
      totalRounds += rounds;
      totalWins += wins;

      agentStats.push({
        id: streak.id,
        name: streak.name,
        profit,
        loss,
        balance: profit - loss,
        currentStep: step,
      });
    }

    await sendSummary({
      totalTrades: totalRounds,
      totalWins,
      totalLosses: totalRounds - totalWins,
      totalPnl: totalProfit - totalLoss,
      agents: agentStats,
    });

    // Clear settings cache so next cycle picks up changes
    clearSettingsCache();
  } catch (e) {
    console.error("[Telegram] Summary failed:", e);
  }
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const port = Number(process.env.PORT) || 8080;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  server.listen(port, () => {
    console.log(`[HTTP] Health check server on port ${port}`);
  });

  const settingsMap = await getSettingsMap();
  const target = settingsMap.get("martingale_target_profit") ?? 5;
  const multiplier = settingsMap.get("martingale_multiplier") ?? 3;
  const steps = settingsMap.get("martingale_ladder_steps") ?? 8;
  const ladder = buildLadder(target, multiplier, steps);

  console.log("=".repeat(60));
  console.log("DEXTrip Paper Trading Bot v2");
  console.log("Strategies:", STREAK_AGENTS.map((a) => a.name).join(", "));
  console.log("Ladder:", ladder.join(", "));
  console.log(`Telegram: ${isTelegramEnabled() ? "ENABLED" : "DISABLED"}`);
  console.log("Check interval: 10 seconds");
  console.log("Price filter: $0.50 Polymarket threshold");
  console.log("=".repeat(60));

  if (isTelegramEnabled()) {
    await sendTelegramMessage(
      `🤖 <b>Dextrip Paper Bot v2 Started</b>\n\n` +
        `Target: $${target}\nMultiplier: ${multiplier}x\n` +
        `Steps: ${steps}\nLadder: ${ladder.join(", ")}\n` +
        `Price filter: < $0.50`,
    );
  }

  // Run immediately
  await runCycle();

  // Trade cycle every 10 seconds
  setInterval(async () => {
    try {
      await runCycle();
    } catch (e) {
      console.error("[FATAL] Cycle failed:", e);
    }
  }, 10_000);

  // Summary every 30 minutes
  setInterval(async () => {
    try {
      await sendPeriodicSummary();
    } catch (e) {
      console.error("[FATAL] Summary failed:", e);
    }
  }, 30 * 60 * 1000);
}

main().catch(console.error);
