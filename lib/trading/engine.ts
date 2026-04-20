import { loadBotConfig } from "./config";
import { createArenaStoreFromEnv } from "./appwrite-admin";
import { fetchMarketSnapshot } from "./market-data";
import { evaluateStrategySet } from "./strategies";
import { selectAgentDecision } from "./llm";
import { executeBullpenTrade } from "./bullpen";
import { AgentProfile, ExecutionPlan, RoundWindow, StrategyDecision, Timeframe } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function timeframeToMinutes(timeframe: Timeframe): number {
  if (timeframe === "15m") return 15;
  if (timeframe === "1h") return 60;
  return 240;
}

function getRoundWindow(now: Date, timeframe: Timeframe, asset: string, entryPrice: number): RoundWindow {
  const intervalMinutes = timeframeToMinutes(timeframe);
  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setMinutes(now.getMinutes() - (now.getMinutes() % intervalMinutes));

  const end = new Date(start);
  end.setMinutes(start.getMinutes() + intervalMinutes);

  return {
    roundId: `${asset.toLowerCase()}-${timeframe}-${start.getTime()}`,
    asset,
    timeframe,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    entryPrice,
    status: "active",
  };
}

function buildExecutionPlan(params: {
  bankroll: number;
  confidence: number;
  signal: "UP" | "DOWN";
  marketSlug?: string;
  maxRiskPerTradePct: number;
  kellyFraction: number;
}): ExecutionPlan | null {
  if (!params.marketSlug) {
    return null;
  }

  const riskBudget = params.bankroll * params.maxRiskPerTradePct;
  const edge = Math.max(0, params.confidence * 2 - 1);
  const stakeUsd = roundToTwo(Math.max(1, riskBudget * Math.max(0.25, edge) * params.kellyFraction));

  return {
    signal: params.signal,
    outcome: params.signal === "UP" ? "Yes" : "No",
    stakeUsd,
    marketSlug: params.marketSlug,
  };
}

async function processAgent(params: {
  agent: AgentProfile;
  currentRound: RoundWindow;
  currentPrice: number;
  snapshotSymbol: string;
  snapshotFetchedAt: string;
  decisions: StrategyDecision[];
  anthropicApiKey?: string;
  anthropicModel: string;
  marketSlug?: string;
  maxRiskPerTradePct: number;
  kellyFraction: number;
  dryRun: boolean;
  liveTradingEnabled: boolean;
  hasExistingTrade: boolean;
  createTrade: (record: {
    agentId: string;
    roundId: string;
    strategyName: StrategyDecision["strategy"];
    signal: "UP" | "DOWN";
    entry: number;
    result: "pending";
  }) => Promise<void>;
}): Promise<void> {
  if (params.hasExistingTrade) {
    return;
  }

  const decision = await selectAgentDecision({
    apiKey: params.anthropicApiKey,
    model: params.anthropicModel,
    agent: params.agent,
    snapshot: {
      symbol: params.snapshotSymbol,
      timeframe: params.agent.timeframe,
      price: params.currentPrice,
      fetchedAt: params.snapshotFetchedAt,
      candles: [],
    },
    strategyDecisions: params.decisions,
  });

  const prefix = `[${params.agent.name} ${params.agent.timeframe}]`;
  console.log(`${prefix} ${decision.strategy} -> ${decision.signal} (${Math.round(decision.confidence * 100)}%)`);

  if (!decision.shouldTrade || decision.signal === "HOLD") {
    return;
  }

  const executionPlan = buildExecutionPlan({
    bankroll: params.agent.bankroll,
    confidence: decision.confidence,
    signal: decision.signal,
    marketSlug: params.marketSlug,
    maxRiskPerTradePct: params.maxRiskPerTradePct,
    kellyFraction: params.kellyFraction,
  });

  if (params.agent.isPromoted && params.liveTradingEnabled && executionPlan) {
    const execution = await executeBullpenTrade(executionPlan, params.dryRun);
    console.log(`${prefix} ${execution.dryRun ? "simulated" : "submitted"} ${executionPlan.outcome} for $${executionPlan.stakeUsd.toFixed(2)}`);
  } else if (params.agent.isPromoted) {
    console.log(`${prefix} promoted, but execution skipped because live mode or market slug is missing.`);
  }

  await params.createTrade({
    agentId: params.agent.id,
    roundId: params.currentRound.roundId,
    strategyName: decision.strategy,
    signal: decision.signal,
    entry: params.currentPrice,
    result: "pending",
  });
}

export async function runTradingEngine(argv: string[]): Promise<void> {
  const config = loadBotConfig(argv);
  const store = createArenaStoreFromEnv(
    config.appwriteEndpoint,
    config.appwriteProjectId,
    config.appwriteApiKey,
    config.appwriteDatabaseId,
  );

  if (!store) {
    throw new Error("Appwrite credentials are missing.");
  }

  console.log(`Trading bot started in ${config.dryRun ? "dry-run" : "live"} mode for ${config.symbol}.`);

  do {
    try {
      const timeframes: Timeframe[] = ["15m", "1h", "4h"];
      const snapshots = await Promise.all(timeframes.map((timeframe) => fetchMarketSnapshot(config.symbol, timeframe, config.candleLookback)));
      const priceMap = Object.fromEntries(snapshots.map((snapshot) => [snapshot.timeframe, snapshot.price])) as Record<Timeframe, number>;

      await store.resolveFinishedRounds(priceMap);
      const agents = await store.listActiveAgents(config.defaultBankrollUsd);
      const now = new Date();

      for (const timeframe of timeframes) {
        const snapshot = snapshots.find((item) => item.timeframe === timeframe)!;
        let currentRound = await store.findActiveRound(now.toISOString(), timeframe);

        if (!currentRound) {
          currentRound = await store.createRound(getRoundWindow(now, timeframe, `${config.symbol}-${timeframe}`, snapshot.price));
          console.log(`Opened ${timeframe} round ${currentRound.roundId} at $${snapshot.price.toFixed(2)}.`);
        }

        const timeframeAgents = agents.filter((agent) => agent.timeframe === timeframe);
        const decisions = evaluateStrategySet(snapshot);

        for (const agent of timeframeAgents) {
          const hasExistingTrade = await store.hasTradeForRound(agent.id, currentRound.roundId);
          await processAgent({
            agent,
            currentRound,
            currentPrice: snapshot.price,
            snapshotSymbol: snapshot.symbol,
            snapshotFetchedAt: snapshot.fetchedAt,
            decisions,
            anthropicApiKey: config.anthropicApiKey,
            anthropicModel: config.anthropicModel,
            marketSlug: config.bullpenMarketSlug,
            maxRiskPerTradePct: config.maxRiskPerTradePct,
            kellyFraction: config.kellyFraction,
            dryRun: config.dryRun,
            liveTradingEnabled: config.liveTrading,
            hasExistingTrade,
            createTrade: (record) => store.createTrade(record),
          });
        }
      }
    } catch (error) {
      console.error("Bot cycle failed:", error);
    }

    if (!config.once) {
      await sleep(60_000);
    }
  } while (!config.once);
}
