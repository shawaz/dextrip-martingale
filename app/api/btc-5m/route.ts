import { NextResponse } from "next/server"
import { db, agents, rounds, trades, settings, walletBalances } from "@/db/index"
import { eq, and, desc, lt, sql } from "drizzle-orm"
import { buildLadder, replayStreakMachine } from "@/lib/trading/streak-machine"
import { buildMarketState, type MarketState } from "@/lib/trading/local-selection"
import { fetchPolymarketSharePrice } from "@/lib/trading/polymarket"

async function getSetting(key: string, fallback: number): Promise<number> {
  try {
    const setting = await db().query.settings.findFirst({ where: eq(settings.key, key) })
    return setting ? Number(setting.value) : fallback
  } catch (error) {
    console.error(`getSetting(${key}) error:`, error);
    return fallback
  }
}

async function getTargetProfit() {
  return getSetting("martingale_target_profit", 5)
}

async function getMultiplier() {
  return getSetting("martingale_multiplier", 3)
}

async function getLadderSteps() {
  return getSetting("martingale_ladder_steps", 8)
}

async function getTrendStrengthThreshold() {
  return getSetting("trend_strength_threshold", 8)
}

function calculateRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null
  let gains = 0
  let losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]
    if (change > 0) gains += change
    else losses -= change
  }
  if (losses === 0) return 100
  const rs = gains / losses
  return 100 - 100 / (1 + rs)
}

const streakAgents = [
  { id: "EVERY_UP_5M", name: "Every UP", direction: "UP", trigger: "always" },
  { id: "EVERY_DOWN_5M", name: "Every DOWN", direction: "DOWN", trigger: "always" },
  { id: "PREVIOUS_5M", name: "Previous", direction: "OPPOSITE", streak: 2 },
  { id: "PREVIOUS_3_5M", name: "Previous 3", direction: "OPPOSITE", streak: 3 },
  { id: "PREVIOUS_5_5M", name: "Previous 5", direction: "OPPOSITE", streak: 5 },
  { id: "RSI_5M", name: "RSI", direction: "RSI", trigger: "rsi" },
]

async function seedAgents() {
  const now = new Date().toISOString()
  for (const a of streakAgents) {
    const existing = await db().query.agents.findFirst({ where: eq(agents.id, a.id) })
    if (!existing) {
      await db().insert(agents).values({
        id: a.id,
        name: a.name,
        initials: a.name.split(" ").map((n) => n[0]).join(""),
        color: a.direction === "BOTH" || a.direction === "OPPOSITE" ? "#3b82f6" : a.direction === "UP" ? "#10b981" : "#ef4444",
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
      })
    }
  }
}

async function toggleLiveAgent(agentId: string, enabled: boolean) {
  const now = new Date().toISOString()
  const existing = await db().query.agents.findFirst({ where: eq(agents.id, agentId) })
  if (existing) {
    await db().update(agents).set({ isLive: enabled ? 1 : 0, updatedAt: now }).where(eq(agents.id, agentId))
  } else {
    await db().insert(agents).values({
      id: agentId,
      name: agentId.replace("_5M", "").replace(/_/g, " ").split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
      initials: agentId.replace("_5M", "").split("_").map((n: string) => n[0]).join(""),
      color: agentId.includes("DOWN") ? "#ef4444" : "#10b981",
      timeframe: "5m",
      bankroll: 1000,
      startingBankroll: 1000,
      isLive: enabled ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    })
  }
}

async function getWalletBalance() {
  const key = process.env.POLYMARKET_PRIVATE_KEY
  const funder = process.env.POLYMARKET_FUNDER
  if (!key || !funder) return { connected: false, balance: null, wallet: null }
  try {
    // Add cache-busting timestamp
    const timestamp = Date.now()
    const res = await fetch(`https://clob.polymarket.com/balance-allowance?asset_type=0&_=${timestamp}`, {
      headers: { 
        "POLYMARKET-API-KEY": key,
        "Cache-Control": "no-cache"
      }
    })
    if (!res.ok) return { connected: true, balance: null, wallet: funder }
    const data = await res.json()
    return { 
      connected: true, 
      balance: data.balance ? data.balance / 1_000_000 : 0,
      wallet: funder,
      lastUpdated: new Date().toISOString()
    }
  } catch {
    return { connected: true, balance: null, wallet: funder }
  }
}

export async function GET(req: Request) {
  // Fire-and-forget keep-alive ping to Railway bot
  fetch("https://loving-rejoicing-production-592c.up.railway.app", { method: "HEAD", signal: AbortSignal.timeout(5000) }).catch(() => {})

  try {
    const { searchParams } = new URL(req.url)
    const applyNext = searchParams.get("applyNextWindow") === "true"
    const newTarget = searchParams.get("target")
    const newMultiplier = searchParams.get("multiplier")
    const newSteps = searchParams.get("steps")
    const toggleAgent = searchParams.get("toggleLive")
    const toggleEnabled = searchParams.get("liveEnabled") === "true"
    const saveAgentId = searchParams.get("saveAgent")
    const saveAgentTarget = searchParams.get("saveTarget")
    const saveAgentMultiplier = searchParams.get("saveMultiplier")
    const saveAgentSteps = searchParams.get("saveSteps")


    // Save settings (applies immediately for new trades)
    if (applyNext) {
      const now = new Date().toISOString()
      const saveSetting = async (key: string, value: string) => {
        await db().insert(settings).values({ key, value, updatedAt: now }).onConflictDoUpdate({
          target: settings.key,
          set: { value, updatedAt: now },
        })
      }
      if (newTarget) { const val = Number(newTarget); if (!Number.isNaN(val) && val > 0) await saveSetting("martingale_target_profit", String(val)) }
      if (newMultiplier) { const val = Number(newMultiplier); if (!Number.isNaN(val) && val > 1) await saveSetting("martingale_multiplier", String(val)) }
      if (newSteps) { const val = Number(newSteps); if (!Number.isNaN(val) && val >= 2 && val <= 20) await saveSetting("martingale_ladder_steps", String(val)) }
      const newTrendThreshold = searchParams.get("trendThreshold")
      if (newTrendThreshold) { const val = Number(newTrendThreshold); if (!Number.isNaN(val) && val >= 0 && val <= 20) await saveSetting("trend_strength_threshold", String(val)) }
    }

    // Save per-agent settings
    if (saveAgentId) {
      const now = new Date().toISOString()
      const saveSetting = async (key: string, value: string) => {
        await db().insert(settings).values({ key, value, updatedAt: now }).onConflictDoUpdate({
          target: settings.key,
          set: { value, updatedAt: now },
        })
      }
      if (saveAgentTarget) { const val = Number(saveAgentTarget); if (!Number.isNaN(val) && val > 0) await saveSetting(`target_${saveAgentId}`, String(val)) }
      if (saveAgentMultiplier) { const val = Number(saveAgentMultiplier); if (!Number.isNaN(val) && val > 1) await saveSetting(`multiplier_${saveAgentId}`, String(val)) }
      if (saveAgentSteps) { const val = Number(saveAgentSteps); if (!Number.isNaN(val) && val >= 2 && val <= 20) await saveSetting(`steps_${saveAgentId}`, String(val)) }
    }

    if (toggleAgent) {
      await toggleLiveAgent(toggleAgent, toggleEnabled)
    }

    // Remove the old settings update logic that was outside the shouldReset block
    // (This part is handled by the replace tool's context)

    const targetProfit = await getTargetProfit()
    const multiplier = await getMultiplier()
    const ladderSteps = await getLadderSteps()
    const wallet = await getWalletBalance()
    let dbBalance = 0
    try {
      const wb = await db().select().from(walletBalances).where(eq(walletBalances.id, 1)).limit(1)
      if (wb[0]) dbBalance = Number(wb[0].usdcBalance ?? 0)
    } catch {}
    const ladder = buildLadder(targetProfit, multiplier, ladderSteps)
    const trendThreshold = await getTrendStrengthThreshold()
    // Always return the current (committed) settings for display, separate from active snapshot
    const displayTargetProfit = await getTargetProfit()
    const displayMultiplier = await getMultiplier()
    const displayLadderSteps = await getLadderSteps()
    const displayTrendThreshold = await getTrendStrengthThreshold()

    await seedAgents()

    const now = new Date()
    const intervalS = 300
    const currentTs = Math.floor(now.getTime() / 1000)
    const windowTs = currentTs - (currentTs % intervalS)
    const startTimeIso = new Date(windowTs * 1000).toISOString()
    const endTimeIso = new Date((windowTs + intervalS) * 1000).toISOString()

    const pmSlug = `btc-updown-5m-${windowTs}`
    const [pmPriceUp, pmPriceDown] = await Promise.all([
      fetchPolymarketSharePrice(pmSlug, "UP").catch(() => null),
      fetchPolymarketSharePrice(pmSlug, "DOWN").catch(() => null),
    ])
    const polymarketPrices = { up: pmPriceUp, down: pmPriceDown }

    // Note: Round creation is handled exclusively by the paper trading bot
    // to ensure accurate entry prices from live market data

    const activeRound = await db().query.rounds.findFirst({ where: eq(rounds.startTime, startTimeIso) })

    const closedRounds = await db().select().from(rounds).where(and(eq(rounds.timeframe, "5m"), eq(rounds.status, "closed"))).orderBy(desc(rounds.startTime)).limit(200)
    const recentCloses = closedRounds
      .map((round) => Number(round.officialExitPrice ?? round.exitPrice ?? 0))
      .filter((value) => value > 0)
      .reverse()
    // Fetch current BTC price for RSI calculation
    let currentPrice = 0
    try {
      const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")
      const data = await res.json()
      currentPrice = Number(data.price)
    } catch (e) {
      console.error("[API] Failed to fetch BTC price:", e)
    }
    const rsi = calculateRsi(currentPrice > 0 ? [...recentCloses, currentPrice] : recentCloses, 14)

    // Ensure currentPrice is a valid number (Binance response could give NaN)
    if (!currentPrice || isNaN(currentPrice)) {
      currentPrice = recentCloses.at(-1) ?? 0;
    }

    let marketState: MarketState | null = null;
    try {
      marketState = await buildMarketState(currentPrice);
    } catch (e) {
      console.warn("[API] Failed to build market state from Binance, computing from 5m closes:", e);
    }

    // Fallback: compute from existing 5m close data if buildMarketState failed
    if (!marketState && recentCloses.length > 2) {
      const prevIndex = Math.min(5, recentCloses.length - 1);
      const prevPrice = recentCloses[recentCloses.length - prevIndex] ?? currentPrice;
      const priceMovePct = prevPrice ? ((currentPrice - prevPrice) / prevPrice) * 100 : 0;
      const trendDirection = priceMovePct > 0.25 ? "up" : priceMovePct < -0.25 ? "down" : "flat";
      const trendStrength = Math.min(20, Math.abs(priceMovePct) * 8);
      const regime = trendDirection === "flat" ? "range" : "trend";
      // Compute emaSlope from recentCloses
      const emaPeriod = 21;
      let emaSlope: 1 | 0 | -1 = 0;
      if (recentCloses.length >= emaPeriod + 2) {
        const emaMultiplier = 2 / (emaPeriod + 1);
        let ema = recentCloses.slice(0, emaPeriod).reduce((s, v) => s + v, 0) / emaPeriod;
        const emaValues = [ema];
        for (let i = emaPeriod; i < recentCloses.length; i++) {
          ema = recentCloses[i] * emaMultiplier + ema * (1 - emaMultiplier);
          emaValues.push(ema);
        }
        const last3 = emaValues.slice(-3);
        if (last3.length >= 3) {
          const pct = ((last3[2] - last3[0]) / (last3[0] || 1)) * 100;
          if (last3[2] > last3[0] && pct > 0.01) emaSlope = 1;
          else if (last3[2] < last3[0] && pct > 0.01) emaSlope = -1;
        }
      }
      marketState = {
        price: currentPrice,
        trendDirection,
        trendStrength: isNaN(trendStrength) ? 0 : Number(trendStrength.toFixed(1)),
        volatilityLevel: Math.abs(priceMovePct) > 1 ? "high" : Math.abs(priceMovePct) > 0.35 ? "medium" : "low",
        regime,
        volumeExpansion: 1,
        rsiZone: rsi != null ? (rsi <= 35 ? "oversold" : rsi >= 65 ? "overbought" : "neutral") : "neutral",
        vwapDistancePct: 0,
        breakout: false,
        liquiditySweep: false,
        emaSlope,
        highVolume: false,
      };
    }

    const recentDirections = closedRounds
      .map((round) => round.resolvedDirection)
      .filter((direction): direction is string => Boolean(direction))
    const previousDirection = recentDirections[0] ?? null
    function getStreakSignal(minLength: number): string | null {
      if (recentDirections.length < minLength) return null
      const slice = recentDirections.slice(0, minLength)
      if (slice.every((d) => d === "UP")) return "DOWN"
      if (slice.every((d) => d === "DOWN")) return "UP"
      return null
    }




    if (activeRound) {
      // No trade creation here — Railway bot is the sole executor
    }

    const agentResults = await db().select().from(agents).where(eq(agents.timeframe, "5m"))
    const recentTrades = await db().select().from(trades).where(and(eq(trades.strategyId, "streak-5m"))).orderBy(desc(trades.createdAt)).limit(100)
    const liveTrades = recentTrades.filter((trade) => trade.tradeMode === "live")
    const paperTrades = recentTrades.filter((trade) => trade.tradeMode !== "live")

    // Batch-load per-agent settings
    const allAgentSettings = await db().select().from(settings)
    const agentSettings: Record<string, number> = {}
    for (const s of allAgentSettings) {
      const val = Number(s.value)
      if (!Number.isNaN(val)) agentSettings[s.key] = val
    }

    // Get real PnL per agent from ALL paper trades (stake-based accounting)
    const agentRealPnLs = await db().select({
      agentId: trades.agentId,
      total: sql<number>`COALESCE(SUM(CASE WHEN result = 'won' THEN stake WHEN result = 'loss' THEN -stake END), 0)`,
    }).from(trades)
      .where(and(eq(trades.strategyId, "streak-5m"), eq(trades.tradeMode, "paper")))
      .groupBy(trades.agentId)

    const agentLadders: Record<string, number[]> = {}

    const rows = streakAgents.map((streak) => {
      const agent = agentResults.find((row) => row.id === streak.id)
      const baseTrades = paperTrades.filter((trade) => trade.agentId === streak.id && trade.roundId.startsWith("BTC5M-")).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      const liveAgentTrades = liveTrades
        .filter((trade) => trade.agentId === streak.id && trade.roundId.startsWith("BTC5M-"))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      const agentTrades = baseTrades

      const agentTarget = agentSettings[`target_${streak.id}`] ?? targetProfit
      const agentMultiplierVal = agentSettings[`multiplier_${streak.id}`] ?? multiplier
      const agentStepsVal = agentSettings[`steps_${streak.id}`] ?? ladderSteps
      const agentLadder = buildLadder(agentTarget, agentMultiplierVal, agentStepsVal)
      agentLadders[streak.id] = agentLadder

      const settledTrades = agentTrades.filter((trade) => trade.result !== "pending")
      const pendingTrade = agentTrades.find((trade) => trade.result === "pending")

      const state = replayStreakMachine(
        settledTrades.map((trade) => ({
          stake: Number(trade.stake),
          result: trade.result as "won" | "loss" | "pending" | "skipped",
          targetProfit: Number(trade.targetProfitSnapshot ?? agentTarget),
        })),
        agentLadder,
        agentTarget,
        agent?.startingBankroll ?? 1000,
      )

      let currentStep = state.currentStep
      let previousStep = state.previousStep
      let invested = state.investedOpen
      let status = state.status

      if (pendingTrade) {
        const pendingStake = Number(pendingTrade.stake)
        const pendingStepIndex = agentLadder.indexOf(pendingStake)
        const pendingStep = pendingStepIndex >= 0 ? pendingStepIndex + 1 : 1
        currentStep = pendingStep
        previousStep = pendingStep > 1 ? pendingStep - 1 : 0
        invested = agentLadder.slice(0, pendingStep).reduce((sum, value) => sum + value, 0)
        status = "active"
      }

      const livePendingStake = liveAgentTrades.filter((trade) => trade.result === "pending").reduce((sum, trade) => sum + Number(trade.stake ?? 0), 0)
      const liveRealizedProfit = liveAgentTrades.reduce((sum, trade) => sum + Math.max(0, Number(trade.pnl ?? 0)), 0)
      const liveRealizedLoss = liveAgentTrades.reduce((sum, trade) => sum + Math.abs(Math.min(0, Number(trade.pnl ?? 0))), 0)
      const balance = state.realizedProfit - state.realizedLoss
      const realBalance = agentRealPnLs.find(r => r.agentId === streak.id)?.total ?? 0
      const streakSignal = (streak as any).streak ? getStreakSignal((streak as any).streak) : null

      const triggerActive =
        streak.trigger === "always" ? true :
        streakSignal != null ? true :
        streak.trigger === "rsi" ? (rsi != null && (rsi <= 30 || rsi >= 80)) : false

      const isLive = agent?.isLive ?? false
      const direction = streakSignal ?? streak.direction

      return {
        id: streak.id,
        name: streak.name,
        direction,
        roundsCompleted: state.roundsCompleted,
        currentStep,
        previousStep,
        invested,
        liveInvested: livePendingStake,
        targetProfit,
        agentTarget,
        agentMultiplier: agentMultiplierVal,
        agentSteps: agentStepsVal,
        profit: state.realizedProfit,
        liveProfit: liveRealizedProfit - liveRealizedLoss,
        loss: state.realizedLoss,
        balance,
        realBalance,
        capital: state.totalCapital + balance,
        ladder: agentLadder,
        status: pendingTrade ? "active" : triggerActive ? "ready" : status,
        triggerActive,
        isLive,
      }
    })

    const recommendedTrades = rows
      .filter((row) => row.triggerActive)
      .map((row) => ({
        name: row.name,
        agentId: row.id,
        direction: row.direction,
        stake: row.ladder[row.currentStep - 1] || row.ladder[0],
      }))

    const liveCandidates = rows.filter((row) => row.id === "PREVIOUS_THREE_UP_5M" || row.id === "PREVIOUS_THREE_DOWN_5M")
    const liveFocus = liveCandidates.filter((row) => row.triggerActive)

    const liveHistory = recentTrades
      .filter((trade) => trade.tradeMode === "live")
      .map((trade) => {
        const match = String(trade.roundId).match(/BTC5M-(\d+)/)
        const start = match ? new Date(Number(match[1]) * 1000) : null
        const end = start ? new Date(start.getTime() + 5 * 60 * 1000) : null
        const windowLabel = start && end
          ? `${start.toLocaleDateString("en-US", { month: "long", day: "numeric" })}, ${start.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true })} - ${end.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true })}`
          : trade.roundId
        return { ...trade, windowLabel }
      })

    const totalInvested = rows.reduce((sum, row) => sum + row.invested, 0)
    const totalStartingCapital = streakAgents.reduce((sum, streak) => {
      const agent = agentResults.find(a => a.id === streak.id)
      return sum + (agent?.startingBankroll ?? 1000)
    }, 0)
    const totalWins = rows.reduce((sum, row) => sum + (row.profit > 0 ? Math.round(row.profit / targetProfit) : 0), 0)
    const totalTrades = rows.reduce((sum, row) => sum + row.roundsCompleted, 0)
    // Real cumulative earnings from all paper trades (stake-based accounting)
    const [paperPnlRow] = await db().select({
      total: sql<number>`COALESCE(SUM(CASE WHEN result = 'won' THEN stake WHEN result = 'loss' THEN -stake END), 0)`,
    }).from(trades).where(and(eq(trades.strategyId, "streak-5m"), eq(trades.tradeMode, "paper")))
    const totalEarnings = paperPnlRow?.total ?? 0
    // Balance = Earnings - Invested (available equity, not at risk)
    const totalBalance = totalEarnings - totalInvested
    // Capital = Starting Capital + Balance
    const totalCapital = totalStartingCapital + totalBalance

    // Live stats from DB (all live trades)
    const [liveAggRow] = await db().select({
      totalInvested: sql<number>`COALESCE(SUM(stake), 0)`,
      totalPnl: sql<number>`COALESCE(SUM(pnl), 0)`,
    }).from(trades).where(and(eq(trades.strategyId, "streak-5m"), eq(trades.tradeMode, "live")))
    const totalLiveInvested = liveAggRow?.totalInvested ?? 0
    const totalLivePnl = liveAggRow?.totalPnl ?? 0
    const liveWalletBalance = dbBalance || wallet?.balance || 0
    const livePending = liveTrades.filter((t) => t.result === "pending").reduce((s, t) => s + Number(t.stake ?? 0), 0)
    
    return NextResponse.json({
        live: null,
        currentWindow: {
          roundId: activeRound?.roundId,
          startTime: startTimeIso,
          endTime: endTimeIso,
        },
        rows,
        recommendedTrades,
        history: [],
        recentResultsIcons: recentDirections.map(d => d === "UP" ? "↑" : "↓"),
        debugRecentResults: [],
        liveFocus,
        recentTrades: (() => {
          // Compute cycle-aware PnL for paper trades only (separate cycles per agent)
          const chronological = [...paperTrades].reverse()
          const byAgent: Record<string, typeof chronological> = {}
          for (const t of chronological) {
            if (!byAgent[t.agentId]) byAgent[t.agentId] = []
            byAgent[t.agentId].push(t)
          }
          const pnlMap = new Map<string, number>()
          const runBalMap = new Map<string, number>()
          for (const trades of Object.values(byAgent)) {
            let accumulator = 0
            let running = 0
            for (const t of trades) {
              const stake = Number(t.stake)
              if (t.result === "won") {
                pnlMap.set(t.id, stake)
                running += stake
                accumulator = 0
              } else if (t.result === "loss") {
                pnlMap.set(t.id, -stake)
                running -= stake
                accumulator += stake
              } else {
                pnlMap.set(t.id, 0)
              }
              runBalMap.set(t.id, running)
            }
          }
          return recentTrades.map((trade) => {
            const match = String(trade.roundId).match(/BTC5M-(\d+)/)
            const start = match ? new Date(Number(match[1]) * 1000) : null
            const end = start ? new Date(start.getTime() + 5 * 60 * 1000) : null
            const windowLabel = start && end
              ? `${start.toLocaleDateString("en-US", { month: "long", day: "numeric" })}, ${start.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true })} - ${end.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true })}`
              : trade.roundId
            const tradeAgentLadder = agentLadders[trade.agentId] ?? ladder
            const ladderIndex = tradeAgentLadder.indexOf(Number(trade.stake))
            const ladderStage = ladderIndex >= 0 ? ladderIndex + 1 : null
            const tradeProfit = trade.tradeMode !== "live" ? (pnlMap.get(trade.id) ?? 0) : 0
            const closedStage = trade.result === "won" ? ladderStage : null
            const runningBalance = trade.tradeMode !== "live" ? (runBalMap.get(trade.id) ?? 0) : 0
            return { ...trade, windowLabel, ladderStage, tradeProfit, closedStage, runningBalance }
          })
        })(),
        displayTargetProfit,
        displayMultiplier,
        displayLadderSteps,
        displayTrendThreshold,
        rsi,
        trend: marketState ? {
          direction: marketState.trendDirection,
          strength: marketState.trendStrength != null && !isNaN(marketState.trendStrength) ? Number(marketState.trendStrength.toFixed(1)) : 0,
          regime: marketState.regime,
          emaSlope: marketState.emaSlope,
          highVolume: marketState.highVolume,
        } : null,
        trendStrengthThreshold: trendThreshold,
        polymarketPrices,
        targetProfit,
        multiplier,
        ladderSteps,
        ladder,
        liveHistory,
        wallet,
        liveSummary: {
          balance: dbBalance || wallet?.balance || 0,
          invested: liveTrades.filter((trade) => trade.result === "pending").reduce((sum, trade) => sum + Number(trade.stake ?? 0), 0),
          profits: liveTrades.reduce((sum, trade) => sum + Number(trade.pnl ?? 0), 0),
          returns: liveTrades.reduce((sum, trade) => sum + Number(trade.pnl ?? 0), 0),
        },
        stats: {
          invested: totalInvested,
          profits: totalEarnings,
          capital: totalCapital,
          balance: totalBalance,
          winRate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0,
          totalWins: totalWins,
          totalTrades: totalTrades,
        },
        liveStats: {
          invested: totalLiveInvested,
          profits: totalLivePnl,
          balance: liveWalletBalance,
          capital: liveWalletBalance + livePending,
        },
      })
  } catch (error) {
    console.error("BTC-5M API error:", error)
    return NextResponse.json({ error: "Internal Server Error", details: String(error) }, { status: 500 })
  }
}
