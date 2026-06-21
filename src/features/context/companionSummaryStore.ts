import type { ActivityClass } from './activityClassification.ts'
import type { QuietObservationSummary } from './companionAwareness.ts'
import {
  COMPANION_ELAPSED_BUCKETS,
  containsPreciseCompanionTimeLanguage,
  type CompanionElapsedBucket,
} from './companionTimeLanguage.ts'

export const COMPANION_SUMMARY_STORAGE_KEY = 'nexus:companion-awareness:recent-summary'
const COMPANION_SUMMARY_SESSION_KEY = 'nexus:companion-awareness:session-id'
const COMPANION_SUMMARY_SESSION_STARTED_AT_KEY = 'nexus:companion-awareness:session-started-at'
const COMPANION_SUMMARY_MAX_AGE_MS = 24 * 60 * 60_000
const CLOCK_SKEW_TOLERANCE_MS = 60_000

export type RecentCompanionSummary = {
  sessionId: string
  lifecycleId: string
  savedAt: string
  elapsedBucket: CompanionElapsedBucket
  elapsedLabel: string
  activityClass: ActivityClass
  userDeepFocused: boolean
}

const ACTIVITY_CLASSES: ActivityClass[] = [
  'coding',
  'browsing',
  'media',
  'gaming',
  'communication',
  'documents',
  'unknown',
]

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    return null
  }
  return null
}

function getSessionStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage
    if (typeof sessionStorage !== 'undefined') return sessionStorage
  } catch {
    return null
  }
  return null
}

function createSessionId(): string {
  try {
    const random = globalThis.crypto?.randomUUID?.()
    if (random) return random
  } catch {
    // Fall through to timestamp fallback.
  }
  return `session-${Date.now().toString(36)}`
}

const COMPANION_SUMMARY_LIFECYCLE_ID = createSessionId()

function toFiniteTimeMs(value: string | number | Date | null | undefined): number | null {
  if (value == null) return null
  const ms = value instanceof Date ? value.getTime()
    : typeof value === 'number' ? value
    : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function getCurrentCompanionSummarySession(now: Date): { id: string, startedAtMs: number } | null {
  const storage = getSessionStorage()
  if (!storage) return null
  try {
    const existingId = storage.getItem(COMPANION_SUMMARY_SESSION_KEY)
    const existingStartedAtMs = toFiniteTimeMs(storage.getItem(COMPANION_SUMMARY_SESSION_STARTED_AT_KEY))
    if (existingId && existingStartedAtMs != null) {
      return { id: existingId, startedAtMs: existingStartedAtMs }
    }
    const next = createSessionId()
    const startedAt = now.toISOString()
    storage.setItem(COMPANION_SUMMARY_SESSION_KEY, next)
    storage.setItem(COMPANION_SUMMARY_SESSION_STARTED_AT_KEY, startedAt)
    return { id: next, startedAtMs: now.getTime() }
  } catch {
    try {
      getStorage()?.removeItem(COMPANION_SUMMARY_STORAGE_KEY)
    } catch {
      // Best-effort local cleanup only.
    }
    return null
  }
}

function normalizeRecentCompanionSummary(value: unknown): RecentCompanionSummary | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<RecentCompanionSummary>
  const sessionId = String(candidate.sessionId ?? '').trim()
  const lifecycleId = String(candidate.lifecycleId ?? '').trim()
  if (!sessionId) return null
  if (!lifecycleId) return null
  if (!candidate.savedAt || Number.isNaN(Date.parse(candidate.savedAt))) return null
  if (!candidate.elapsedBucket || !COMPANION_ELAPSED_BUCKETS.includes(candidate.elapsedBucket)) return null
  if (!candidate.activityClass || !ACTIVITY_CLASSES.includes(candidate.activityClass)) return null
  const elapsedLabel = String(candidate.elapsedLabel ?? '').trim()
  if (!elapsedLabel) return null
  if (containsPreciseCompanionTimeLanguage(elapsedLabel)) return null

  return {
    sessionId,
    lifecycleId,
    savedAt: new Date(candidate.savedAt).toISOString(),
    elapsedBucket: candidate.elapsedBucket,
    elapsedLabel,
    activityClass: candidate.activityClass,
    userDeepFocused: Boolean(candidate.userDeepFocused),
  }
}

export function saveRecentCompanionSummary(summary: QuietObservationSummary, now = new Date()): RecentCompanionSummary | null {
  const session = getCurrentCompanionSummarySession(now)
  if (!session) return null
  const recent = normalizeRecentCompanionSummary({
    sessionId: session.id,
    lifecycleId: COMPANION_SUMMARY_LIFECYCLE_ID,
    savedAt: now.toISOString(),
    elapsedBucket: summary.elapsedBucket,
    elapsedLabel: summary.elapsedLabel,
    activityClass: summary.activityClass,
    userDeepFocused: summary.userDeepFocused,
  })
  if (!recent) return null

  try {
    getStorage()?.setItem(COMPANION_SUMMARY_STORAGE_KEY, JSON.stringify(recent))
    return recent
  } catch {
    return null
  }
}

export function loadRecentCompanionSummary(now = new Date()): RecentCompanionSummary | null {
  try {
    const raw = getStorage()?.getItem(COMPANION_SUMMARY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    const normalized = normalizeRecentCompanionSummary(parsed)
    const session = getCurrentCompanionSummarySession(now)
    const savedAtMs = toFiniteTimeMs(normalized?.savedAt)
    const tooOld = savedAtMs == null || now.getTime() - savedAtMs > COMPANION_SUMMARY_MAX_AGE_MS
    const beforeSession = !session
      || savedAtMs == null
      || savedAtMs < session.startedAtMs - CLOCK_SKEW_TOLERANCE_MS
    const fromFuture = savedAtMs == null
      || savedAtMs > now.getTime() + CLOCK_SKEW_TOLERANCE_MS
    if (
      !normalized
      || !session
      || normalized.sessionId !== session.id
      || normalized.lifecycleId !== COMPANION_SUMMARY_LIFECYCLE_ID
      || tooOld
      || beforeSession
      || fromFuture
    ) {
      getStorage()?.removeItem(COMPANION_SUMMARY_STORAGE_KEY)
      return null
    }
    return normalized
  } catch {
    try {
      getStorage()?.removeItem(COMPANION_SUMMARY_STORAGE_KEY)
    } catch {
      // Best-effort local cleanup only.
    }
    return null
  }
}

export function clearRecentCompanionSummary(): void {
  try {
    getStorage()?.removeItem(COMPANION_SUMMARY_STORAGE_KEY)
  } catch {
    // Best-effort local cleanup only.
  }
}

export function recentCompanionSummaryToQuietObservation(
  summary: RecentCompanionSummary | null,
): QuietObservationSummary | null {
  if (!summary) return null
  return {
    elapsedBucket: summary.elapsedBucket,
    elapsedLabel: summary.elapsedLabel,
    activityClass: summary.activityClass,
    userDeepFocused: summary.userDeepFocused,
    activeElsewhere: true,
    shouldStaySilent: true,
  }
}
