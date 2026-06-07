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

function hasChanged(normalized: unknown, raw: unknown): boolean {
  return JSON.stringify(normalized) !== JSON.stringify(raw)
}

export function normalizeOnThisDayLedger(raw: unknown, nowMs: number = Date.now()): Ledger {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const next: Ledger = {}
  for (const [rawId, rawTs] of Object.entries(raw as Record<string, unknown>)) {
    const id = rawId.trim()
    if (!id || (typeof rawTs !== 'string' && typeof rawTs !== 'number')) continue
    const fired = typeof rawTs === 'number' ? rawTs : Date.parse(rawTs)
    if (!Number.isFinite(fired)) continue
    if (fired <= nowMs && nowMs - fired < LEDGER_RETENTION_MS) {
      next[id] = new Date(fired).toISOString()
    }
  }
  return next
}

export function loadOnThisDayLedger(nowMs: number = Date.now()): Ledger {
  const raw = readJson<unknown>(MEMORY_ON_THIS_DAY_FIRED_STORAGE_KEY, {})
  const normalized = normalizeOnThisDayLedger(raw, nowMs)
  if (hasChanged(normalized, raw)) {
    writeJson(MEMORY_ON_THIS_DAY_FIRED_STORAGE_KEY, normalized)
  }
  return normalized
}

export function recordOnThisDayFired(
  memoryId: string,
  nowIso: string = new Date().toISOString(),
): void {
  const id = memoryId.trim()
  if (!id) return
  const nowMs = Date.parse(nowIso)
  if (!Number.isFinite(nowMs)) return
  const ledger = loadOnThisDayLedger(nowMs)
  ledger[id] = new Date(nowMs).toISOString()
  writeJson(MEMORY_ON_THIS_DAY_FIRED_STORAGE_KEY, ledger)
}

/** Test-only reset. Production code never calls this. */
export function __resetOnThisDayLedger(): void {
  writeJson(MEMORY_ON_THIS_DAY_FIRED_STORAGE_KEY, {})
}
