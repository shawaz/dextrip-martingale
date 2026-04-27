import { NextResponse } from "next/server"
import { db, rounds } from "@/db/index"
import { fetchPolymarketRoundTruth } from "@/lib/trading/polymarket"

function buildStreakRow({ title, direction, trigger, currentStep }: { title: string; direction: "UP" | "DOWN"; trigger: string; currentStep: number }) {
  const ladder = [5, 12, 27, 59, 130]
  const buyPrice = 0.55
  const stake = currentStep ? ladder[Math.max(0, currentStep - 1)] : 0
  const shares = stake ? stake / buyPrice : 0
  const grossProfit = shares * (1 - buyPrice)
  const totalAdded = ladder.slice(0, Math.max(0, currentStep)).reduce((sum, value) => sum + value, 0)
  const recoveryTarget = stake ? stake * 1.2 : 0

  return {
    title,
    direction,
    trigger,
    step: currentStep,
    stake,
    totalAdded,
    recoveryTarget,
    estimatedShares: shares,
    estimatedProfit: grossProfit,
    closedProfit: Number((grossProfit - Math.max(0, totalAdded - stake)).toFixed(2)),
    buyPrice,
    ladder,
    currentStageValue: currentStep ? ladder[Math.max(0, currentStep - 1)] : null,
    previousStageValue: currentStep > 1 ? ladder[currentStep - 2] : null,
  }
}

export async function GET() {
  const roundRows = await db().select().from(rounds)
  const latestRound = [...roundRows].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0]
  const liveTruth = latestRound ? await fetchPolymarketRoundTruth(latestRound.startTime) : null
  const priceToBeat = Number(liveTruth?.priceToBeat ?? latestRound?.officialEntryPrice ?? latestRound?.entryPrice ?? 0)
  const finalPrice = Number(liveTruth?.finalPrice ?? latestRound?.officialExitPrice ?? latestRound?.exitPrice ?? priceToBeat)
  const liveDirection = liveTruth?.resolvedDirection ?? latestRound?.resolvedDirection ?? (finalPrice >= priceToBeat ? "UP" : "DOWN")
  const syntheticRsi = priceToBeat > 0 ? Math.max(0, Math.min(100, 50 + ((finalPrice - priceToBeat) / priceToBeat) * 4000)) : 50

  const streaks = [
    buildStreakRow({ title: "Streak Up", direction: "UP", trigger: `Live Polymarket ${latestRound?.roundId ?? "--"}`, currentStep: liveDirection === "UP" ? 1 : 2 }),
    buildStreakRow({ title: "Streak Down", direction: "DOWN", trigger: `Live Polymarket ${latestRound?.roundId ?? "--"}`, currentStep: liveDirection === "DOWN" ? 1 : 2 }),
    buildStreakRow({ title: "RSI 80 Down", direction: "DOWN", trigger: `RSI >= 80, live ${syntheticRsi.toFixed(0)}`, currentStep: syntheticRsi >= 80 ? 1 : 0 }),
    buildStreakRow({ title: "RSI 15 Up", direction: "UP", trigger: `RSI <= 15, live ${syntheticRsi.toFixed(0)}`, currentStep: syntheticRsi <= 15 ? 1 : 0 }),
  ]

  const streakHistory = [...roundRows]
    .filter((round) => round.status === "closed")
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 20)
    .map((round, index) => {
      const entry = Number(round.officialEntryPrice ?? round.entryPrice ?? 0)
      const exit = Number(round.officialExitPrice ?? round.exitPrice ?? 0)
      const won = round.resolvedDirection === "UP"
      const amount = Math.abs(exit - entry)
      return {
        id: `${round.roundId}-${index}`,
        roundId: round.roundId,
        window: `${new Date(round.startTime).toISOString()} → ${new Date(round.endTime).toISOString()}`,
        direction: round.resolvedDirection,
        entry,
        exit,
        outcome: won ? "Won" : "Lost",
        wonAmount: won ? amount : 0,
        lostAmount: won ? 0 : amount,
        streakName: round.resolvedDirection === "UP" ? "Streak Up" : "Streak Down",
      }
    })

  return NextResponse.json({ streaks, streakHistory, liveRound: latestRound, liveTruth })
}
