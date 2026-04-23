# Local database notes

This folder is the future source of truth for Dextrip Arena.

Planned stack:
- Drizzle ORM
- SQLite locally

Why:
- stable local battle state
- easier overnight runs
- Appwrite becomes a sync target, not the trading engine store

Next implementation steps:
1. Install `drizzle-orm`, `drizzle-kit`, and `better-sqlite3`
2. Create local client in `db/client.ts`
3. Run Drizzle migrations
4. Seed agents and strategies locally
5. Write a sync worker to Appwrite
