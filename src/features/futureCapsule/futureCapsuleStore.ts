/**
 * Future-self time capsule.
 *
 * The user writes a short message to themselves and pins a delivery
 * date weeks / months / a year out. The companion holds it; on the
 * scheduled day she delivers it back, framed in her own voice — "this
 * is what you wrote to yourself N days ago." A specific kind of
 * narrative artifact: the user's past self surfaces in their present
 * with the companion as the carrier.
 *
 * Manual: the runner never invents capsules. Only entries the user
 * explicitly created run. Cap is loose (200) so a year of monthly
 * capsules + occasional one-offs all fit; older delivered entries get
 * pruned first when the cap is hit.
 */

import {
  FUTURE_CAPSULE_STORE_STORAGE_KEY,
  createId,
  readJson,
  writeJson,
} from '../../lib/storage/core.ts'

export type FutureCapsuleStatus = 'pending' | 'delivered'

export interface FutureCapsuleRecord {
  id: string
  /** What the user wrote to their future self. Verbatim, not paraphrased. */
  message: string
  /** ISO timestamp the user created the capsule. */
  createdAt: string
  /**
   * ISO date (YYYY-MM-DD) the capsule should be delivered on, in the
   * user's local timezone. Stored as a date — not a precise timestamp —
   * so a "March 15" capsule lands on March 15 regardless of the hour
   * the user happens to open the app.
   */
  scheduledFor: string
  status: FutureCapsuleStatus
  /** ISO timestamp the runner moved the entry to delivered. */
  deliveredAt?: string
  /**
   * Optional title — the user's framing of what the capsule is about
   * ("after I finish the album", "one year from this Tuesday").
   */
  title?: string
}

const MAX_KEPT = 200

function isValidStatus(s: unknown): s is FutureCapsuleStatus {
  return s === 'pending' || s === 'delivered'
}

export function loadFutureCapsules(): FutureCapsuleRecord[] {
  const raw = readJson<unknown>(FUTURE_CAPSULE_STORE_STORAGE_KEY, [])
  if (!Array.isArray(raw)) return []
  const out: FutureCapsuleRecord[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    if (typeof obj.id !== 'string' || !obj.id) continue
    if (typeof obj.message !== 'string' || !obj.message) continue
    if (typeof obj.createdAt !== 'string') continue
    if (typeof obj.scheduledFor !== 'string') continue
    if (!isValidStatus(obj.status)) continue
    out.push({
      id: obj.id,
      message: obj.message,
      createdAt: obj.createdAt,
      scheduledFor: obj.scheduledFor,
      status: obj.status,
      ...(typeof obj.deliveredAt === 'string' ? { deliveredAt: obj.deliveredAt } : {}),
      ...(typeof obj.title === 'string' ? { title: obj.title } : {}),
    })
  }
  return out
}

function persist(capsules: FutureCapsuleRecord[]): void {
  // Sort: pending first (earliest scheduled at top), then delivered
  // (newest first). Pruning prefers to drop the oldest delivered ones
  // since they've already served their purpose.
  const pending = capsules.filter((c) => c.status === 'pending')
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
  const delivered = capsules.filter((c) => c.status === 'delivered')
    .sort((a, b) => (b.deliveredAt ?? '').localeCompare(a.deliveredAt ?? ''))
  const all = [...pending, ...delivered].slice(0, MAX_KEPT)
  writeJson(FUTURE_CAPSULE_STORE_STORAGE_KEY, all)
}

export interface EnqueueFutureCapsuleInput {
  message: string
  /** ISO date (YYYY-MM-DD) the capsule should be delivered. */
  scheduledFor: string
  title?: string
}

export function enqueueFutureCapsule(input: EnqueueFutureCapsuleInput): FutureCapsuleRecord | null {
  const message = input.message.trim()
  if (!message) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledFor)) return null

  // Reject capsules scheduled in the past — there's nothing to deliver.
  // Today's date is allowed; the scheduler will pick it up next tick.
  const todayLocal = formatLocalDate(new Date())
  if (input.scheduledFor < todayLocal) return null

  const capsule: FutureCapsuleRecord = {
    id: createId('capsule'),
    message,
    createdAt: new Date().toISOString(),
    scheduledFor: input.scheduledFor,
    status: 'pending',
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
  }
  persist([capsule, ...loadFutureCapsules()])
  return capsule
}

export function findDueCapsule(now: Date = new Date()): FutureCapsuleRecord | null {
  const today = formatLocalDate(now)
  return loadFutureCapsules().find(
    (c) => c.status === 'pending' && c.scheduledFor <= today,
  ) ?? null
}

export function markDelivered(id: string, now: Date = new Date()): FutureCapsuleRecord | null {
  const all = loadFutureCapsules()
  const idx = all.findIndex((c) => c.id === id)
  if (idx === -1) return null
  const updated: FutureCapsuleRecord = {
    ...all[idx],
    status: 'delivered',
    deliveredAt: now.toISOString(),
  }
  all[idx] = updated
  persist(all)
  return updated
}

export function removeFutureCapsule(id: string): boolean {
  const all = loadFutureCapsules()
  const next = all.filter((c) => c.id !== id)
  if (next.length === all.length) return false
  persist(next)
  return true
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Test-only reset. */
export function __resetFutureCapsules(): void {
  writeJson(FUTURE_CAPSULE_STORE_STORAGE_KEY, [])
}
