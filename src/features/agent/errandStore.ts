/**
 * Background errand queue.
 *
 * The user explicitly hands the companion a task to run "later, on her
 * own time" — typically queued during the day, executed overnight while
 * the user sleeps, surfaced at the morning bracket the next day.
 *
 * Lifecycle:
 *   queued    – user just added it; runner hasn't picked it up
 *   running   – runner is actively driving an agentLoop for this errand
 *   completed – agentLoop returned successfully; result stored
 *   failed    – agentLoop threw or aborted (token budget, timeout, error)
 *   delivered – the morning bracket has surfaced this entry to the user;
 *               kept around briefly for UI history but no longer active
 *
 * Manual approval is intentional: only entries the user explicitly added
 * run. The runner never invents tasks. This caps the worst-case token
 * spend at "what the user was willing to wait overnight for" instead of
 * "whatever the AI thinks is interesting at 3am."
 */

import {
  ERRAND_STORE_STORAGE_KEY,
  readJson,
  writeJson,
  createId,
} from '../../lib/storage'

export type ErrandStatus = 'queued' | 'running' | 'completed' | 'failed' | 'delivered'

export interface ErrandRecord {
  id: string
  /** What the user asked her to look into. Verbatim, not paraphrased. */
  prompt: string
  status: ErrandStatus
  /** ISO timestamp when the user added the errand. */
  createdAt: string
  /** ISO timestamp when the runner moved it to `running`, if ever. */
  startedAt?: string
  /** ISO timestamp when the runner moved it to `completed` or `failed`. */
  completedAt?: string
  /** ISO timestamp when the morning bracket surfaced this errand. */
  deliveredAt?: string
  /** Final summary text, available once status is `completed`. */
  result?: string
  /** Failure reason, populated when status is `failed`. */
  error?: string
  /**
   * How many agentLoop iterations were spent. Stored so the runner can
   * enforce a global iteration budget across the night.
   */
  iterationsUsed?: number
}

const MAX_KEPT = 50

export function loadErrands(): ErrandRecord[] {
  const raw = readJson<unknown>(ERRAND_STORE_STORAGE_KEY, [])
  if (!Array.isArray(raw)) return []
  const out: ErrandRecord[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    if (typeof obj.id !== 'string' || !obj.id) continue
    if (typeof obj.prompt !== 'string' || !obj.prompt) continue
    if (typeof obj.status !== 'string') continue
    if (!['queued', 'running', 'completed', 'failed', 'delivered'].includes(obj.status)) continue
    if (typeof obj.createdAt !== 'string') continue
    out.push({
      id: obj.id,
      prompt: obj.prompt,
      status: obj.status as ErrandStatus,
      createdAt: obj.createdAt,
      ...(typeof obj.startedAt === 'string' ? { startedAt: obj.startedAt } : {}),
      ...(typeof obj.completedAt === 'string' ? { completedAt: obj.completedAt } : {}),
      ...(typeof obj.deliveredAt === 'string' ? { deliveredAt: obj.deliveredAt } : {}),
      ...(typeof obj.result === 'string' ? { result: obj.result } : {}),
      ...(typeof obj.error === 'string' ? { error: obj.error } : {}),
      ...(typeof obj.iterationsUsed === 'number' ? { iterationsUsed: obj.iterationsUsed } : {}),
    })
  }
  return out
}

function persist(errands: ErrandRecord[]): void {
  // Newest first, capped. delivered/completed/failed older than the cap
  // get dropped; queued/running entries are never automatically dropped
  // because losing them would surprise the user.
  const sorted = [...errands].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  writeJson(ERRAND_STORE_STORAGE_KEY, sorted.slice(0, MAX_KEPT))
}

export function enqueueErrand(prompt: string): ErrandRecord | null {
  const trimmed = prompt.trim()
  if (!trimmed) return null
  const errand: ErrandRecord = {
    id: createId('errand'),
    prompt: trimmed,
    status: 'queued',
    createdAt: new Date().toISOString(),
  }
  persist([errand, ...loadErrands()])
  return errand
}

/**
 * Apply a partial update to an errand identified by id and persist.
 * Returns the updated record or null when the id wasn't found.
 */
export function updateErrand(id: string, patch: Partial<ErrandRecord>): ErrandRecord | null {
  const all = loadErrands()
  const idx = all.findIndex((e) => e.id === id)
  if (idx === -1) return null
  const next: ErrandRecord = { ...all[idx], ...patch, id: all[idx].id, createdAt: all[idx].createdAt }
  all[idx] = next
  persist(all)
  return next
}

export function removeErrand(id: string): boolean {
  const all = loadErrands()
  const next = all.filter((e) => e.id !== id)
  if (next.length === all.length) return false
  persist(next)
  return true
}

export function findRunnableErrand(): ErrandRecord | null {
  return loadErrands().find((e) => e.status === 'queued') ?? null
}

export function findUndeliveredErrands(): ErrandRecord[] {
  return loadErrands().filter((e) => e.status === 'completed')
}

export function markDelivered(id: string): ErrandRecord | null {
  return updateErrand(id, {
    status: 'delivered',
    deliveredAt: new Date().toISOString(),
  })
}

/** Test-only reset. Production code never calls this. */
export function __resetErrands(): void {
  writeJson(ERRAND_STORE_STORAGE_KEY, [])
}
