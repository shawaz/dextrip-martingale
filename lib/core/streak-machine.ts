/**
 * Ladder builder — pure math, no DB dependencies.
 * Moved from lib/trading/streak-machine.ts.
 */

export function buildLadder(
  targetProfit: number,
  multiplier: number,
  steps: number,
): number[] {
  const ladder: number[] = [];
  let current = targetProfit;
  for (let i = 0; i < steps; i++) {
    ladder.push(Math.max(1, Math.round(current)));
    current *= multiplier;
  }
  return ladder;
}
