import { Client, Databases, ID, Models, Query } from "node-appwrite";
import { AgentProfile, AgentTradeRecord, RoundWindow, StrategyCard, Timeframe } from "./types";
import { getPreferredStrategy, getStrategyCardsForTimeframe } from "./strategies";

interface AppwriteAgentDocument extends Models.Document {
  name: string;
  init?: string;
  color?: string;
  isActive?: boolean;
  timeframe?: Timeframe;
  won?: number;
  loss?: number;
  winRate?: number;
  promoted?: boolean;
  strategyCards?: string[];
}

interface AppwriteRoundDocument extends Models.Document {
  roundId: string;
  asset: string;
  timeframe: Timeframe;
  startTime: string;
  endTime: string;
  entryPrice: number;
  exitPrice?: number;
  status: "active" | "closed";
}

interface AppwriteTradeDocument extends Models.Document {
  agentId: string;
  roundId: string;
  signal: "UP" | "DOWN";
  entry: number;
  result: "pending" | "won" | "loss";
}

const seededAgents: Array<{
  name: string;
  init: string;
  color: string;
  timeframe: Timeframe;
}> = [
  { name: "Lisa", init: "LI", color: "#F4B400", timeframe: "15m" },
  { name: "Bart", init: "BA", color: "#FF6D01", timeframe: "15m" },
  { name: "Marge", init: "MA", color: "#4285F4", timeframe: "1h" },
  { name: "Homer", init: "HO", color: "#34A853", timeframe: "1h" },
  { name: "Mr Burns", init: "MB", color: "#A142F4", timeframe: "4h" },
];

function toStrategyCardNames(cards: StrategyCard[]): string[] {
  return cards.map((card) => card.name);
}

export class ArenaStore {
  private databases: Databases;

  constructor(
    endpoint: string,
    projectId: string,
    apiKey: string,
    private databaseId: string,
  ) {
    const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
    this.databases = new Databases(client);
  }

  async ensureSeedAgents(): Promise<void> {
    const existing = await this.databases.listDocuments<AppwriteAgentDocument>(this.databaseId, "agents", [Query.limit(100)]);
    const existingNames = new Set(existing.documents.map((agent) => agent.name));

    for (const agent of seededAgents) {
      if (existingNames.has(agent.name)) {
        continue;
      }

      await this.databases.createDocument(this.databaseId, "agents", ID.unique(), {
        name: agent.name,
        init: agent.init,
        color: agent.color,
        timeframe: agent.timeframe,
        won: 0,
        loss: 0,
        winRate: 0,
        promoted: false,
        isActive: true,
        strategyCards: toStrategyCardNames(getStrategyCardsForTimeframe(agent.timeframe)),
      });
    }
  }

  async listActiveAgents(defaultBankrollUsd: number): Promise<AgentProfile[]> {
    await this.ensureSeedAgents();

    const result = await this.databases.listDocuments<AppwriteAgentDocument>(this.databaseId, "agents", [
      Query.equal("isActive", true),
      Query.limit(100),
    ]);

    return result.documents.map((agent) => ({
      id: agent.$id,
      name: agent.name,
      initials: agent.init ?? agent.name.slice(0, 2).toUpperCase(),
      color: agent.color ?? "#7F77DD",
      bankroll: defaultBankrollUsd,
      timeframe: agent.timeframe ?? "15m",
      preferredStrategy: getPreferredStrategy(agent.name),
      strategyCards: getStrategyCardsForTimeframe(agent.timeframe ?? "15m"),
      won: Number(agent.won ?? 0),
      loss: Number(agent.loss ?? 0),
      winRate: Number(agent.winRate ?? 0),
      isPromoted: Boolean(agent.promoted),
    }));
  }

  async findActiveRound(nowIso: string, timeframe: Timeframe): Promise<RoundWindow | null> {
    const result = await this.databases.listDocuments<AppwriteRoundDocument>(this.databaseId, "rounds", [
      Query.equal("status", "active"),
      Query.equal("timeframe", timeframe),
      Query.greaterThan("endTime", nowIso),
      Query.orderAsc("startTime"),
      Query.limit(1),
    ]);

    const round = result.documents[0];
    if (!round) {
      return null;
    }

    return {
      roundId: round.roundId,
      asset: round.asset,
      timeframe: round.timeframe,
      startTime: round.startTime,
      endTime: round.endTime,
      entryPrice: round.entryPrice,
      status: round.status,
      documentId: round.$id,
    };
  }

  async createRound(round: RoundWindow): Promise<RoundWindow> {
    const document = await this.databases.createDocument(this.databaseId, "rounds", ID.unique(), {
      roundId: round.roundId,
      asset: round.asset,
      timeframe: round.timeframe,
      startTime: round.startTime,
      endTime: round.endTime,
      entryPrice: round.entryPrice,
      status: round.status,
    });

    return { ...round, documentId: document.$id };
  }

  async updatePromotions(): Promise<void> {
    const agents = await this.databases.listDocuments<AppwriteAgentDocument>(this.databaseId, "agents", [Query.equal("isActive", true), Query.limit(100)]);
    const leaders = new Map<Timeframe, string>();
    const grouped = new Map<Timeframe, AppwriteAgentDocument[]>();

    for (const agent of agents.documents) {
      const timeframe = agent.timeframe ?? "15m";
      grouped.set(timeframe, [...(grouped.get(timeframe) ?? []), agent]);
    }

    for (const [timeframe, group] of grouped.entries()) {
      const top = [...group].sort((a, b) => Number(b.winRate ?? 0) - Number(a.winRate ?? 0) || Number(b.won ?? 0) - Number(a.won ?? 0))[0];
      if (top) leaders.set(timeframe, top.$id);
    }

    for (const agent of agents.documents) {
      const shouldPromote = leaders.get(agent.timeframe ?? "15m") === agent.$id;
      if (Boolean(agent.promoted) !== shouldPromote) {
        await this.databases.updateDocument(this.databaseId, "agents", agent.$id, {
          promoted: shouldPromote,
        });
      }
    }
  }

  async resolveFinishedRounds(currentPriceByTimeframe: Partial<Record<Timeframe, number>>): Promise<void> {
    const nowIso = new Date().toISOString();
    const rounds = await this.databases.listDocuments<AppwriteRoundDocument>(this.databaseId, "rounds", [
      Query.equal("status", "active"),
      Query.lessThanEqual("endTime", nowIso),
      Query.limit(100),
    ]);

    for (const round of rounds.documents) {
      const exitPrice = currentPriceByTimeframe[round.timeframe];
      if (!exitPrice) {
        continue;
      }

      await this.databases.updateDocument(this.databaseId, "rounds", round.$id, {
        status: "closed",
        exitPrice,
      });

      const trades = await this.databases.listDocuments<AppwriteTradeDocument>(this.databaseId, "trades", [
        Query.equal("roundId", round.roundId),
        Query.limit(100),
      ]);

      for (const trade of trades.documents) {
        const won =
          (trade.signal === "UP" && exitPrice > round.entryPrice) ||
          (trade.signal === "DOWN" && exitPrice < round.entryPrice);

        await this.databases.updateDocument(this.databaseId, "trades", trade.$id, {
          exit: exitPrice,
          result: won ? "won" : "loss",
        });

        const agent = await this.databases.getDocument(this.databaseId, "agents", trade.agentId);
        const nextWon = Number(agent.won ?? 0) + (won ? 1 : 0);
        const nextLoss = Number(agent.loss ?? 0) + (won ? 0 : 1);
        const nextWinRate = nextWon + nextLoss > 0 ? (nextWon / (nextWon + nextLoss)) * 100 : 0;

        await this.databases.updateDocument(this.databaseId, "agents", trade.agentId, {
          won: nextWon,
          loss: nextLoss,
          winRate: nextWinRate,
        });
      }
    }

    await this.updatePromotions();
  }

  async hasTradeForRound(agentId: string, roundId: string): Promise<boolean> {
    const result = await this.databases.listDocuments<AppwriteTradeDocument>(this.databaseId, "trades", [
      Query.equal("agentId", agentId),
      Query.equal("roundId", roundId),
      Query.limit(1),
    ]);

    return result.total > 0;
  }

  async createTrade(record: AgentTradeRecord): Promise<void> {
    await this.databases.createDocument(this.databaseId, "trades", ID.unique(), record);
  }
}

export function createArenaStoreFromEnv(
  endpoint: string | undefined,
  projectId: string | undefined,
  apiKey: string | undefined,
  databaseId: string,
): ArenaStore | null {
  if (!endpoint || !projectId || !apiKey) {
    return null;
  }

  return new ArenaStore(endpoint, projectId, apiKey, databaseId);
}
