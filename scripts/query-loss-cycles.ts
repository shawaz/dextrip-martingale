import { db, trades } from '@/db/index';
import { eq, and, desc } from 'drizzle-orm';

async function main() {
  const allTrades = await db().select().from(trades)
    .where(and(eq(trades.strategyId, 'streak-5m'), eq(trades.tradeMode, 'paper')))
    .orderBy(desc(trades.createdAt));

  const byAgent: Record<string, typeof allTrades> = {};
  for (const t of allTrades) {
    if (!byAgent[t.agentId]) byAgent[t.agentId] = [];
    byAgent[t.agentId].push(t);
  }

  let grandLossCycles = 0;
  let grandWinCycles = 0;

  for (const [agentId, agentTrades] of Object.entries(byAgent)) {
    const settled = agentTrades.filter(t => t.result !== 'pending').reverse();
    console.log(`\n=== ${agentId} (${settled.length} settled trades) ===`);
    
    let cycleTrades: typeof settled = [];
    let winCycles = 0;
    let lossCycles = 0;
    let cycleLosses = 0;
    let maxCycleLosses = 0;
    let totalCycleLossStake = 0;
    let ladderLosses: number[] = [];

    for (const trade of settled) {
      cycleTrades.push(trade);
      if (trade.result === 'won') {
        winCycles++;
        if (cycleLosses > maxCycleLosses) maxCycleLosses = cycleLosses;
        cycleLosses = 0;
        cycleTrades = [];
      } else if (trade.result === 'loss') {
        cycleLosses++;
        totalCycleLossStake += Number(trade.stake);
        // Check if this loss ended the cycle (reached max ladder steps)
        if (cycleLosses >= 8) {
          lossCycles++;
          ladderLosses.push(cycleLosses);
          if (cycleLosses > maxCycleLosses) maxCycleLosses = cycleLosses;
          cycleLosses = 0;
          cycleTrades = [];
        }
      }
    }
    
    console.log(`  Win cycles: ${winCycles}`);
    console.log(`  Loss cycles (8-loss streak / ladder max): ${lossCycles}`);
    console.log(`  Ongoing cycle losses (incomplete): ${cycleLosses}`);
    console.log(`  Max consecutive losses in a cycle: ${maxCycleLosses}`);
    if (ladderLosses.length > 0) console.log(`  Loss cycle lengths: ${ladderLosses.join(', ')}`);

    grandLossCycles += lossCycles;
    grandWinCycles += winCycles;
  }

  console.log(`\n========== TOTALS ==========`);
  console.log(`  Total win cycles: ${grandWinCycles}`);
  console.log(`  Total loss cycles: ${grandLossCycles}`);
}

main().catch(console.error);
