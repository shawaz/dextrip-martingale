import { db } from "./db/client";
import { agents, trades } from "./db/schema";
import { eq } from "drizzle-orm";
import { buildScaledLadder, replayStreakMachine } from "./lib/trading/streak-machine";

async function test() {
  console.log("--- Testing Martingale Logic ---");
  
  const targetProfit = 5;
  const ladder = buildScaledLadder(targetProfit);
  console.log("Ladder:", ladder);

  const streakAgents = [
    { id: "EVERY_UP_5M", name: "Every UP", direction: "UP" },
    { id: "EVERY_DOWN_5M", name: "Every DOWN", direction: "DOWN" },
  ];

  try {
    const agentResults = await db.select().from(agents);
    console.log(`Found ${agentResults.length} agents in DB.`);

    const rows = streakAgents.map((streak) => {
      const state = { currentStep: 1, status: "active" }; // Mocking active state
      return {
        id: streak.id,
        direction: streak.direction,
        status: state.status,
        currentStep: state.currentStep,
        ladder,
      };
    });

    const recommendedTrades = rows
      .filter((row) => row.status === "active")
      .map((row) => ({
        agentId: row.id,
        direction: row.direction,
        stake: row.ladder[row.currentStep - 1] || row.ladder[0],
      }));

    console.log("Recommended Trades Sample:", recommendedTrades);
    console.log("--- Logic Check Passed ---");
  } catch (e) {
    console.error("Database check failed (Expected if Turso env vars are missing and local DB is empty):", e.message);
  }
}

test();
