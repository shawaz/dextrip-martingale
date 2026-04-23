# Dextrip Railway backend plan

## What this does now

This is the first backend hardening pass for moving Dextrip off the purely local SQLite setup.

Added:
- `db/schema.postgres.ts`
- `db/client.postgres.ts`
- `drizzle.config.railway.ts`
- `railway.json`

## Current reality

Dextrip is still primarily wired to:
- local SQLite in `db/client.ts`
- local drizzle config in `drizzle.config.ts`
- local background runner scripts like `scripts/local-arena-loop.ts`

So this is **not live on Railway yet**. It is the deployable DB foundation.

## Railway target shape

### Services
1. **web**
   - Next.js app
   - serves UI + API routes
2. **postgres**
   - Railway Postgres
3. **worker**
   - long-running arena / trading loop
   - should eventually run the round creation, trade placement, and settlement logic

## Required env vars
- `DATABASE_URL`
- `POLYMARKET_NETWORK`
- `POLYMARKET_FUNDER`
- `POLYMARKET_PRIVATE_KEY`
- any existing BTC price / model envs still needed by the engine

## What still has to be changed before real deployment

### 1. Runtime DB selection
Current app code imports `db/client.ts` directly in multiple places.
That means Railway would still point at SQLite unless we switch runtime imports behind a single DB adapter.

### 2. Worker separation
The local loop is built as a local script. Railway needs that split into a dedicated worker process with:
- safe startup
- restart-safe idempotency
- logging
- clock/round guards

### 3. Live/paper split persistence
Current UI live toggle is local UI state only.
Before any real live test, live-enabled strategies need server persistence in DB.

### 4. Wallet execution guardrails
Before any `$1` test:
- read wallet balance
- dry-run order payload build
- log every attempted order
- require single-order mode
- no auto-looped live execution yet

### 5. Migration + seed path
Need Railway-safe commands for:
- migrate postgres schema
- seed initial agents/strategies/settings
- optionally backfill from local SQLite

## Recommended next implementation order
1. add a single `db/index.ts` adapter that chooses sqlite or postgres by env
2. switch API routes and scripts to that adapter
3. create Railway worker entrypoint for arena loop
4. persist live toggles in DB
5. add wallet balance endpoint
6. then do one manual `$1` live trade test
