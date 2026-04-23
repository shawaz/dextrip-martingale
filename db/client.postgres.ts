import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema.postgres"

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error("DATABASE_URL is required for Postgres runtime")
}

const globalForDb = globalThis as typeof globalThis & {
  dextripPgPool?: Pool
}

const pool = globalForDb.dextripPgPool ?? new Pool({ connectionString })

if (process.env.NODE_ENV !== "production") {
  globalForDb.dextripPgPool = pool
}

export const db = drizzle(pool, { schema })
export { pool }
