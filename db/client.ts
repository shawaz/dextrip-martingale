import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type DbType = ReturnType<typeof drizzle<typeof schema>>;
let _db: DbType | null = null;

export function db(): DbType {
  if (!_db) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    _db = drizzle(neon(process.env.DATABASE_URL), { schema });
  }
  return _db;
}