# Dextrip Martingale — Code Optimization Plan

**Date:** 2026-05-11  
**Goal:** Eliminate duplication, improve performance, reduce maintenance burden. No feature changes — pure refactor.

---

## Root Problems Identified

### 1. Massive Code Duplication (4 copies of the same logic)

| File | Lines | Role |
|---|---|---|
| `app/api/btc-5m/route.ts` | 568 | Dashboard API + strategy engine |
| `scripts/paper-trading-bot.ts` | 445 | Paper trading loop |
| `worker.js` | 246 | Railway worker (CommonJS) |
| `martingale_executor.py` | 184 | Live executor (Python) |

All four contain their own copy of: RSI calculation, setting retrieval, round creation, streak signal logic, ladder building, trade resolution, and Binance price fetching.

### 2. Unused/Dead Code

`lib/trading/local-selection.ts` (348 lines) — a sophisticated multi-strategy scoring engine with market fit bonuses, agent preference bonuses, mentor adjustments, volatility penalties, regime penalties, etc. Imported by both `route.ts` and `paper-trading-bot.ts` but **never actually called** in the martingale flow. The agents just use fixed triggers (always/streak/RSI). Dead weight.

### 3. N+1 Query Problems

- API route queries all agents, then for each agent calls `replayStreakMachine` which re-fetches trades individually
- Paper bot calls `getAgentState` per agent — each triggers a separate DB query
- Settings are read individually instead of batched

### 4. No Shared Core Logic

There is no single module for:
- BTC price fetching (Binance)
- RSI computation
- Streak signal detection
- Round lifecycle (create → resolve)
- Agent state machine
- Polymarket outcome resolution

Every file reinvents these.

---

## Plan

### Phase 1: Extract shared core library (~2 hours)

Create a single source of truth for all duplicated logic:

```
lib/core/
  rsi.ts            — single calculateRsi(), RSI signal (over/under)
  price.ts          — fetchBtcPrice(), fetchKlines()
  settings.ts       — getSetting(), getTargetProfit(), getMultiplier(), getLadderSteps(), batch load with cache
  rounds.ts         — createRound(), resolveRound(), getClosedRounds(), getOpenRounds()
  trades.ts         — createTrade(), resolveTrade(), getAgentTrades(), getPendingTrades()
  streak.ts         — getStreakSignal(), all streak agent definitions
  agents.ts         — seedAgents(), getAgentConfig(), agent state computation
  polymarket.ts     — fetchOutcome(), getMarketTokens(), resolveFromPolymarket (merge with existing)
  types.ts          — shared types (MarketState, StreakState, etc.)
```

**Key principle:** Each module exports pure functions that take a `db` instance as parameter — no hidden globals, fully testable.

### Phase 2: Rewrite key files to use core library (~3 hours)

**`app/api/btc-5m/route.ts`** — shrink from 568 → ~200 lines
- Delegate to core modules for all computation
- Only handle HTTP concerns: request parsing, response formatting, SSE triggers
- Remove: seedAgents, RSI calc, streak signals, round resolution, wallet balance, market state fallback (use core)

**`scripts/paper-trading-bot.ts`** — shrink from 445 → ~200 lines
- Same core modules
- Only handle: loop timing, health check server, periodic summary
- Remove: RSI calc (x2), settings loading (x2 agent logic copies), round creation/resolution

**Delete `worker.js`** — replaced by `scripts/paper-trading-bot.ts` running via Bun
- If Railway needs Node.js, compile the paper bot to run as a single worker
- Remove CommonJS require() chain and execSync blocking calls

**`martingale_executor.py`** — simplify from 184 → ~100 lines
- Keep the Polymarket order execution (requires Python's py_clob_client)
- Remove duplicated round calculation, streak logic
- Poll a lightweight endpoint instead of the full `/api/btc-5m`

### Phase 3: Performance optimizations (~2 hours)

1. **Batch agent queries**: Instead of N individual `getAgentTrades()` calls, query all trades once grouped by agent:
   ```sql
   SELECT * FROM trades WHERE strategy_id = 'streak-5m' AND created_at > $cutoff
   ORDER BY agent_id, created_at DESC
   ```
   Then group in-memory with `Map<agentId, Trade[]>`. Cuts 6 queries → 1.

2. **Settings cache**: Load all settings once into a `Map<string, number>` and pass it through. Currently each `getSetting()` call hits the DB individually. The API route reads settings 12+ times per request.

3. **Wallet balance cache**: Don't hit Polymarket CLOB API on every dashboard refresh. Cache for 30 seconds. The balance doesn't change mid-request.

4. **Single Binance call**: `buildMarketState` already fetches 1m klines. Use the last candle's close as the BTC price instead of making a second `ticker/price` call.

5. **Remove `local-selection.ts` and all imports of it** from the martingale codebase (archive or move to a separate branch if it's for future use). It adds ~350 lines of dead code that gets imported on every request.

### Phase 4: Architectural simplification (~1 hour)

1. **Single executor**: Currently there's `paper-trading-bot.ts` (via Bun), `worker.js` (via Node on Railway), and `martingale_executor.py` (Python). Consolidate to:
   - **Paper mode**: `scripts/paper-trading-bot.ts` (runs the loop, logs to DB)
   - **Live mode**: A single background job that reads pending trades from DB and executes via Polymarket API — could be a cron endpoint or the same bot with a flag

2. **Lightweight trade API**: Create `app/api/btc-5m/recommended` that returns ONLY the recommended trades array (no dashboard stats, no UI data). The Python executor currently calls the full `/api/btc-5m` which computes 400+ lines of UI data just to get 6 trade recommendations.

3. **Move SSE to separate endpoint** (already exists at `/api/btc-5m/stream` but is tied to the main route). The stream endpoint should use its own lightweight data path.

---

## Files to Change

| File | Action |
|---|---|
| `lib/core/rsi.ts` | **NEW** — single RSI implementation |
| `lib/core/price.ts` | **NEW** — Binance price/klines fetching |
| `lib/core/settings.ts` | **NEW** — settings with batch load + cache |
| `lib/core/rounds.ts` | **NEW** — round CRUD + resolution |
| `lib/core/trades.ts` | **NEW** — trade CRUD + resolution |
| `lib/core/streak.ts` | **NEW** — streak signals + agent definitions |
| `lib/core/agents.ts` | **NEW** — agent seeding + state |
| `lib/core/types.ts` | **NEW** — shared types |
| `app/api/btc-5m/route.ts` | **REWRITE** — delegate to core, HTTP only |
| `app/api/btc-5m/recommended/route.ts` | **NEW** — lightweight trade recommendations |
| `scripts/paper-trading-bot.ts` | **REWRITE** — use core library |
| `martingale_executor.py` | **SIMPLIFY** — poll lightweight endpoint |
| `worker.js` | **DELETE** — replaced by paper bot |
| `lib/trading/local-selection.ts` | **ARCHIVE** — dead code in martingale flow |
| `lib/trading/streak-machine.ts` | **MERGE** into `lib/core/streak.ts` |
| `lib/trading/polymarket.ts` | **MERGE** into `lib/core/polymarket.ts` |
| `lib/trading/market-data.ts` | **MERGE** into `lib/core/price.ts` |
| `db/index.ts` | **FIX** — remove type casts, use proper Drizzle types |

---

## Risks & Mitigations

- **Risk**: Refactoring introduces bugs in live trading logic  
  **Mitigation**: Run paper bot in parallel (old + new) for 24 hours, compare trade output
- **Risk**: Performance regression from new abstraction layers  
  **Mitigation**: Benchmark API response time before/after. The batch queries alone should make it faster.
- **Risk**: `worker.js` deletion breaks Railway deployment  
  **Mitigation**: Deploy `paper-trading-bot.ts` compiled to JS as the Railway worker first, verify, then remove

---

## New Requirements (2026-05-11)

### A. Polymarket Share Price Filter (< $0.50)
Before creating or executing ANY trade, check the current Polymarket share price for the target outcome:
- Fetch the market's order book or mid-price for the specific direction (UP/DOWN token)
- If price >= $0.50 → **SKIP** — don't create the trade, log reason
- This applies to BOTH paper and live modes so paper stats reflect real-world executability
- Add a `priceAtSignal` field to the trades table to record the price that was checked

### B. Live Polymarket Trade Execution
When an agent has `isLive: true`:
1. Create the trade in DB as `tradeMode: "live"`, `orderStatus: "pending"`
2. Immediately place a market buy order on Polymarket CLOB via `py_clob_client` 
3. Store the Polymarket order ID in `externalOrderId`
4. Update `orderStatus` to "submitted" on success, "failed" on error
5. Send Telegram notification on execution
6. The resolve step checks Polymarket for outcome (already partially implemented)

**Execution flow:**
```
Trade created → Check price < $0.50 → 
  Paper: just log to DB
  Live:  log to DB + place_order() → store orderId → notify
```

---

## Validation Checklist

- [ ] `npm run typecheck` passes
- [ ] Paper bot creates identical trades to old version (parallel run for 2 hours)
- [ ] API route `/api/btc-5m` returns identical JSON structure
- [ ] SSE stream still works
- [ ] Live/paper toggle still functions
- [ ] Per-agent settings (target/multiplier/steps) still respected
- [ ] Dashboard renders without errors
- [ ] Polymarket share price check blocks trades >= $0.50
- [ ] Live trades execute real Polymarket orders and store order IDs
- [ ] Failed live orders are logged and don't crash the bot
- [ ] No `require()` or `child_process.execSync` in new code

---

## Order of Execution

1. Create `lib/core/` modules (no side effects, just extraction)
2. Rewrite `route.ts` to use core (confirm dashboard works)
3. Rewrite `paper-trading-bot.ts` to use core (parallel test)
4. Simplify `martingale_executor.py`
5. Delete `worker.js`
6. Remove `local-selection.ts` and dead imports
7. Add lightweight `/recommended` endpoint
8. Validate and ship
