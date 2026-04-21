import { desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { agents, rounds, trades } from "../db/schema";
import { selectStrategyForAgent } from "../lib/trading/local-selection";
import { calculatePnl, calculateStake, exceedsDailyLossLimit } from "../lib/trading/risk";
import { pickPromotedAgent } from "../lib/trading/promotion";

const SLEEP_MS = 60_000;

async function fetchBtcPrice(): Promise<number> {
  const response = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
  const payload = (await response.json()) as { price?: string };
  return Number(payload.price ?? 0);
}

function currentRoundTimes(now: Date) {
  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setMinutes(now.getMinutes() - (now.getMinutes() % 15));
  const end = new Date(start);
  end.setMinutes(start.getMinutes() + 15);
  return { start, end, roundId: `btc-15m-${start.getTime()}` };
}

async function resolveExpiredRound(nowIso: string, currentPrice: number) {
  const activeRound = await db.query.rounds.findFirst({
    where: eq(rounds.status, "active"),
    orderBy: desc(rounds.startTime),
  });

  if (!activeRound) return;
  if (new Date(activeRound.endTime).getTime() > Date.now()) return;

  await db.update(rounds).set({
    exitPrice: currentPrice,
    status: "closed",
    updatedAt: nowIso,
  }).where(eq(rounds.id, activeRound.id));

  const roundTrades = await db.select().from(trades).where(eq(trades.roundId, activeRound.roundId));
  for (const trade of roundTrades) {
    const won =
      (trade.signal === "UP" && currentPrice > activeRound.entryPrice) ||
      (trade.signal === "DOWN" && currentPrice < activeRound.entryPrice);

    const agent = await db.query.agents.findFirst({ where: eq(agents.id, trade.agentId) });
    if (!agent) continue;
    const pnl = calculatePnl(trade.entryPrice, currentPrice, trade.signal as "UP" | "DOWN" | "HOLD", trade.stake ?? 0);

    await db.update(trades).set({
      exitPrice: currentPrice,
      result: won ? "won" : "loss",
      pnl,
      updatedAt: nowIso,
    }).where(eq(trades.id, trade.id));

    const nextWon = agent.won + (won ? 1 : 0);
    const nextLoss = agent.loss + (won ? 0 : 1);
    const nextWinRate = nextWon + nextLoss > 0 ? (nextWon / (nextWon + nextLoss)) * 100 : 0;
    const nextBankroll = Number((agent.bankroll + pnl).toFixed(2));
    const nextTotalPnl = Number((agent.totalPnl + pnl).toFixed(2));
    const nextDailyPnl = Number((agent.dailyPnl + pnl).toFixed(2));
    const drawdown = Math.max(0, agent.startingBankroll - nextBankroll);
    const nextMaxDrawdown = Math.max(agent.maxDrawdown, drawdown);

    await db.update(agents).set({
      won: nextWon,
      loss: nextLoss,
      winRate: nextWinRate,
      bankroll: nextBankroll,
      totalPnl: nextTotalPnl,
      dailyPnl: nextDailyPnl,
      maxDrawdown: nextMaxDrawdown,
      updatedAt: nowIso,
    }).where(eq(agents.id, agent.id));
  }

  const rankedAgents = await db.select().from(agents);
  const topAgent = pickPromotedAgent(rankedAgents);
  for (const agent of rankedAgents) {
    await db.update(agents).set({
      promoted: agent.id === topAgent?.id,
      updatedAt: nowIso,
    }).where(eq(agents.id, agent.id));
  }

  console.log(`Resolved ${activeRound.roundId} at $${currentPrice.toFixed(2)}`);
}

async function ensureCurrentRound(nowIso: string, currentPrice: number) {
  const { start, end, roundId } = currentRoundTimes(new Date());
  const existing = await db.query.rounds.findFirst({ where: eq(rounds.roundId, roundId) });
  if (existing) return;

  await db.insert(rounds).values({
    id: crypto.randomUUID(),
    roundId,
    asset: "BTC-15M",
    timeframe: "15m",
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    entryPrice: currentPrice,
    exitPrice: null,
    status: "active",
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const activeAgents = await db.select().from(agents);
  for (const agent of activeAgents) {
    if (exceedsDailyLossLimit(agent.startingBankroll, agent.dailyPnl)) {
      await db.insert(trades).values({
        id: crypto.randomUUID(),
        agentId: agent.id,
        roundId,
        strategyId: "",
        signal: "HOLD",
        confidence: 0.45,
        strategyScore: 0,
        stake: 0,
        pnl: 0,
        report: "Daily loss limit hit, risk controls forced a hold.",
        entryPrice: currentPrice,
        exitPrice: null,
        result: "pending",
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      continue;
    }

    const selection = await selectStrategyForAgent(agent);
    const stake = selection.signal === "HOLD" ? 0 : calculateStake(agent.bankroll, selection.confidence, selection.score);

    await db.insert(trades).values({
      id: crypto.randomUUID(),
      agentId: agent.id,
      roundId,
      strategyId: selection.strategyId,
      signal: selection.signal,
      confidence: selection.confidence,
      strategyScore: selection.score,
      stake,
      pnl: 0,
      report: selection.report,
      entryPrice: currentPrice,
      exitPrice: null,
      result: "pending",
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  console.log(`Opened ${roundId} at $${currentPrice.toFixed(2)}`);
}

async function tick() {
  const nowIso = new Date().toISOString();
  const currentPrice = await fetchBtcPrice();
  await resolveExpiredRound(nowIso, currentPrice);
  await ensureCurrentRound(nowIso, currentPrice);
}

console.log("Starting local Dextrip arena loop...");
await tick();
setInterval(() => {
  tick().catch((error) => console.error("Arena loop tick failed:", error));
}, SLEEP_MS);
