/**
 * Pending-callback queue.
 *
 * The dream cycle (memoryDream + reflectionGenerator) is the only writer:
 * after generating reflections it picks 0–N memory ids worth resurfacing
 * "in the next conversation or two" and pushes them here. The chat layer
 * consumes them when it builds the next system prompt — embedding the
 * memory text as a soft hint and asking the LLM to use `[recall:<id>]`
 * inline if it chooses to weave the memory into the reply.
 *
 * Once an id is consumed (LLM emitted the recall tag) we remove it.
 * Stale entries past TTL drop on every read so a long-idle queue can't
 * resurface week-old "hey did you ever pick a gift?" awkwardness.
 *
 * Pure store: read / write only, no scoring. Selection happens in
 * reflectionGenerator.selectCallbackCandidates so it stays testable.
 */

import {
  MEMORY_CALLBACK_QUEUE_STORAGE_KEY,
  readJson,
  writeJson,
} from '../../lib/storage/core.ts'

export interface PendingCallback {
  /** Memory id the LLM should consider referencing. */
  memoryId: string
  /** ISO timestamp of when this candidate was queued. */
  queuedAt: string
  /** ISO timestamp of when this candidate becomes stale. */
  expiresAt: string
}

const MAX_PENDING = 3

function isLive(entry: PendingCallback, nowMs: number): boolean {
  const expiresMs = Date.parse(entry.expiresAt)
  if (!Number.isFinite(expiresMs)) return false
  return expiresMs > nowMs
}

export function loadCallbackQueue(): PendingCallback[] {
  const raw = readJson<unknown>(MEMORY_CALLBACK_QUEUE_STORAGE_KEY, [])
  if (!Array.isArray(raw)) {
    persist([])
    return []
  }
  const nowMs = Date.now()
  const valid: PendingCallback[] = []
  const seenMemoryIds = new Set<string>()
  let dirty = raw.length > MAX_PENDING
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      dirty = true
      continue
    }
    const obj = item as Record<string, unknown>
    if (typeof obj.memoryId !== 'string' || !obj.memoryId) {
      dirty = true
      continue
    }
    if (typeof obj.queuedAt !== 'string') {
      dirty = true
      continue
    }
    if (typeof obj.expiresAt !== 'string') {
      dirty = true
      continue
    }
    const entry: PendingCallback = {
      memoryId: obj.memoryId,
      queuedAt: obj.queuedAt,
      expiresAt: obj.expiresAt,
    }
    if (seenMemoryIds.has(entry.memoryId)) {
      dirty = true
      continue
    }
    seenMemoryIds.add(entry.memoryId)
    if (isLive(entry, nowMs)) {
      valid.push(entry)
    } else {
      dirty = true
    }
  }
  const compacted = valid.slice(0, MAX_PENDING)
  if (dirty || compacted.length !== raw.length) {
    persist(compacted)
  }
  return compacted
}

function persist(queue: PendingCallback[]): void {
  writeJson(MEMORY_CALLBACK_QUEUE_STORAGE_KEY, queue.slice(0, MAX_PENDING))
}

/**
 * Merge new candidate ids into the queue. Existing entries with the same
 * memoryId are NOT duplicated — the original queuedAt wins so a memory
 * that's been waiting longer keeps its priority.
 */
export function enqueueCallbacks(
  newIds: string[],
  ttlMs: number,
  nowIso: string = new Date().toISOString(),
): void {
  if (newIds.length === 0) return
  const existing = loadCallbackQueue()
  const known = new Set(existing.map((e) => e.memoryId))
  const expiresAt = new Date(Date.parse(nowIso) + ttlMs).toISOString()
  const additions: PendingCallback[] = []
  for (const id of newIds) {
    if (known.has(id)) continue
    additions.push({ memoryId: id, queuedAt: nowIso, expiresAt })
    known.add(id)
  }
  if (additions.length === 0) return
  // Newer additions sort to the back; oldest-first so consumeOne picks
  // the longest-pending candidate first.
  persist([...existing, ...additions])
}

/**
 * Remove a memory id from the queue. Called when the LLM emits
 * `[recall:<id>]` so the same callback isn't re-suggested next turn.
 */
export function consumeCallback(memoryId: string): void {
  const existing = loadCallbackQueue()
  const next = existing.filter((entry) => entry.memoryId !== memoryId)
  if (next.length === existing.length) return
  persist(next)
}

/**
 * Clear all pending callbacks. Used when the user resets state or the
 * persona changes.
 */
export function clearCallbackQueue(): void {
  persist([])
}
