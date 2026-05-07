import { db, trades } from "@/db/index";
import { eq, and } from "drizzle-orm";

const STREAK_AGENTS = [
  "EVERY_5M",
  "PREVIOUS_UP_5M",
  "PREVIOUS_DOWN_5M",
  "PREVIOUS_THREE_UP_5M",
  "PREVIOUS_THREE_DOWN_5M",
  "PREVIOUS_FIVE_UP_5M",
  "PREVIOUS_FIVE_DOWN_5M",
  "RSI_UP_5M",
  "RSI_DOWN_5M",
];

async function logStats() {
  const now = new Date().toISOString();
  console.log(`\n[${now}] === Paper Trading Strategy Report ===`);
  
  for (const agentId of STREAK_AGENTS) {
    const agentTrades = await db().select().from(trades)
      .where(and(eq(trades.agentId, agentId), eq(trades.strategyId, "streak-5m"), eq(trades.tradeMode, "paper")));
    
    const total = agentTrades.length;
    const wins = agentTrades.filter((t) => t.result === "won").length;
    const losses = agentTrades.filter((t) => t.result === "loss").length;
    const pending = agentTrades.filter((t) => t.result === "pending").length;
    const pnl = agentTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0.0";
    
    console.log(
      `  ${agentId.padEnd(22)} | Trades:${String(total).padStart(3)} | ${String(wins).padStart(2)}W/${String(losses).padStart(2)}L/${String(pending).padStart(2)}P | WinRate:${winRate.padStart(5)}% | P&L:$${pnl.toFixed(2).padStart(7)}`
    );
  }
  
  // Overall
  const allTrades = await db().select().from(trades)
    .where(and(eq(trades.strategyId, "streak-5m"), eq(trades.tradeMode, "paper")));
  const totalPnl = allTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
  const totalWins = allTrades.filter((t) => t.result === "won").length;
  const totalLosses = allTrades.filter((t) => t.result === "loss").length;
  console.log(`  ${"TOTAL".padEnd(22)} | Trades:${String(allTrades.length).padStart(3)} | ${String(totalWins).padStart(2)}W/${String(totalLosses).padStart(2)}L | P&L:$${totalPnl.toFixed(2)}`);
}

async function main() {
  console.log("Strategy Monitor Started - logging every 15 minutes");
  await logStats();
  
  setInterval(async () => {
    try {
      await logStats();
    } catch (e) {
      console.error("Monitor error:", e);
    }
  }, 15 * 60 * 1000);
}

main().catch(console.error);
