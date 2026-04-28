/**
 * Open-arc thread store.
 *
 * The user opens a "thread" for something that won't resolve in one
 * sitting — a stressful 1:1, an upcoming flight, a friendship that's
 * gone quiet. The companion holds the thread for a few days and
 * follows up at preset intervals (default day 3 + day 5). Day 7 with
 * no resolution → graceful drop, not a guilt trip.
 *
 * Manual contract: the runner never opens an arc on its own. Only
 * threads the user explicitly created run. Same shape as errands and
 * future capsules — proactive features in this codebase all opt in.
 *
 * The point isn't todo tracking. It's narrative continuity: most
 * companions forget what you said yesterday; this one carries one or
 * two threads at a time so the relationship feels temporally coherent.
 */

import {
  OPEN_ARC_STORE_STORAGE_KEY,
  createId,
  readJson,
  writeJson,
} from '../../lib/storage/core.ts'

export type OpenArcStatus = 'open' | 'resolved' | 'dropped'

export interface OpenArcRecord {
  id: string
  /**
   * Short human-readable framing of what the thread is about, in the
   * user's words. ("manager 1:1 friday", "talking to mom about the move")
   */
  theme: string
  /** ISO timestamp the user opened the arc. */
  startedAt: string
  /**
   * Day-offsets from `startedAt` when a check-in should fire. Default
   * `[3, 5]` — two light pings, no nagging. Day 7 with status still
   * 'open' triggers an auto-drop.
   */
  checkInDays: number[]
  status: OpenArcStatus
  /**
   * ISO timestamps for each check-in the runner has fired. Length =
   * how many pings the user has already received.
   */
  checkInsFired: string[]
  /** ISO timestamp set when the user closes the arc. */
  resolvedAt?: string
  /** Optional user note left when closing — what actually happened. */
  closingNote?: string
  /** Optional dropped-at marker for arcs that timed out. */
  droppedAt?: string
}

const MAX_KEPT = 200
const AUTO_DROP_DAYS = 7

function isValidStatus(s: unknown): s is OpenArcStatus {
  return s === 'open' || s === 'resolved' || s === 'dropped'
}

export function loadOpenArcs(): OpenArcRecord[] {
  const raw = readJson<unknown>(OPEN_ARC_STORE_STORAGE_KEY, [])
  if (!Array.isArray(raw)) return []
  const out: OpenArcRecord[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    if (typeof obj.id !== 'string' || !obj.id) continue
    if (typeof obj.theme !== 'string' || !obj.theme) continue
    if (typeof obj.startedAt !== 'string') continue
    if (!isValidStatus(obj.status)) continue
    const checkInDays = Array.isArray(obj.checkInDays)
      ? obj.checkInDays.filter((d): d is number => typeof d === 'number' && Number.isFinite(d) && d > 0)
      : [3, 5]
    const checkInsFired = Array.isArray(obj.checkInsFired)
      ? obj.checkInsFired.filter((t): t is string => typeof t === 'string')
      : []
    out.push({
      id: obj.id,
      theme: obj.theme,
      startedAt: obj.startedAt,
      checkInDays,
      status: obj.status,
      checkInsFired,
      ...(typeof obj.resolvedAt === 'string' ? { resolvedAt: obj.resolvedAt } : {}),
      ...(typeof obj.closingNote === 'string' ? { closingNote: obj.closingNote } : {}),
      ...(typeof obj.droppedAt === 'string' ? { droppedAt: obj.droppedAt } : {}),
    })
  }
  return out
}

function persist(arcs: OpenArcRecord[]): void {
  // Sort: open first (oldest at top so check-ins prefer older threads),
  // then resolved/dropped (newest closed at top). Pruning prefers to drop
  // the oldest closed entries.
  const open = arcs.filter((a) => a.status === 'open')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const closed = arcs.filter((a) => a.status !== 'open')
    .sort((a, b) => {
      const aTs = a.resolvedAt ?? a.droppedAt ?? a.startedAt
      const bTs = b.resolvedAt ?? b.droppedAt ?? b.startedAt
      return bTs.localeCompare(aTs)
    })
  const all = [...open, ...closed].slice(0, MAX_KEPT)
  writeJson(OPEN_ARC_STORE_STORAGE_KEY, all)
}

export interface OpenArcInput {
  theme: string
  /** Optional override; defaults to [3, 5]. */
  checkInDays?: number[]
}

export function openArc(input: OpenArcInput, now: Date = new Date()): OpenArcRecord | null {
  const theme = input.theme.trim()
  if (!theme) return null
  const checkInDays = input.checkInDays?.length
    ? input.checkInDays.filter((d) => Number.isFinite(d) && d > 0).sort((a, b) => a - b)
    : [3, 5]
  const arc: OpenArcRecord = {
    id: createId('arc'),
    theme,
    startedAt: now.toISOString(),
    checkInDays,
    status: 'open',
    checkInsFired: [],
  }
  persist([arc, ...loadOpenArcs()])
  return arc
}

export function resolveArc(
  id: string,
  closingNote?: string,
  now: Date = new Date(),
): OpenArcRecord | null {
  const all = loadOpenArcs()
  const idx = all.findIndex((a) => a.id === id)
  if (idx === -1) return null
  const updated: OpenArcRecord = {
    ...all[idx],
    status: 'resolved',
    resolvedAt: now.toISOString(),
    ...(closingNote?.trim() ? { closingNote: closingNote.trim() } : {}),
  }
  all[idx] = updated
  persist(all)
  return updated
}

export function dropArc(id: string, now: Date = new Date()): OpenArcRecord | null {
  const all = loadOpenArcs()
  const idx = all.findIndex((a) => a.id === id)
  if (idx === -1) return null
  const updated: OpenArcRecord = {
    ...all[idx],
    status: 'dropped',
    droppedAt: now.toISOString(),
  }
  all[idx] = updated
  persist(all)
  return updated
}

export function recordCheckInFired(id: string, now: Date = new Date()): OpenArcRecord | null {
  const all = loadOpenArcs()
  const idx = all.findIndex((a) => a.id === id)
  if (idx === -1) return null
  const target = all[idx]
  const updated: OpenArcRecord = {
    ...target,
    checkInsFired: [...target.checkInsFired, now.toISOString()],
  }
  all[idx] = updated
  persist(all)
  return updated
}

export function removeArc(id: string): boolean {
  const all = loadOpenArcs()
  const next = all.filter((a) => a.id !== id)
  if (next.length === all.length) return false
  persist(next)
  return true
}

/**
 * Auto-close any arc that's been open longer than AUTO_DROP_DAYS. Runs
 * idempotently — the scheduler calls it on each tick. Returns the list
 * of arcs that were just dropped (for telemetry / future logging).
 */
export function autoDropExpiredArcs(now: Date = new Date()): OpenArcRecord[] {
  const all = loadOpenArcs()
  const cutoff = now.getTime() - AUTO_DROP_DAYS * 24 * 60 * 60 * 1000
  const dropped: OpenArcRecord[] = []
  let changed = false
  for (let i = 0; i < all.length; i += 1) {
    const a = all[i]
    if (a.status !== 'open') continue
    const startedMs = Date.parse(a.startedAt)
    if (Number.isFinite(startedMs) && startedMs < cutoff) {
      const updated: OpenArcRecord = {
        ...a,
        status: 'dropped',
        droppedAt: now.toISOString(),
      }
      all[i] = updated
      dropped.push(updated)
      changed = true
    }
  }
  if (changed) persist(all)
  return dropped
}

/** Test-only reset. */
export function __resetOpenArcs(): void {
  writeJson(OPEN_ARC_STORE_STORAGE_KEY, [])
}
