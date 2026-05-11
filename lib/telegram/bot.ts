const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

export function isTelegramEnabled(): boolean {
  return Boolean(TELEGRAM_TOKEN && TELEGRAM_CHAT_ID);
}

export async function sendTelegramMessage(text: string): Promise<void> {
  if (!isTelegramEnabled()) return;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
      }),
    });
  } catch (e) {
    console.error("[Telegram] Failed to send:", e);
  }
}

export async function sendTradeAlert(
  type: "created" | "resolved",
  agentId: string,
  roundId: string,
  signal: string,
  stake: number,
  step: number,
  totalSteps: number,
  result?: string,
  pnl?: number,
  pmPrice?: number | null
): Promise<void> {
  if (!isTelegramEnabled()) return;

  const icon = signal === "UP" ? "📈" : "📉";
  const statusIcon = type === "created" ? "🟡" : result === "won" ? "🟢" : "🔴";

  let text = "";
  if (type === "created") {
    text = `${statusIcon} <b>Trade Created</b>\n\n`;
    text += `<b>Agent:</b> ${agentId}\n`;
    text += `<b>Round:</b> ${roundId}\n`;
    text += `<b>Signal:</b> ${icon} ${signal}\n`;
    text += `<b>Stake:</b> $${stake}\n`;
    text += `<b>Step:</b> ${step}/${totalSteps}\n`;
    if (pmPrice != null) text += `<b>PM Price:</b> $${pmPrice.toFixed(2)}`;
  } else {
    text = `${statusIcon} <b>Trade Resolved</b>\n\n`;
    text += `<b>Agent:</b> ${agentId}\n`;
    text += `<b>Round:</b> ${roundId}\n`;
    text += `<b>Signal:</b> ${icon} ${signal}\n`;
    text += `<b>Result:</b> ${result?.toUpperCase()}\n`;
    text += `<b>P&L:</b> $${pnl?.toFixed(2)}`;
    if (pmPrice != null) text += `\n<b>PM Price:</b> $${pmPrice.toFixed(2)}`;
  }

  await sendTelegramMessage(text);
}

export async function sendSummary(stats: {
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  totalPnl: number;
  agents: Array<{
    id: string;
    name: string;
    profit: number;
    loss: number;
    balance: number;
    currentStep: number;
  }>;
}): Promise<void> {
  if (!isTelegramEnabled()) return;

  let text = `📊 <b>Dextrip Paper Trading Summary</b>\n\n`;
  text += `<b>Total Trades:</b> ${stats.totalTrades}\n`;
  text += `<b>Wins:</b> ${stats.totalWins} | <b>Losses:</b> ${stats.totalLosses}\n`;
  text += `<b>Net P&L:</b> $${stats.totalPnl.toFixed(2)}\n\n`;
  text += `<b>Agents:</b>\n`;

  for (const agent of stats.agents) {
    const icon = agent.balance >= 0 ? "🟢" : "🔴";
    text += `${icon} <b>${agent.name}</b>: $${agent.balance.toFixed(2)} (step ${agent.currentStep})\n`;
  }

  await sendTelegramMessage(text);
}
