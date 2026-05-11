import http from "node:http";
import { db, agents, rounds, trades, settings } from "@/db/index";
import { eq, and, desc, lt } from "drizzle-orm";
import { buildLadder, replayStreakMachine } from "@/lib/trading/streak-machine";
import { sendTradeAlert, sendSummary, sendTelegramMessage, isTelegramEnabled } from "@/lib/telegram/bot";
import { buildMarketState, type MarketState } from "@/lib/trading/local-selection";
import { fetchPolymarketOutcome, fetchPolymarketSharePrice } from "@/lib/trading/polymarket";

const STREAK_AGENTS = [
  // Always-trade agents
  { id: "EVERY_UP_5M", name: "Every UP", signal: "UP" as const, trigger: "always" as const },
  { id: "EVERY_DOWN_5M", name: "Every DOWN", signal: "DOWN" as const, trigger: "always" as const },
  // Mean reversion agents
  { id: "PREVIOUS_5M", name: "Previous", streak: 2 },
  { id: "PREVIOUS_3_5M", name: "Previous 3", streak: 3 },
  { id: "PREVIOUS_5_5M", name: "Previous 5", streak: 5 },
  // Single RSI agent that picks direction based on RSI
  { id: "RSI_5M", name: "RSI", trigger: "rsi" as const },
];

async function getSetting(key: string, fallback: number): Promise<number> {
  try {
    const setting = await db().query.settings.findFirst({ where: eq(settings.key, key) });
    return setting ? Number(setting.value) : fallback;
  } catch {
    return fallback;
  }
}

async function getTargetProfit() {
  return getSetting("martingale_target_profit", 5);
}

async function getMultiplier() {
  return getSetting("martingale_multiplier", 3);
}

async function getLadderSteps() {
  return getSetting("martingale_ladder_steps", 8);
}

async function getTrendStrengthThreshold() {
  return getSetting("trend_strength_threshold", 8);
}

async function fetchKlineClosePrices(): Promise<{ spot: number; closes: Map<number, number> }> {
  try {
    const res = await fetch("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=10")
    const data = await res.json()
    const closes = new Map<number, number>()
    for (const kline of data) {
      closes.set(kline[0] / 1000, Number(kline[4]))
    }
    const spot = Number(data[data.length - 1]?.[4] ?? 0)
    return { spot, closes }
  } catch (e) {
    console.error("[ERROR] Failed to fetch klines:", e)
    return { spot: 0, closes: new Map() }
  }
}

async function fetchBtcPrice(): Promise<number> {
  const { spot } = await fetchKlineClosePrices()
  return spot
}

function calculateRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

async function getClosedRounds() {
  return db().select().from(rounds).where(and(eq(rounds.timeframe, "5m"), eq(rounds.status, "closed"))).orderBy(desc(rounds.startTime)).limit(50);
}

async function getAgentState(agentId: string, ladder: number[], targetProfit: number) {
  const agentTrades = await db().select().from(trades).where(and(eq(trades.agentId, agentId), eq(trades.strategyId, "streak-5m"), eq(trades.tradeMode, "paper"))).orderBy(desc(trades.createdAt)).limit(100);
  
  const settled = agentTrades.filter((t) => t.result !== "pending").reverse();
  let currentStep = 0;
  let invested = 0;
  let profit = 0;
  let loss = 0;
  let roundsCompleted = 0;
  
  for (const trade of settled) {
    roundsCompleted++;
    const stake = Number(trade.stake);
    const stepIndex = ladder.indexOf(stake);
    const step = stepIndex >= 0 ? stepIndex + 1 : currentStep + 1;
    currentStep = step;
    invested = ladder.slice(0, step).reduce((s, v) => s + v, 0);
    
    if (trade.result === "won") {
      profit += Number(trade.pnl || targetProfit);
      currentStep = 0;
      invested = 0;
    } else {
      loss += stake;
      if (step >= ladder.length) {
        currentStep = 0;
        invested = 0;
      }
    }
  }
  
  const pending = agentTrades.find((t) => t.result === "pending");
  if (pending) {
    const pendingStake = Number(pending.stake);
    const stepIndex = ladder.indexOf(pendingStake);
    currentStep = stepIndex >= 0 ? stepIndex + 1 : 1;
    invested = ladder.slice(0, currentStep).reduce((s, v) => s + v, 0);
  }
  
  return { currentStep, invested, profit, loss, roundsCompleted, pending: !!pending };
}

let lastProcessedWindow = 0;

async function runCycle() {
  const now = new Date();
  const intervalS = 300;
  const currentTs = Math.floor(now.getTime() / 1000);
  const windowTs = currentTs - (currentTs % intervalS);
  const startTimeIso = new Date(windowTs * 1000).toISOString();
  const endTimeIso = new Date((windowTs + intervalS) * 1000).toISOString();
  const roundId = `BTC5M-${windowTs}`;
  
  const isNewWindow = windowTs !== lastProcessedWindow;
  
    const { spot: btcPrice, closes: windowCloses } = await fetchKlineClosePrices();
    if (!btcPrice || isNaN(btcPrice)) {
      return;
    }
  
  // Resolve previous open rounds
  const openRounds = await db().select().from(rounds)
    .where(and(eq(rounds.timeframe, "5m"), eq(rounds.status, "open"), lt(rounds.startTime, startTimeIso)))
    .orderBy(desc(rounds.startTime))
    .limit(5);
  
  for (const openRound of openRounds) {
    let prevPrice = Number(openRound.entryPrice);
    
    if (prevPrice <= 0) {
      await db().update(rounds).set({
        exitPrice: btcPrice,
        resolvedDirection: null,
        status: "closed",
        updatedAt: new Date().toISOString(),
      }).where(eq(rounds.id, openRound.id));
      continue;
    }
    
    let direction: string | null = null;
    let resolutionSource = "binance";
    try {
      const polyDirection = await fetchPolymarketOutcome(openRound.roundId);
      if (polyDirection) {
        direction = polyDirection;
        resolutionSource = "polymarket";
      }
    } catch {}
    if (!direction) {
      const roundStartTs = Math.floor(new Date(openRound.startTime).getTime() / 1000)
      const exitPrice = windowCloses.get(roundStartTs) ?? btcPrice
      await db().update(rounds).set({
        exitPrice,
        updatedAt: new Date().toISOString(),
      }).where(eq(rounds.id, openRound.id));
      const roundEndTime = new Date(openRound.endTime).getTime();
      const minutesSinceEnd = (Date.now() - roundEndTime) / 60000;
      if (minutesSinceEnd < 1) {
        console.log(`[WAIT] Round ${openRound.roundId} waiting for Polymarket resolution (${minutesSinceEnd.toFixed(1)}m since end)`);
        continue;
      }
      console.log(`[FALLBACK] Round ${openRound.roundId} no Polymarket resolution after ${minutesSinceEnd.toFixed(1)}m, using kline close`);
      direction = exitPrice > prevPrice ? "UP" : exitPrice < prevPrice ? "DOWN" : null;
    }
    
    const roundStartTs = Math.floor(new Date(openRound.startTime).getTime() / 1000)
    const closePrice = windowCloses.get(roundStartTs) ?? btcPrice

    await db().update(rounds).set({
      exitPrice: closePrice,
      resolvedDirection: direction,
      status: "closed",
      updatedAt: new Date().toISOString(),
    }).where(eq(rounds.id, openRound.id));
    
    const roundTrades = await db().select().from(trades).where(and(eq(trades.roundId, openRound.roundId), eq(trades.result, "pending")));
    
    for (const trade of roundTrades) {
      const won = direction && trade.signal === direction;
      let pnl: number;
      
      if (won) {
        // Find prior losses in this agent's current martingale cycle
        const recentAgentTrades = await db().select().from(trades)
          .where(and(eq(trades.agentId, trade.agentId), eq(trades.strategyId, "streak-5m")))
          .orderBy(desc(trades.createdAt))
          .limit(20);
        let cycleLossSum = 0;
        for (const t of recentAgentTrades) {
          if (t.id === trade.id) break;
          if (t.result === "won") break;
          if (t.result === "loss") cycleLossSum += Number(t.stake);
        }
        pnl = Number(trade.stake) - cycleLossSum;
      } else {
        pnl = -Number(trade.stake);
      }
      
      await db().update(trades).set({
        result: won ? "won" : "loss",
        pnl,
        exitPrice: closePrice,
        updatedAt: new Date().toISOString(),
      }).where(eq(trades.id, trade.id));
      
      console.log(`[RESOLVE] ${trade.agentId} | ${openRound.roundId} | signal:${trade.signal} | actual:${direction} (${resolutionSource}) | result:${won ? "WON" : "LOSS"} | pnl:$${pnl.toFixed(2)} | PM:$${Number(trade.polymarketPrice ?? 0).toFixed(2)}`);

      // Telegram alert for resolved trade
      await sendTradeAlert("resolved", trade.agentId, openRound.roundId, trade.signal, Number(trade.stake), 0, 0, won ? "won" : "loss", pnl, Number(trade.polymarketPrice ?? null));
    }
    
    console.log(`[RESOLVE] Round ${openRound.roundId} closed | direction:${direction} | src:${resolutionSource} | entry:$${prevPrice.toFixed(2)} | exit:$${btcPrice.toFixed(2)}`);
  }
  
  if (isNewWindow) {
    lastProcessedWindow = windowTs;

    const targetProfit = await getTargetProfit();
    const multiplier = await getMultiplier();
    const ladderSteps = await getLadderSteps();
    const trendThreshold = await getTrendStrengthThreshold();
    const ladder = buildLadder(targetProfit, multiplier, ladderSteps);

    // Load all settings including per-agent overrides
    const allSettings = await db().select().from(settings);
    const settingMap: Record<string, number> = {};
    for (const s of allSettings) {
      const val = Number(s.value);
      if (!Number.isNaN(val)) settingMap[s.key] = val;
    }
    function perAgentVal(agentId: string, key: string, fallback: number): number {
      return settingMap[`${key}_${agentId}`] ?? fallback;
    }
    
    console.log(`\n[${new Date().toISOString()}] New window: ${roundId} | BTC: $${btcPrice.toFixed(2)} | Target:$${targetProfit} | Multiplier:${multiplier}x | Steps:${ladderSteps}`);
    
    const existingRound = await db().query.rounds.findFirst({ where: eq(rounds.roundId, roundId) });
      if (!existingRound) {
        const parts = roundId.split("-");
        const ts = parts[parts.length - 1];
        const slug = ts ? `btc-updown-5m-${ts}` : null;
        await db().insert(rounds).values({
          id: crypto.randomUUID(),
          roundId,
          asset: "BTC",
          timeframe: "5m",
          startTime: startTimeIso,
          endTime: endTimeIso,
          entryPrice: btcPrice,
          status: "open",
          externalMarketSlug: slug,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      console.log(`[ROUND] Created ${roundId} at $${btcPrice.toFixed(2)}`);
    }
    
    const closedRounds = await getClosedRounds();
    const recentDirections = closedRounds.map((r) => r.resolvedDirection).filter((d): d is string => Boolean(d));
    const previousDirection = recentDirections[0] ?? null;
    
    // Mean reversion streak checks
    function getStreakSignal(minLength: number): string | null {
      if (recentDirections.length < minLength) return null;
      const slice = recentDirections.slice(0, minLength);
      if (slice.every((d) => d === "UP")) return "DOWN";
      if (slice.every((d) => d === "DOWN")) return "UP";
      return null;
    }
    
    const rsi = calculateRsi(
      closedRounds.slice(0, 20).map((r) => Number(r.exitPrice || r.entryPrice)).filter((p) => p > 0).reverse().concat(btcPrice > 0 ? [btcPrice] : []),
      14
    );
    
    let marketState: MarketState | null = null;
    try {
      marketState = await buildMarketState(btcPrice);
    } catch (e) {
      console.warn("[TREND] Failed to build market state:", e);
    }
    
    for (const streak of STREAK_AGENTS) {
      let signal: string | null = null;
      
      if ("signal" in streak && streak.trigger === "always") {
        signal = streak.signal;
      } else if ("streak" in streak && streak.streak != null) {
        signal = getStreakSignal(streak.streak);
      } else if (streak.trigger === "rsi") {
        if (rsi != null && rsi <= 30) signal = "UP";
        else if (rsi != null && rsi >= 80) signal = "DOWN";
      }
      
      if (!signal) continue;

      // Polymarket share price gate: only trade if price < $0.50
      const parts = roundId.split("-");
      const ts = parts[parts.length - 1];
      const pmSlug = ts ? `btc-updown-5m-${ts}` : null;
      let pmPrice: number | null = null;
      if (pmSlug) {
        pmPrice = await fetchPolymarketSharePrice(pmSlug, signal as "UP" | "DOWN");
        if (pmPrice == null) {
          console.log(`[SKIP] ${streak.id} PM price unavailable for ${signal}`);
          continue;
        }
        if (pmPrice >= 0.50) {
          console.log(`[SKIP] ${streak.id} PM price $${pmPrice.toFixed(2)} >= $0.50 for ${signal}`);
          continue;
        }
      }

      // Per-agent settings override globals
      const agentTarget = perAgentVal(streak.id, "target", targetProfit);
      const agentMultiplier = perAgentVal(streak.id, "multiplier", multiplier);
      const agentSteps = perAgentVal(streak.id, "steps", ladderSteps);
      const agentLadder = (agentTarget !== targetProfit || agentMultiplier !== multiplier || agentSteps !== ladderSteps)
        ? buildLadder(agentTarget, agentMultiplier, agentSteps)
        : ladder;
      
      const state = await getAgentState(streak.id, agentLadder, agentTarget);
      if (state.pending) {
        console.log(`[SKIP] ${streak.id} already has pending trade`);
        continue;
      }
      
      const nextStep = Math.max(0, state.currentStep);
      const stake = agentLadder[nextStep] || agentLadder[0];
      
      await db().insert(trades).values({
        id: crypto.randomUUID(),
        agentId: streak.id,
        roundId,
        strategyId: "streak-5m",
        signal,
        stake,
        targetProfitSnapshot: agentTarget,
        result: "pending",
        tradeMode: "paper",
        entryPrice: btcPrice,
        polymarketPrice: pmPrice,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      
      console.log(`[TRADE] ${streak.id} | signal:${signal} | stake:$${stake} | step:${nextStep + 1}/${agentLadder.length} | RSI:${rsi?.toFixed(1) || "N/A"} | PM:$${pmPrice != null ? pmPrice.toFixed(2) : "N/A"}`);

      // Telegram alert for created trade
      await sendTradeAlert("created", streak.id, roundId, signal, stake, nextStep + 1, agentLadder.length, undefined, undefined, pmPrice);
    }

    const trendLabel = marketState ? `${marketState.trendDirection}(${marketState.trendStrength.toFixed(1)})` : "N/A";
    console.log(`[SUMMARY] RSI:${rsi?.toFixed(1) || "N/A"} | trend:${trendLabel} | threshold:${trendThreshold} | prev:${previousDirection}`);
  }
}

async function sendPeriodicSummary() {
  if (!isTelegramEnabled()) return;
  try {
    const allTrades = await db().select().from(trades).where(and(eq(trades.strategyId, "streak-5m"), eq(trades.tradeMode, "paper")));
    const targetProfit = await getTargetProfit();
    const multiplier = await getMultiplier();
    const ladderSteps = await getLadderSteps();
    const ladder = buildLadder(targetProfit, multiplier, ladderSteps);

    let totalRealizedProfit = 0;
    let totalRealizedLoss = 0;
    let totalRounds = 0;
    let totalWins = 0;
    const agentStats = [];

    for (const streak of STREAK_AGENTS) {
      const agentTrades = allTrades
        .filter((t) => t.agentId === streak.id)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const settledTrades = agentTrades.filter((t) => t.result !== "pending");
      const state = replayStreakMachine(
        settledTrades.map((t) => ({
          stake: Number(t.stake),
          result: t.result as "won" | "loss" | "pending" | "skipped",
          targetProfit: Number(t.targetProfitSnapshot ?? targetProfit),
        })),
        ladder,
        targetProfit,
        1000,
      );

      totalRealizedProfit += state.realizedProfit;
      totalRealizedLoss += state.realizedLoss;
      totalRounds += state.roundsCompleted;
      totalWins += state.successfulCycles;

      agentStats.push({
        id: streak.id,
        name: streak.name,
        profit: state.realizedProfit,
        loss: state.realizedLoss,
        balance: state.realizedProfit - state.realizedLoss,
        currentStep: state.currentStep,
      });
    }

    await sendSummary({
      totalTrades: totalRounds,
      totalWins,
      totalLosses: totalRounds - totalWins,
      totalPnl: totalRealizedProfit - totalRealizedLoss,
      agents: agentStats,
    });
  } catch (e) {
    console.error("[Telegram] Summary failed:", e);
  }
}

async function main() {
  const port = Number(process.env.PORT) || 8080;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  server.listen(port, () => {
    console.log(`[HTTP] Health check server listening on port ${port}`);
  });

  const targetProfit = await getTargetProfit();
  const multiplier = await getMultiplier();
  const ladderSteps = await getLadderSteps();
  const ladder = buildLadder(targetProfit, multiplier, ladderSteps);

  console.log("=".repeat(60));
  console.log("DEXTrip Paper Trading Bot");
  console.log("Strategies:", STREAK_AGENTS.map((a) => a.name).join(", "));
  console.log("Ladder:", ladder.join(", "));
  console.log(`Telegram: ${isTelegramEnabled() ? "ENABLED" : "DISABLED"}`);
  console.log("Check interval: 10 seconds");
  console.log("=".repeat(60));

  // Send startup notification
  if (isTelegramEnabled()) {
    await sendTelegramMessage(`🤖 <b>Dextrip Paper Bot Started</b>\n\nTarget: $${targetProfit}\nMultiplier: ${multiplier}x\nSteps: ${ladderSteps}\nLadder: ${ladder.join(", ")}`);
  }

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
