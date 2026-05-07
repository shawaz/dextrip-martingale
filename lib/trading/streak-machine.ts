export function buildLadder(targetProfit: number, multiplier: number, steps: number): number[] {
  const ladder: number[] = []
  let current = targetProfit
  for (let i = 0; i < steps; i++) {
    ladder.push(Math.max(1, Math.round(current)))
    current *= multiplier
  }
  return ladder
}

export type StreakMachineState = {
  roundsCompleted: number
  successfulCycles: number
  failedCycles: number
  currentStep: number
  previousStep: number
  investedOpen: number
  realizedProfit: number
  realizedLoss: number
  totalCapital: number
  status: "idle" | "active" | "broken"
}

export type StreakMachineTrade = {
  stake: number
  result: "won" | "loss" | "pending" | "skipped"
  targetProfit?: number
}

export function createInitialStreakState(capital: number): StreakMachineState {
  return {
    roundsCompleted: 0,
    successfulCycles: 0,
    failedCycles: 0,
    currentStep: 0,
    previousStep: 0,
    investedOpen: 0,
    realizedProfit: 0,
    realizedLoss: 0,
    totalCapital: capital,
    status: "idle",
  }
}

export function replayStreakMachine(trades: StreakMachineTrade[], ladder: number[], targetProfit: number, capital: number) {
  const state = createInitialStreakState(capital)

  for (const trade of trades) {
    if (trade.result === "skipped" || trade.result === "pending") continue

    const stepIndex = ladder.indexOf(Number(trade.stake))
    const resolvedStep = stepIndex >= 0 ? stepIndex + 1 : Math.min(ladder.length, state.currentStep || 1)

    state.roundsCompleted += 1
    state.previousStep = state.currentStep
    state.currentStep = resolvedStep
    state.investedOpen = ladder.slice(0, resolvedStep).reduce((sum, value) => sum + value, 0)
    state.status = "active"

    if (trade.result === "won") {
      state.successfulCycles += 1
      state.realizedProfit += trade.targetProfit ?? targetProfit
      state.previousStep = resolvedStep
      state.currentStep = 0
      state.investedOpen = 0
      state.status = "idle"
      continue
    }

    // Every loss costs the stake amount
    state.realizedLoss += Number(trade.stake)

    if (resolvedStep >= ladder.length) {
      state.failedCycles += 1
      state.previousStep = resolvedStep
      state.currentStep = 0
      state.investedOpen = 0
      state.status = "broken"
      continue
    }

    state.previousStep = resolvedStep
    state.currentStep = resolvedStep + 1
    state.investedOpen = ladder.slice(0, state.currentStep).reduce((sum, value) => sum + value, 0)
    state.status = "active"
  }

  return state
}
