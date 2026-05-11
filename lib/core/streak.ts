/**
 * Streak signal computation and agent definitions.
 */

import { type Direction, STREAK_AGENTS } from "./types";
import { rsiSignal } from "./rsi";

export { STREAK_AGENTS };

/**
 * Detect streak signal from recent resolved directions.
 * If the last N rounds all went the same direction, bet the OPPOSITE (mean reversion).
 */
export function getStreakSignal(
  recentDirections: string[],
  requiredLength: number,
): Direction | null {
  if (recentDirections.length < requiredLength) return null;
  const slice = recentDirections.slice(0, requiredLength);
  if (slice.every((d) => d === "UP")) return "DOWN";
  if (slice.every((d) => d === "DOWN")) return "UP";
  return null;
}

/**
 * Compute signal for a specific agent given market conditions.
 * Returns the direction to bet, or null if no signal.
 */
export function computeAgentSignal(
  agent: (typeof STREAK_AGENTS)[number],
  recentDirections: string[],
  rsi: number | null,
): Direction | null {
  if (agent.trigger === "always") {
    return agent.signal;
  }
  if (agent.trigger === "streak") {
    return getStreakSignal(recentDirections, agent.streak);
  }
  if (agent.trigger === "rsi") {
    return rsiSignal(rsi);
  }
  return null;
}
