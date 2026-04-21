import { desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { agents, rounds, trades } from "../db/schema";
import { calculatePnl } from "../lib/trading/risk";
import { pickPromotedAgent, promotionScore } from "../lib/trading/promotion";

const latestRound = await db.query.rounds.findFirst({ orderBy: desc(rounds.startTime) });
if (!latestRound) {
  console.log("No round found.");
  process.exit(0);
}

if (latestRound.status === "closed") {
  console.log("Latest round already closed.");
  process.exit(0);
}

const response = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
const payload = (await response.json()) as { price?: string };
const exitPrice = Number(payload.price ?? latestRound.entryPrice);
const now = new Date().toISOString();

await db.update(rounds).set({
  exitPrice,
  status: "closed",
  updatedAt: now,
}).where(eq(rounds.id, latestRound.id));

const roundTrades = await db.select().from(trades).where(eq(trades.roundId, latestRound.roundId));
for (const trade of roundTrades) {
  const won =
    (trade.signal === "UP" && exitPrice > latestRound.entryPrice) ||
    (trade.signal === "DOWN" && exitPrice < latestRound.entryPrice);

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, trade.agentId) });
  if (!agent) continue;

  const pnl = calculatePnl(trade.entryPrice, exitPrice, trade.signal as "UP" | "DOWN" | "HOLD", trade.stake ?? 0);
  await db.update(trades).set({
    exitPrice,
    result: won ? "won" : "loss",
    pnl,
    updatedAt: now,
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
    updatedAt: now,
  }).where(eq(agents.id, agent.id));
}

const rankedAgents = await db.select().from(agents);
const topAgent = pickPromotedAgent(rankedAgents);
for (const agent of rankedAgents) {
  await db.update(agents).set({
    promoted: agent.id === topAgent?.id,
    updatedAt: now,
  }).where(eq(agents.id, agent.id));
}

if (topAgent) {
  console.log(`Promoted ${topAgent.name ?? topAgent.id} with score ${promotionScore(topAgent)}`);
}

console.log(`Resolved round ${latestRound.roundId} at $${exitPrice.toFixed(2)}.`);
