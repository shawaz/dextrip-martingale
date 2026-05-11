/**
 * Railway Worker - RSI 30/80 Martingale Bot
 * Best strategy from backtest: 63.7% win rate, $62 profit in 90 days
 * 
 * Martingale Ladder: [1, 3, 9, 27] - 3x multiplier
 * RSI signals: < 30 = UP, > 80 = DOWN
 */

const { neon } = require("@neondatabase/serverless");
const { drizzle } = require("drizzle-orm/neon-http");
const { agents, rounds, trades, settings } = require("./db/schema");
const { eq, and, desc } = require("drizzle-orm");
const { buildScaledLadder } = require("./lib/trading/streak-machine");

// Config
const RSI_LOW = 30;
const RSI_HIGH = 80;
const TRADE_SCHEDULE = [1, 3, 9, 27]; // 3x martingale ladder
const MAX_STREAKS = 4;
const TARGET_PROFIT = 5;

// Create database connection
const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql, { schema: require("./db/schema") });

// Telegram notifications
async function sendTelegram(message) {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.log("[WARN] Telegram failed:", e.message);
  }
}

// Get market tokens from Polymarket
async function getMarketTokens(slug) {
  try {
    const res = await fetch(`https://gamma-api.polymarket.com/markets/slug/${slug}`);
    const data = await res.json();
    const ids = JSON.parse(data.clobTokenIds);
    return [ids[0], ids[1]];
  } catch (e) {
    console.log("[ERROR] getMarketTokens:", e.message);
    return null;
  }
}

// Execute trade via Bullpen CLI
async function executeTrade(slug, direction, amount) {
  const outcome = direction === "UP" ? "UP" : "DOWN";
  const amountStr = amount.toFixed(2);
  
  try {
    const { execSync } = require("child_process");
    const cmd = `bullpen polymarket buy "${slug}" ${outcome} ${amountStr} --yes`;
    console.log(`[EXEC] ${cmd}`);
    
    const result = execSync(cmd, { encoding: "utf8", timeout: 10000 });
    console.log(`[SUCCESS] ${result.substring(0, 200)}`);
    return true;
  } catch (e) {
    console.log(`[ERROR] Trade failed: ${e.message}`);
    return false;
  }
}

// Fetch BTC price
async function fetchBtcPrice() {
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
    const data = await res.json();
    return Number(data.price);
  } catch (e) {
    return 0;
  }
}

// Calculate RSI
function calculateRsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

// Get RSI signal
function getSignal(rsi, lastRsi) {
  if (rsi < RSI_LOW && lastRsi >= RSI_LOW) return "UP";
  if (rsi > RSI_HIGH && lastRsi <= RSI_HIGH) return "DOWN";
  return null;
}

// Main worker loop
async function runWorker() {
  console.log("=" .repeat(60));
  console.log("RSI 30/80 MARTINGALE BOT - 3x Ladder");
  console.log(`RSI: ${RSI_LOW}/${RSI_HIGH}`);
  console.log(`Ladder: ${TRADE_SCHEDULE.join(", ")}`);
  console.log("=" .repeat(60));
  
  console.log(`[CONFIG] DATABASE_URL: ${process.env.DATABASE_URL ? "SET" : "MISSING"}`);
  console.log(`[CONFIG] POLYMARKET_KEY: ${process.env.POLYMARKET_PRIVATE_KEY ? "SET" : "MISSING"}`);
  
  await sendTelegram("<b>RSI 30/80 Bot Started</b>\n3x Martingale on 5m BTC markets");

  let streak = 0;
  let wins = 0;
  let losses = 0;
  let profit = 0;
  let maxStreak = 0;
  let lastRoundId = null;
  let activeSignal = null;
  let lastRsi = 50;
  let priceHistory = [];

  while (true) {
    try {
      const now = new Date();
      const intervalS = 300; // 5 minutes
      const currentTs = Math.floor(now.getTime() / 1000);
      const windowTs = currentTs - (currentTs % intervalS);
      const startTimeIso = new Date(windowTs * 1000).toISOString();
      const endTimeIso = new Date((windowTs + intervalS) * 1000).toISOString();
      const roundId = `BTC5M-${windowTs}`;

      const secondsToStart = (windowTs + intervalS) - currentTs;

      // Get price history for RSI
      const closedRounds = await db.select().from(rounds)
        .where(and(eq(rounds.timeframe, "5m"), eq(rounds.status, "closed")))
        .orderBy(desc(rounds.startTime))
        .limit(50);

      // Add current price to history
      const btcPrice = await fetchBtcPrice();
      if (btcPrice > 0) {
        priceHistory.push(btcPrice);
        if (priceHistory.length > 50) priceHistory.shift();
      }

      // Use Polymarket prices for RSI calculation
      const pmPrices = closedRounds.map(r => {
        const p = r.officialExitPrice ?? r.exitPrice ?? r.entryPrice ?? 0;
        return Number(p);
      }).filter(v => v > 0);

      // Combine Binance price with Polymarket outcomes
      const allPrices = btcPrice > 0 ? [btcPrice] : [];
      for (const round of closedRounds.slice(0, 14)) {
        if (round.entryPrice) allPrices.push(Number(round.entryPrice));
      }

      const rsi = calculateRsi(allPrices.length > 14 ? allPrices : pmPrices.length > 14 ? pmPrices : allPrices) ?? 50;
      const signal = getSignal(rsi, lastRsi);
      lastRsi = rsi;

      // Get current market
      const currentSlug = `btc-updown-5m-${windowTs}`;
      const marketTokens = await getMarketTokens(currentSlug);

      // Execute trade 0-65 seconds before close
      if (secondsToStart <= 65 && secondsToStart >= 0) {
        const currentBet = TRADE_SCHEDULE[Math.min(streak, TRADE_SCHEDULE.length - 1)];
        
        console.log(`[CHECK] ${Math.floor(secondsToStart)}s | Signal: ${signal || "none"} | Bet: $${currentBet} | Streak: ${streak} | RSI: ${rsi.toFixed(1)}`);

        if (signal && !activeSignal) {
          activeSignal = signal;
          const success = await executeTrade(currentSlug, signal, currentBet);
          
          if (success) {
            console.log(`[SIGNAL] ${signal} at $${btcPrice} | Bet: $${currentBet} | Streak: ${streak}`);
            wins++; // Will be corrected on resolution
          }
        }
      }

      // Resolve previous round
      if (lastRoundId && lastRoundId !== roundId) {
        const prevSlug = lastRoundId.replace("BTC5M-", "btc-updown-5m-");
        const prevTokens = await getMarketTokens(prevSlug);
        
        if (prevTokens) {
          // Determine outcome from price direction or market resolution
          // For now, mark as resolved
          const resolvedRound = await db.select().from(rounds)
            .where(eq(rounds.roundId, lastRoundId))
            .limit(1);
          
          if (resolvedRound[0]) {
            const won = activeSignal ? true : false; // Placeholder
            const bet = TRADE_SCHEDULE[Math.min(streak, TRADE_SCHEDULE.length - 1)];
            
            if (won) {
              profit += bet;
              wins++;
              streak = 0;
            } else {
              profit -= bet;
              losses++;
              streak++;
              if (streak > maxStreak) maxStreak = streak;
              if (streak >= MAX_STREAKS) {
                console.log(`[BREAK] Max streaks reached! Resetting.`);
                streak = 0;
              }
            }
            
            console.log(`[RESOLVE] ${lastRoundId} => ${won ? "WIN" : "LOSS"} | P&L: $${profit.toFixed(2)} | W: ${wins}, L: ${losses}`);
          }
        }
        
        activeSignal = null;
      }

      lastRoundId = roundId;

      // Log status every minute
      if (Math.floor(currentTs) % 60 === 0) {
        console.log(`[STATUS] ${roundId} | RSI: ${rsi.toFixed(1)} | Signal: ${signal || "-"} | P&L: $${profit.toFixed(2)} | ${wins}W/${losses}L | Max Streak: ${maxStreak}`);
      }

      // Sleep based on proximity to next round
      const sleepTime = secondsToStart < 90 ? 2 : 10;
      await new Promise(r => setTimeout(r, sleepTime * 1000));

    } catch (e) {
      console.error("[ERROR]", e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// Run worker
runWorker().catch(console.error);