import { db, trades } from "@/db/index";
import { eq, and } from "drizzle-orm";
import { sendTelegramMessage, isTelegramEnabled } from "@/lib/telegram/bot";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "";

let lastUpdateId = 0;

async function getStats() {
  const allTrades = await db().select().from(trades).where(and(eq(trades.strategyId, "streak-5m"), eq(trades.tradeMode, "paper")));
  const totalWins = allTrades.filter((t) => t.result === "won").length;
  const totalLosses = allTrades.filter((t) => t.result === "loss").length;
  const totalPnl = allTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
  const pending = allTrades.filter((t) => t.result === "pending").length;

  return { totalTrades: allTrades.length, totalWins, totalLosses, totalPnl, pending };
}

async function getAgentStats() {
  const allTrades = await db().select().from(trades).where(and(eq(trades.strategyId, "streak-5m"), eq(trades.tradeMode, "paper")));
  const agents = ["EVERY_UP_5M", "EVERY_DOWN_5M", "PREVIOUS_5M", "PREVIOUS_3_5M", "PREVIOUS_5_5M", "RSI_5M"];
  const names: Record<string, string> = {
    EVERY_UP_5M: "Every UP",
    EVERY_DOWN_5M: "Every DOWN",
    PREVIOUS_5M: "Previous",
    PREVIOUS_3_5M: "Previous 3",
    PREVIOUS_5_5M: "Previous 5",
    RSI_5M: "RSI",
  };

  let text = `📊 <b>Agent Performance</b>\n\n`;
  for (const agentId of agents) {
    const agentTrades = allTrades.filter((t) => t.agentId === agentId);
    const wins = agentTrades.filter((t) => t.result === "won").length;
    const losses = agentTrades.filter((t) => t.result === "loss").length;
    const pnl = agentTrades.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
    const pending = agentTrades.filter((t) => t.result === "pending").length;
    const icon = pnl >= 0 ? "🟢" : "🔴";
    text += `${icon} <b>${names[agentId]}</b>: ${wins}W/${losses}L | P&L: $${pnl.toFixed(2)}${pending > 0 ? ` | ⏳ ${pending} pending` : ""}\n`;
  }
  return text;
}

async function processCommands() {
  if (!TELEGRAM_TOKEN) return;

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&limit=10`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.ok || !data.result) return;

    for (const update of data.result) {
      lastUpdateId = update.update_id;
      const msg = update.message?.text;
      const chatId = update.message?.chat?.id;

      if (!msg || !chatId) continue;

      if (msg === "/status" || msg === "/stats") {
        const stats = await getStats();
        const text = `📊 <b>Dextrip Status</b>\n\n<b>Total Trades:</b> ${stats.totalTrades}\n<b>Wins:</b> ${stats.totalWins}\n<b>Losses:</b> ${stats.totalLosses}\n<b>Pending:</b> ${stats.pending}\n<b>Net P&L:</b> $${stats.totalPnl.toFixed(2)}`;
        await sendTelegramMessage(text);
      } else if (msg === "/agents") {
        const text = await getAgentStats();
        await sendTelegramMessage(text);
      } else if (msg === "/help") {
        const text = `🤖 <b>Dextrip Bot Commands</b>\n\n/status - Overall trading stats\n/agents - Per-agent performance\n/help - Show this message`;
        await sendTelegramMessage(text);
      } else if (msg === "/start") {
        const text = `🤖 <b>Dextrip Paper Trading Bot</b>\n\nUse /status for stats, /agents for agent breakdown, /help for commands.`;
        await sendTelegramMessage(text);
      }
    }
  } catch (e) {
    console.error("[Telegram Command] Error:", e);
  }
}

async function main() {
  if (!isTelegramEnabled()) {
    console.log("Telegram not configured. Set TELEGRAM_TOKEN and TELEGRAM_CHAT_ID.");
    return;
  }

  console.log("Telegram Command Bot started. Listening for commands...");
  await sendTelegramMessage("🤖 <b>Dextrip Command Bot</b> started!\n\nCommands:\n/status - Stats\n/agents - Agent breakdown\n/help - Help");

  setInterval(async () => {
    try {
      await processCommands();
    } catch (e) {
      console.error("[FATAL] Command processing failed:", e);
    }
  }, 5000);
}

main().catch(console.error);
