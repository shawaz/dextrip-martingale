import { db, agents, rounds, trades, settings } from "@/db/index";
import { eq, and, desc, lt } from "drizzle-orm";
import { buildLadder } from "@/lib/trading/streak-machine";
import { sendTradeAlert, sendSummary, sendTelegramMessage, isTelegramEnabled } from "@/lib/telegram/bot";

const STREAK_AGENTS = [
  // Always-trade agents with streak (not mean reversion)
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

async function fetchBtcPrice(): Promise<number> {
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
    const data = await res.json();
    return Number(data.price);
  } catch (e) {
    console.error("[ERROR] Failed to fetch BTC price:", e);
    return 0;
  }
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
  
  const btcPrice = await fetchBtcPrice();
  if (btcPrice === 0) {
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
    
    const direction = btcPrice > prevPrice ? "UP" : btcPrice < prevPrice ? "DOWN" : null;
    
    await db().update(rounds).set({
      exitPrice: btcPrice,
      resolvedDirection: direction,
      status: "closed",
      updatedAt: new Date().toISOString(),
    }).where(eq(rounds.id, openRound.id));
    
    const roundTrades = await db().select().from(trades).where(and(eq(trades.roundId, openRound.roundId), eq(trades.result, "pending")));
    
    for (const trade of roundTrades) {
      const won = direction && trade.signal === direction;
      const pnl = won ? Number(trade.targetProfitSnapshot || 5) : -Number(trade.stake);
      
      await db().update(trades).set({
        result: won ? "won" : "loss",
        pnl,
        exitPrice: btcPrice,
        updatedAt: new Date().toISOString(),
      }).where(eq(trades.id, trade.id));
      
      console.log(`[RESOLVE] ${trade.agentId} | ${openRound.roundId} | signal:${trade.signal} | actual:${direction} | result:${won ? "WON" : "LOSS"} | pnl:$${pnl.toFixed(2)}`);

      // Telegram alert for resolved trade
      await sendTradeAlert("resolved", trade.agentId, openRound.roundId, trade.signal, Number(trade.stake), 0, 0, won ? "won" : "loss", pnl);
    }
    
    console.log(`[RESOLVE] Round ${openRound.roundId} closed | direction:${direction} | entry:$${prevPrice.toFixed(2)} | exit:$${btcPrice.toFixed(2)}`);
  }
  
  if (isNewWindow) {
    lastProcessedWindow = windowTs;
    
    const targetProfit = await getTargetProfit();
    const multiplier = await getMultiplier();
    const ladderSteps = await getLadderSteps();
    const ladder = buildLadder(targetProfit, multiplier, ladderSteps);
    
    console.log(`\n[${new Date().toISOString()}] New window: ${roundId} | BTC: $${btcPrice.toFixed(2)} | Target:$${targetProfit} | Multiplier:${multiplier}x | Steps:${ladderSteps}`);
    
    const existingRound = await db().query.rounds.findFirst({ where: eq(rounds.roundId, roundId) });
    if (!existingRound) {
      await db().insert(rounds).values({
        id: crypto.randomUUID(),
        roundId,
        asset: "BTC",
        timeframe: "5m",
        startTime: startTimeIso,
        endTime: endTimeIso,
        entryPrice: btcPrice,
        status: "open",
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
    
    for (const streak of STREAK_AGENTS) {
      let signal: string | null = null;
      
      if ("signal" in streak && streak.trigger === "always") {
        // Every UP / Every DOWN — always trade their fixed signal
        signal = streak.signal;
      } else if ("streak" in streak && streak.streak != null) {
        // Previous agents — mean reversion
        signal = getStreakSignal(streak.streak);
      } else if (streak.trigger === "rsi") {
        // RSI agent — only ONE direction at a time
        if (rsi != null && rsi <= 30) signal = "UP";
        else if (rsi != null && rsi >= 80) signal = "DOWN";
      }
      
      if (!signal) continue;
      
      const state = await getAgentState(streak.id, ladder, targetProfit);
      if (state.pending) {
        console.log(`[SKIP] ${streak.id} already has pending trade`);
        continue;
      }
      
      const nextStep = Math.max(0, state.currentStep);
      const stake = ladder[nextStep] || ladder[0];
      
      await db().insert(trades).values({
        id: crypto.randomUUID(),
        agentId: streak.id,
        roundId,
        strategyId: "streak-5m",
        signal,
        stake,
        targetProfitSnapshot: targetProfit,
        result: "pending",
        tradeMode: "paper",
        entryPrice: btcPrice,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      
      console.log(`[TRADE] ${streak.id} | signal:${signal} | stake:$${stake} | step:${nextStep + 1}/${ladder.length} | RSI:${rsi?.toFixed(1) || "N/A"}`);

      // Telegram alert for created trade
      await sendTradeAlert("created", streak.id, roundId, signal, stake, nextStep + 1, ladder.length);
    }

    console.log(`[SUMMARY] RSI:${rsi?.toFixed(1) || "N/A"} | prev:${previousDirection}`);
  }
}

async function sendPeriodicSummary() {
  if (!isTelegramEnabled()) return;
  try {
    const allTrades = await db().select().from(trades).where(and(eq(trades.strategyId, "streak-5m"), eq(trades.tradeMode, "paper")));
    const totalWins = allTrades.filter((t) => t.result === "won").length;
    const totalLosses = allTrades.filter((t) => t.result === "loss").length;
    const totalPnl = allTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0);

    const agentStats = [];
    for (const streak of STREAK_AGENTS) {
      const agentTrades = allTrades.filter((t) => t.agentId === streak.id);
      const profit = agentTrades.filter((t) => t.result === "won").reduce((sum, t) => sum + Number(t.pnl || 0), 0);
      const loss = agentTrades.filter((t) => t.result === "loss").reduce((sum, t) => sum + Math.abs(Number(t.pnl || 0)), 0);
      const pending = agentTrades.find((t) => t.result === "pending");
      const currentStep = pending ? Math.max(1, allTrades.filter((t) => t.agentId === streak.id && t.result !== "pending").length % 8) : 0;
      agentStats.push({
        id: streak.id,
        name: streak.name,
        profit,
        loss,
        balance: profit - loss,
        currentStep,
      });
    }

    await sendSummary({
      totalTrades: allTrades.length,
      totalWins,
      totalLosses,
      totalPnl,
      agents: agentStats,
    });
  } catch (e) {
    console.error("[Telegram] Summary failed:", e);
  }
}

async function main() {
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
