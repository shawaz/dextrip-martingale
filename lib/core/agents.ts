/**
 * Agent management — seed, config, batch state.
 */

import { eq } from "drizzle-orm";
import { db, agents } from "@/db/index";
import { STREAK_AGENTS } from "./types";
import { buildLadder } from "./streak-machine";
import {
  getSettingsMap,
  perAgentVal,
  getTargetProfit,
  getMultiplier,
  getLadderSteps,
} from "./settings";
import {
  getRecentTradesByAgent,
  computeAgentState,
} from "./trades";
import type { Direction, AgentTradeState } from "./types";

/** Ensure all default agents exist in the database. */
export async function seedAgents() {
  const now = new Date().toISOString();
  for (const a of STREAK_AGENTS) {
    const existing = await db().query.agents.findFirst({
      where: eq(agents.id, a.id),
    });
    if (!existing) {
      const direction =
        "signal" in a ? a.signal : "DOWN";
      await db()
        .insert(agents)
        .values({
          id: a.id,
          name: a.name,
          initials: a.name
            .split(" ")
            .map((n) => n[0])
            .join(""),
          color:
            direction === "UP"
              ? "#10b981"
              : direction === "DOWN"
                ? "#ef4444"
                : "#3b82f6",
          timeframe: "5m",
          bankroll: 1000,
          startingBankroll: 1000,
          isActive: 1,
          isLive: 0,
          promoted: 0,
          won: 0,
          loss: 0,
          winRate: 0,
          totalPnl: 0,
          dailyPnl: 0,
          maxDrawdown: 0,
          createdAt: now,
          updatedAt: now,
        });
    }
  }
}

/** Toggle live mode for an agent. */
export async function toggleLiveAgent(
  agentId: string,
  enabled: boolean,
) {
  const now = new Date().toISOString();
  const existing = await db().query.agents.findFirst({
    where: eq(agents.id, agentId),
  });
  if (existing) {
    await db()
      .update(agents)
      .set({ isLive: enabled ? 1 : 0, updatedAt: now })
      .where(eq(agents.id, agentId));
  }
}

/** Build ladder with defaults or per-agent overrides. */
export function ladderForAgent(
  agentId: string,
  settingsMap: Map<string, number>,
  globalTarget: number,
  globalMultiplier: number,
  globalSteps: number,
): { ladder: number[]; target: number } {
  const target = perAgentVal(settingsMap, agentId, "target", globalTarget);
  const multiplier = perAgentVal(
    settingsMap,
    agentId,
    "multiplier",
    globalMultiplier,
  );
  const steps = perAgentVal(settingsMap, agentId, "steps", globalSteps);
  return {
    ladder: buildLadder(target, multiplier, steps),
    target,
  };
}

/** Compute state and ladder for all agents in a single pass. */
export async function computeAllAgentStates(
  mode: "paper" | "live" = "paper",
): Promise<
  Array<{
    id: string;
    name: string;
    state: AgentTradeState;
    ladder: number[];
    target: number;
    isLive: boolean;
  }>
> {
  const settingsMap = await getSettingsMap();
  const globalTarget = settingsMap.get("martingale_target_profit") ?? 5;
  const globalMultiplier = settingsMap.get("martingale_multiplier") ?? 3;
  const globalSteps = settingsMap.get("martingale_ladder_steps") ?? 8;

  const agentRows = await db()
    .select()
    .from(agents)
    .where(eq(agents.timeframe, "5m"));

  const tradesByAgent = await getRecentTradesByAgent(
    "streak-5m",
    mode,
    200,
  );

  const results: Array<{
    id: string;
    name: string;
    state: AgentTradeState;
    ladder: number[];
    target: number;
    isLive: boolean;
  }> = [];

  for (const streak of STREAK_AGENTS) {
    const agentRow = agentRows.find((a) => a.id === streak.id);
    const { ladder, target } = ladderForAgent(
      streak.id,
      settingsMap,
      globalTarget,
      globalMultiplier,
      globalSteps,
    );

    const agentTrades = tradesByAgent.get(streak.id) ?? [];
    const state = computeAgentState(
      agentTrades.map((t) => ({
        stake: Number(t.stake),
        result: t.result,
        targetProfitSnapshot: Number(t.targetProfitSnapshot ?? target),
      })),
      ladder,
    );

    results.push({
      id: streak.id,
      name: streak.name,
      state,
      ladder,
      target,
      isLive: agentRow?.isLive === 1,
    });
  }

  return results;
}
