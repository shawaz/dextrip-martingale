/**
 * Database adapter for Dextrip Martingale
 * Auto-detects Neon (serverless HTTP) vs standard PostgreSQL
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type DbType = ReturnType<typeof drizzle<typeof schema>>;
let _db: DbType | null = null;

export function db(): DbType {
  if (!_db) {
    const databaseUrl = process.env.DATABASE_URL;
    
    if (!databaseUrl) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    
    if (databaseUrl.includes("neon.tech")) {
      _db = drizzle(neon(databaseUrl), { schema }) as unknown as DbType;
    } else {
      const pool = new Pool({ connectionString: databaseUrl });
      _db = pgDrizzle(pool, { schema }) as unknown as DbType;
    }
  }
  return _db;
}

// Export schema for use in queries
export { schema };

// Re-export commonly used schema items
export const { agents, rounds, trades, settings, walletBalances } = schema;