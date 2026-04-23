import { NextResponse } from "next/server"
import { db, sqlite } from "@/db/client"
import { agents, rounds, trades, settings } from "@/db/schema"
import { eq, and, desc, lt } from "drizzle-orm"
import { fetchPolymarketRoundTruth } from "@/lib/trading/polymarket"
import { buildScaledLadder, replayStreakMachine } from "@/lib/trading/streak-machine"
import crypto from "crypto"

async function getTargetProfit() {
  try {
    await sqlite.execute(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)

    const setting = await db.query.settings.findFirst({ where: eq(settings.key, "martingale_target_profit") })
    return setting ? Number(setting.value) : 5
  } catch (error) {
    console.error("getTargetProfit error:", error);
    return 5
  }
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
  { id: "PREVIOUS_UP_5M", name: "Previous UP", direction: "UP", trigger: "prev_up" },
  { id: "PREVIOUS_DOWN_5M", name: "Previous DOWN", direction: "DOWN", trigger: "prev_down" },
  { id: "PREVIOUS_THREE_UP_5M", name: "Previous 3 UP", direction: "DOWN", trigger: "prev_three_up" },
  { id: "PREVIOUS_THREE_DOWN_5M", name: "Previous 3 DOWN", direction: "UP", trigger: "prev_three_down" },
  { id: "RSI_UP_5M", name: "RSI UP", direction: "UP", trigger: "rsi_up" },
  { id: "RSI_DOWN_5M", name: "RSI DOWN", direction: "DOWN", trigger: "rsi_down" },
]

async function seedAgents() {
  const now = new Date().toISOString()
  for (const a of streakAgents) {
    const existing = await db.query.agents.findFirst({ where: eq(agents.id, a.id) })
    if (!existing) {
      await db.insert(agents).values({
        id: a.id,
        name: a.name,
        initials: a.name.split(" ").map((n) => n[0]).join(""),
        color: a.direction === "UP" ? "#10b981" : "#ef4444",
        timeframe: "5m",
        bankroll: 1000,
        startingBankroll: 1000,
        createdAt: now,
        updatedAt: now,
      })
    }
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const shouldReset = searchParams.get("reset") === "true"
    const newTarget = searchParams.get("target")

    if (shouldReset) {
      const existingAgents = await db.select().from(agents).where(eq(agents.timeframe, "5m"))
      for (const agent of existingAgents) {
        await db.delete(trades).where(eq(trades.agentId, agent.id))
      }
      await db.delete(rounds).where(eq(rounds.timeframe, "5m"))
      await db.delete(agents).where(eq(agents.timeframe, "5m"))
    }

    if (newTarget) {
      const val = Number(newTarget)
      if (!Number.isNaN(val) && val > 0) {
        await db.insert(settings).values({
          key: "martingale_target_profit",
          value: String(val),
          updatedAt: new Date().toISOString(),
        }).onConflictDoUpdate({
          target: settings.key,
          set: { value: String(val), updatedAt: new Date().toISOString() },
        })
      }
    }

    const targetProfit = await getTargetProfit()
    const ladder = buildScaledLadder(targetProfit)

    await seedAgents()

    const now = new Date()
    const intervalS = 300
    const currentTs = Math.floor(now.getTime() / 1000)
    const windowTs = currentTs - (currentTs % intervalS)
    const startTimeIso = new Date(windowTs * 1000).toISOString()
    const endTimeIso = new Date((windowTs + intervalS) * 1000).toISOString()

    const existingRound = await db.query.rounds.findFirst({ where: eq(rounds.startTime, startTimeIso) })
    if (!existingRound) {
      await db.insert(rounds).values({
        id: crypto.randomUUID(),
        roundId: `BTC5M-${windowTs}`,
        asset: "BTC",
        timeframe: "5m",
        startTime: startTimeIso,
        endTime: endTimeIso,
        entryPrice: 0,
        status: "open",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    }

    const openRounds = await db.select().from(rounds).where(and(eq(rounds.timeframe, "5m"), eq(rounds.status, "open"), lt(rounds.startTime, startTimeIso)))
    for (const round of openRounds) {
      const truth = await fetchPolymarketRoundTruth(round.startTime, 5)
      if (!truth || !truth.resolvedDirection) continue

      await db.update(rounds).set({
        status: "closed",
        officialEntryPrice: truth.priceToBeat ?? 0,
        officialExitPrice: truth.finalPrice ?? truth.priceToBeat ?? 0,
        resolvedDirection: truth.resolvedDirection,
        updatedAt: new Date().toISOString(),
      }).where(eq(rounds.id, round.id))

      const roundTrades = await db.select().from(trades).where(eq(trades.roundId, round.roundId))
      for (const trade of roundTrades) {
        await db.update(trades).set({
          exitPrice: truth.finalPrice ?? truth.priceToBeat ?? 0,
          result: trade.signal === truth.resolvedDirection ? "won" : "loss",
          pnl: 0,
          updatedAt: new Date().toISOString(),
        }).where(eq(trades.id, trade.id))
      }
    }

    const activeRound = await db.query.rounds.findFirst({ where: eq(rounds.startTime, startTimeIso) })
    const liveTruth = await fetchPolymarketRoundTruth(startTimeIso, 5)

    const closedRounds = await db.select().from(rounds).where(and(eq(rounds.timeframe, "5m"), eq(rounds.status, "closed"))).orderBy(desc(rounds.startTime)).limit(30)
    const recentCloses = closedRounds
      .map((round) => Number(round.officialExitPrice ?? round.exitPrice ?? 0))
      .filter((value) => value > 0)
      .reverse()
    const currentPrice = Number(liveTruth?.finalPrice ?? liveTruth?.priceToBeat ?? 0)
    const rsi = calculateRsi(currentPrice > 0 ? [...recentCloses, currentPrice] : recentCloses, 14)

    if (activeRound) {
      for (const streak of streakAgents) {
        const existingTrade = await db.query.trades.findFirst({ where: and(eq(trades.agentId, streak.id), eq(trades.roundId, activeRound.roundId)) })
        if (existingTrade) continue

        const recentDirections = closedRounds
          .map((round) => round.resolvedDirection)
          .filter((direction): direction is string => Boolean(direction))
        const previousDirection = recentDirections[0] ?? liveTruth?.recentResults?.[0]?.direction ?? null
        const previousThreeUp = recentDirections.slice(0, 3).length === 3 && recentDirections.slice(0, 3).every((direction) => direction === "UP")
        const previousThreeDown = recentDirections.slice(0, 3).length === 3 && recentDirections.slice(0, 3).every((direction) => direction === "DOWN")

        let shouldTrade = streak.trigger === "always"
        if (streak.trigger === "prev_up") shouldTrade = previousDirection === "UP"
        if (streak.trigger === "prev_down") shouldTrade = previousDirection === "DOWN"
        if (streak.trigger === "prev_three_up") shouldTrade = previousThreeUp
        if (streak.trigger === "prev_three_down") shouldTrade = previousThreeDown
        if (streak.trigger === "rsi_up") shouldTrade = rsi != null && rsi <= 30
        if (streak.trigger === "rsi_down") shouldTrade = rsi != null && rsi >= 70
        if (!shouldTrade) continue

        const priorTrades = await db.select().from(trades).where(eq(trades.agentId, streak.id)).orderBy(desc(trades.createdAt))
        const state = replayStreakMachine(
          priorTrades
            .filter((trade) => trade.roundId.startsWith("BTC5M-"))
            .map((trade) => ({ stake: Number(trade.stake), result: trade.result as "won" | "loss" | "pending" | "skipped" })),
          ladder,
          targetProfit,
          1000,
        )

        const nextStep = state.currentStep > 0 ? state.currentStep : 1
        const stake = ladder[Math.max(0, nextStep - 1)]

        await db.insert(trades).values({
          id: crypto.randomUUID(),
          agentId: streak.id,
          roundId: activeRound.roundId,
          strategyId: "streak-5m",
          signal: streak.direction,
          stake,
          entryPrice: liveTruth?.priceToBeat ?? 0,
          result: "pending",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      }
    }

    const agentResults = await db.select().from(agents).where(eq(agents.timeframe, "5m"))
    const recentTrades = await db.select().from(trades).where(and(eq(trades.strategyId, "streak-5m"))).orderBy(desc(trades.createdAt)).limit(100)

    const rows = streakAgents.map((streak) => {
      const agent = agentResults.find((row) => row.id === streak.id)
      const agentTrades = recentTrades
        .filter((trade) => trade.agentId === streak.id && trade.roundId.startsWith("BTC5M-"))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

      const settledTrades = agentTrades.filter((trade) => trade.result !== "pending")
      const pendingTrade = agentTrades.find((trade) => trade.result === "pending")

      const state = replayStreakMachine(
        settledTrades.map((trade) => ({
          stake: Number(trade.stake),
          result: trade.result as "won" | "loss" | "pending" | "skipped",
        })),
        ladder,
        targetProfit,
        agent?.startingBankroll ?? 1000,
      )

      let currentStep = state.currentStep
      let previousStep = state.previousStep
      let invested = state.investedOpen
      let status = state.status

      if (pendingTrade) {
        const pendingStake = Number(pendingTrade.stake)
        const pendingStepIndex = ladder.indexOf(pendingStake)
        const pendingStep = pendingStepIndex >= 0 ? pendingStepIndex + 1 : 1
        currentStep = pendingStep
        previousStep = pendingStep > 1 ? pendingStep - 1 : 0
        invested = ladder.slice(0, pendingStep).reduce((sum, value) => sum + value, 0)
        status = "active"
      }

      const balance = state.realizedProfit - state.realizedLoss - invested
      return {
        id: streak.id,
        name: streak.name,
        direction: streak.direction,
        roundsCompleted: state.roundsCompleted,
        currentStep,
        previousStep,
        invested,
        targetProfit,
        profit: state.realizedProfit,
        loss: state.realizedLoss,
        balance,
        capital: state.totalCapital + balance,
        ladder,
        status,
      }
    })

    const recommendedTrades = rows
      .filter((row) => row.status === "active")
      .map((row) => ({
        agentId: row.id,
        direction: row.direction,
        stake: row.ladder[row.currentStep - 1] || row.ladder[0],
      }))

    return NextResponse.json({
      live: liveTruth,
      currentWindow: {
        roundId: activeRound?.roundId,
        startTime: startTimeIso,
        endTime: endTimeIso,
      },
      rows,
      recommendedTrades,
      history: liveTruth?.recentResults || [],
      recentTrades: recentTrades.slice(0, 50).map((trade) => {
        const match = String(trade.roundId).match(/BTC5M-(\d+)/)
        const start = match ? new Date(Number(match[1]) * 1000) : null
        const end = start ? new Date(start.getTime() + 5 * 60 * 1000) : null
        const windowLabel = start && end
          ? `${start.toLocaleDateString("en-US", { month: "long", day: "numeric" })}, ${start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })} - ${end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`
          : trade.roundId
        const ladderIndex = ladder.indexOf(Number(trade.stake))
        const ladderStage = ladderIndex >= 0 ? ladderIndex + 1 : null
        const tradeProfit = trade.result === "won" ? targetProfit : 0
        const closedStage = trade.result === "won" ? ladderStage : null
        return { ...trade, windowLabel, ladderStage, tradeProfit, closedStage }
      }),
      rsi,
      targetProfit,
      ladder,
      stats: {
        invested: rows.reduce((sum, row) => sum + row.invested, 0),
        profits: rows.reduce((sum, row) => sum + row.profit, 0),
        capital: rows.reduce((sum, row) => sum + row.capital, 0),
        portfolio: rows.reduce((sum, row) => sum + row.profit, 0) - rows.reduce((sum, row) => sum + row.invested, 0),
      },
    })
  } catch (error) {
    console.error("BTC-5M API error:", error)
    return NextResponse.json({ error: "Internal Server Error", details: String(error) }, { status: 500 })
  }
}
