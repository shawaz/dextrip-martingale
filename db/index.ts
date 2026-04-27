/**
 * Database adapter for Dextrip Martingale
 * Uses Neon Postgres (Vercel/Neon) by default, can fallback to SQLite locally
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type DbType = ReturnType<typeof drizzle<typeof schema>>;
let _db: DbType | null = null;

export function db(): DbType {
  if (!_db) {
    const databaseUrl = process.env.DATABASE_URL;
    
    if (!databaseUrl) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    
    _db = drizzle(neon(databaseUrl), { schema });
  }
  return _db;
}

// Export schema for use in queries
export { schema };

// Re-export commonly used schema items
export const { agents, rounds, trades, settings, walletBalances } = schema;