/**
 * Settings — batch load with in-memory caching.
 * Replaces 12+ individual DB queries per request with a single query.
 */

import { eq } from "drizzle-orm";
import { db, settings } from "@/db/index";

// In-memory cache with TTL
let cache: Map<string, number> | null = null;
let cacheAt = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

async function loadAllSettings(): Promise<Map<string, number>> {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache;

  const rows = await db().select().from(settings);
  const map = new Map<string, number>();
  for (const row of rows) {
    const val = Number(row.value);
    if (!Number.isNaN(val)) map.set(row.key, val);
  }
  cache = map;
  cacheAt = now;
  return map;
}

export function clearSettingsCache() {
  cache = null;
  cacheAt = 0;
}

/** Get a single setting value. */
export async function getSetting(
  key: string,
  fallback: number,
): Promise<number> {
  try {
    const map = await loadAllSettings();
    return map.get(key) ?? fallback;
  } catch (e) {
    console.error(`[core/settings] getSetting(${key}) failed:`, e);
    return fallback;
  }
}

/** Convenience: load everything once and pass the map around. */
export async function getSettingsMap(): Promise<Map<string, number>> {
  return loadAllSettings();
}

// Common setting keys
const KEY_TARGET = "martingale_target_profit";
const KEY_MULTIPLIER = "martingale_multiplier";
const KEY_STEPS = "martingale_ladder_steps";
const KEY_TREND_THRESHOLD = "trend_strength_threshold";

export async function getTargetProfit(): Promise<number> {
  return getSetting(KEY_TARGET, 5);
}
export async function getMultiplier(): Promise<number> {
  return getSetting(KEY_MULTIPLIER, 3);
}
export async function getLadderSteps(): Promise<number> {
  return getSetting(KEY_STEPS, 8);
}
export async function getTrendStrengthThreshold(): Promise<number> {
  return getSetting(KEY_TREND_THRESHOLD, 8);
}

export async function saveSetting(key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  await db()
    .insert(settings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: now },
    });
  clearSettingsCache();
}

/** Per-agent override: check settings map for agent-specific key. */
export function perAgentVal(
  map: Map<string, number>,
  agentId: string,
  key: string,
  fallback: number,
): number {
  return map.get(`${key}_${agentId}`) ?? fallback;
}
