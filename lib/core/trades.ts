/**
 * Trade lifecycle — create, resolve, batch query.
 * Includes the $0.50 Polymarket price check and live execution hook.
 */

import { eq, and, desc } from "drizzle-orm";
import { db, trades } from "@/db/index";
import { type AgentTradeState, type Direction } from "./types";
import { checkPriceBelowThreshold } from "./polymarket";
import { windowTsToSlug } from "./polymarket";

/** Create a pending trade (paper or live). Enforces the $0.50 price check. */
export async function createTrade(params: {
  agentId: string;
  roundId: string;
  windowTs: number;
  signal: Direction;
  stake: number;
  agentTarget: number;
  entryPrice: number;
  tradeMode: "paper" | "live";
  ladderStep: number;
  ladderLength: number;
}): Promise<{
  created: boolean;
  tradeId?: string;
  skipped?: boolean;
  reason?: string;
  polymarketPrice?: number;
}> {
  // Check for existing pending trade for this agent
  const existing = await db()
    .select()
    .from(trades)
    .where(
      and(
        eq(trades.agentId, params.agentId),
        eq(trades.roundId, params.roundId),
        eq(trades.result, "pending"),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return { created: false, reason: "Already has pending trade" };
  }

  // POLYMARKET PRICE CHECK — $0.50 threshold
  const slug = windowTsToSlug(params.windowTs);
  const priceCheck = await checkPriceBelowThreshold(slug, params.signal);

  if (priceCheck.skipped) {
    console.log(
      `[TRADE SKIP] ${params.agentId} | ${params.signal} | ${priceCheck.reason}`,
    );
    return {
      created: false,
      skipped: true,
      reason: priceCheck.reason,
      polymarketPrice: priceCheck.price,
    };
  }

  const tradeId = crypto.randomUUID();
  await db()
    .insert(trades)
    .values({
      id: tradeId,
      agentId: params.agentId,
      roundId: params.roundId,
      strategyId: "streak-5m",
      signal: params.signal,
      stake: params.stake,
      targetProfitSnapshot: params.agentTarget,
      result: "pending",
      tradeMode: params.tradeMode,
      entryPrice: params.entryPrice,
      // priceAtSignal added via DB migration
      priceAtSignal: String(priceCheck.price),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

  console.log(
    `[TRADE] ${params.agentId} | signal:${params.signal} | stake:$${params.stake} | step:${params.ladderStep}/${params.ladderLength} | polyPrice:$${priceCheck.price.toFixed(4)}`,
  );

  return {
    created: true,
    tradeId,
    polymarketPrice: priceCheck.price,
    reason: priceCheck.reason,
  };
}

/** Resolve a pending trade against the actual outcome. */
export async function resolveTrade(params: {
  tradeId: string;
  direction: string | null;
  exitPrice: number;
}): Promise<{ won: boolean; pnl: number }> {
  const trade = await db().query.trades.findFirst({
    where: eq(trades.id, params.tradeId),
  });
  if (!trade || trade.result !== "pending") {
    return { won: false, pnl: 0 };
  }

  const won =
    params.direction != null && trade.signal === params.direction;
  const stake = Number(trade.stake);

  // Calculate cycle-level PnL: find prior losses in this cycle, subtract from win
  let pnl: number;
  if (won) {
    const recentAgentTrades = await db()
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.agentId, trade.agentId),
          eq(trades.strategyId, "streak-5m"),
        ),
      )
      .orderBy(desc(trades.createdAt))
      .limit(20);

    let cycleLossSum = 0;
    for (const t of recentAgentTrades) {
      if (t.id === trade.id) break;
      if (t.result === "won") break;
      if (t.result === "loss") cycleLossSum += Number(t.stake);
    }
    pnl = stake - cycleLossSum;
  } else {
    pnl = -stake;
  }

  await db()
    .update(trades)
    .set({
      result: won ? "won" : "loss",
      pnl,
      exitPrice: params.exitPrice,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(trades.id, trade.id));

  return { won, pnl };
}

/** Batch-load all recent trades for a strategy, grouped by agent. */
export async function getRecentTradesByAgent(
  strategyId = "streak-5m",
  mode: "paper" | "live" = "paper",
  limit = 200,
) {
  const all = await db()
    .select()
    .from(trades)
    .where(
      and(eq(trades.strategyId, strategyId), eq(trades.tradeMode, mode)),
    )
    .orderBy(desc(trades.createdAt))
    .limit(limit);

  const byAgent = new Map<string, typeof all>();
  for (const t of all) {
    const existing = byAgent.get(t.agentId) ?? [];
    existing.push(t);
    byAgent.set(t.agentId, existing);
  }
  return byAgent;
}

/** Compute agent state from settled trades using martingale replay. */
export function computeAgentState(
  agentTrades: Array<{
    stake: number;
    result: string;
    targetProfitSnapshot?: number;
  }>,
  ladder: number[],
): AgentTradeState {
  let currentStep = 0;
  let invested = 0;
  let profit = 0;
  let loss = 0;
  let roundsCompleted = 0;
  const settled = agentTrades
    .filter((t) => t.result !== "pending")
    .reverse();

  for (const trade of settled) {
    roundsCompleted++;
    const stake = Number(trade.stake);
    const stepIndex = ladder.indexOf(stake);
    const step = stepIndex >= 0 ? stepIndex + 1 : currentStep + 1;
    currentStep = step;
    invested = ladder.slice(0, step).reduce((s, v) => s + v, 0);

    if (trade.result === "won") {
      profit += trade.targetProfitSnapshot ?? ladder[0];
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

  return {
    currentStep,
    invested,
    profit,
    loss,
    roundsCompleted,
    pending: !!pending,
    balance: profit - loss,
  };
}
