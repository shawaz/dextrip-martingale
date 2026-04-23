# Dextrip Arena, local-first architecture

## Goal
Use a local SQLite database as the source of truth for the battle engine, then sync curated records to Appwrite for the UI and remote visibility.

## Why
Appwrite is good for presentation and sync, but it has already created schema friction for real-time trading state. The local database should own the core battle state.

## Ownership model

### Local SQLite, source of truth
Owns:
- agents
- rounds
- trades
- strategies
- leaderboard calculations
- promotion decisions
- overnight bot output

### Appwrite, sync target
Owns:
- mirrored records for UI
- optional realtime subscriptions
- remote read access
- snapshots of the current arena state

## Battle flow
1. Bot fetches BTC market data.
2. Bot evaluates strategy cards.
3. Bot writes agent decisions and round state to local SQLite.
4. Bot resolves outcomes and recalculates rankings locally.
5. Sync worker upserts the current local state into Appwrite.
6. Frontend reads from Appwrite or later from local API routes.

## Local schema

### agents
- id
- name
- initials
- color
- timeframe
- preferred_strategy
- promoted
- is_active
- won
- loss
- win_rate
- created_at
- updated_at

### strategies
- id
- name
- score
- report
- when_to_use
- weakness
- improve_note
- created_at
- updated_at

### agent_strategy_cards
- id
- agent_id
- strategy_id
- priority

### rounds
- id
- round_id
- asset
- timeframe
- start_time
- end_time
- entry_price
- exit_price
- status
- created_at
- updated_at

### trades
- id
- agent_id
- round_id
- strategy_id
- signal
- confidence
- strategy_score
- report
- entry_price
- exit_price
- result
- created_at
- updated_at

## Sync rules to Appwrite

### agents collection
Mirror:
- name
- init
- color
- timeframe
- promoted
- isActive
- won
- loss
- winRate
- strategyCards

### rounds collection
Mirror:
- roundId
- asset
- timeframe
- startTime
- endTime
- entryPrice
- exitPrice
- status

### trades collection
Mirror:
- agentId
- roundId
- strategyName
- signal
- entry
- exit
- result

### strategies collection
Mirror:
- name
- description
- score
- report
- whenToUse
- weakness
- improve

## Recommended project structure
- drizzle.config.ts
- db/
  - client.ts
  - schema.ts
  - seed.ts
  - queries.ts
- lib/trading/
  - engine.ts
  - sync-appwrite.ts
  - strategies.ts
- scripts/
  - db-push.ts
  - db-seed.ts
  - sync-appwrite.ts

## Execution order
1. Install Drizzle and SQLite dependencies.
2. Create local schema.
3. Migrate and seed the local DB.
4. Write bot output into local DB.
5. Add Appwrite sync worker.
6. Switch UI data source as needed.

## Blunt recommendation
Do not let Appwrite become the trading engine database.
Use it as a mirror only.
