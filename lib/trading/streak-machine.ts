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
  atRisk: number
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
    atRisk: 0,
    totalCapital: capital,
    status: "idle",
  }
}

export function replayStreakMachine(trades: StreakMachineTrade[], ladder: number[], targetProfit: number, capital: number) {
  const state = createInitialStreakState(capital)

  // Track cycle: group of trades from step 1 until win or break
  // We track step SEQUENTIALLY (1, 2, 3...) instead of looking up by stake
  // This ensures ladder changes don't break the streak calculation
  let cycleStakes: number[] = []
  let currentStep = 0 // 0 = idle, 1 = first step, etc.

  for (const trade of trades) {
    if (trade.result === "skipped" || trade.result === "pending") continue

    state.roundsCompleted += 1

    // Determine step: if stake matches ladder, use that. Otherwise increment sequentially
    const stepIndex = ladder.indexOf(Number(trade.stake))
    if (stepIndex >= 0) {
      currentStep = stepIndex + 1
    } else {
      // Stake not in current ladder (settings changed). Increment step.
      currentStep = Math.min(currentStep + 1, ladder.length)
    }

    cycleStakes.push(Number(trade.stake))
    state.status = "active"

    if (trade.result === "won") {
      // Win! Cycle completes. Profit = target, losses in this cycle are RECOVERED.
      state.successfulCycles += 1
      state.realizedProfit += trade.targetProfit ?? targetProfit
      // Reset cycle
      cycleStakes = []
      currentStep = 0
      state.status = "idle"
      continue
    }

    // Loss
    if (currentStep >= ladder.length) {
      // Streak BREAKS! All losses in this cycle are realized.
      state.failedCycles += 1
      const cycleLoss = cycleStakes.reduce((sum, s) => sum + s, 0)
      state.realizedLoss += cycleLoss
      // Reset cycle
      cycleStakes = []
      currentStep = 0
      state.status = "broken"
      continue
    }

    // Continue streak
    state.status = "active"
  }

  // Set current state from active cycle (if any)
  if (currentStep > 0) {
    state.currentStep = currentStep
    state.previousStep = currentStep > 1 ? currentStep - 1 : 0
    state.investedOpen = cycleStakes.reduce((sum, s) => sum + s, 0)
    state.atRisk = state.investedOpen
  }

  return state
}
