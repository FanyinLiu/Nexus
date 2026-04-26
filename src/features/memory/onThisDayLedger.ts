/**
 * Lifetime dedup ledger for on-this-day callbacks.
 *
 * A given memory should only ever fire its anniversary once — a year
 * later, a half-year later, etc. — not every day for the +/- tolerance
 * window. We keep a tiny `Record<memoryId, lastFiredISO>` in storage
 * so the consumer can skip already-used ids.
 *
 * The map self-prunes on read: entries older than the longest window
 * (year + tolerance + a generous buffer) are dropped, since their
 * memory will not anniversary again for another year and resurrecting
 * it then is fine.
 */

import {
  MEMORY_ON_THIS_DAY_FIRED_STORAGE_KEY,
  readJson,
  writeJson,
} from '../../lib/storage/core.ts'

interface Ledger {
  [memoryId: string]: string
}

const LEDGER_RETENTION_MS = 400 * 24 * 60 * 60 * 1000  // ~13 months — longer than the year window

function pruneStale(ledger: Ledger, nowMs: number): Ledger {
  const next: Ledger = {}
  for (const [id, ts] of Object.entries(ledger)) {
    const fired = Date.parse(ts)
    if (!Number.isFinite(fired)) continue
    if (nowMs - fired < LEDGER_RETENTION_MS) {
      next[id] = ts
    }
  }
  return next
}

export function loadOnThisDayLedger(nowMs: number = Date.now()): Ledger {
  const raw = readJson<unknown>(MEMORY_ON_THIS_DAY_FIRED_STORAGE_KEY, {})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const safe: Ledger = {}
  for (const [id, ts] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id === 'string' && id && typeof ts === 'string' && ts) {
      safe[id] = ts
    }
  }
  return pruneStale(safe, nowMs)
}

export function recordOnThisDayFired(
  memoryId: string,
  nowIso: string = new Date().toISOString(),
): void {
  const nowMs = Date.parse(nowIso)
  const ledger = loadOnThisDayLedger(Number.isFinite(nowMs) ? nowMs : Date.now())
  ledger[memoryId] = nowIso
  writeJson(MEMORY_ON_THIS_DAY_FIRED_STORAGE_KEY, ledger)
}

/** Test-only reset. Production code never calls this. */
export function __resetOnThisDayLedger(): void {
  writeJson(MEMORY_ON_THIS_DAY_FIRED_STORAGE_KEY, {})
}
