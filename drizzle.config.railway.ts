import { defineConfig } from "drizzle-kit"

const url = process.env.DATABASE_URL

if (!url) {
  throw new Error("DATABASE_URL is required for Railway/Postgres drizzle config")
}

export default defineConfig({
  out: "./drizzle-railway",
  schema: "./db/schema.postgres.ts",
  dialect: "postgresql",
  dbCredentials: {
    url,
  },
})
