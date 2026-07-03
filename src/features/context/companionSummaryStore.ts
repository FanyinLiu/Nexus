import type { ActivityClass } from './activityClassification.ts'
import type { QuietObservationSummary } from './companionAwareness.ts'
import {
  COMPANION_ELAPSED_BUCKETS,
  containsPreciseCompanionTimeLanguage,
  type CompanionElapsedBucket,
  formatCompanionElapsedBucket,
} from './companionTimeLanguage.ts'
import { toFiniteTimeMs } from '../../lib/time.ts'
import type { UiLanguage } from '../../types'

export const COMPANION_SUMMARY_STORAGE_KEY = 'nexus:companion-awareness:recent-summary'
const COMPANION_SUMMARY_SESSION_KEY = 'nexus:companion-awareness:session-id'
const COMPANION_SUMMARY_SESSION_STARTED_AT_KEY = 'nexus:companion-awareness:session-started-at'
const COMPANION_SUMMARY_MAX_AGE_MS = 24 * 60 * 60_000
const CLOCK_SKEW_TOLERANCE_MS = 60_000
const PERSIST_CACHE_TTL_MS = 2_000

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

type PersistedSummaryCache = {
  summary: RecentCompanionSummary
  loadedAtMs: number
}

let cachedRecentSummary: PersistedSummaryCache | null = null

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

function clearRecentCompanionSummaryCache(): void {
  cachedRecentSummary = null
}

function summariesMatch(a: RecentCompanionSummary, b: RecentCompanionSummary) {
  return a.sessionId === b.sessionId
    && a.lifecycleId === b.lifecycleId
    && a.elapsedBucket === b.elapsedBucket
    && a.elapsedLabel === b.elapsedLabel
    && a.activityClass === b.activityClass
    && a.userDeepFocused === b.userDeepFocused
}

function isRecentSummaryCacheValid(
  nowMs: number,
  summary: RecentCompanionSummary,
  session: { id: string } | null,
) {
  if (!session) return false
  if (summary.sessionId !== session.id) return false
  if (summary.lifecycleId !== COMPANION_SUMMARY_LIFECYCLE_ID) return false

  const savedAtMs = toFiniteTimeMs(summary.savedAt)
  if (savedAtMs == null) return false
  const tooOld = nowMs - savedAtMs > COMPANION_SUMMARY_MAX_AGE_MS
  const fromFuture = savedAtMs > nowMs + CLOCK_SKEW_TOLERANCE_MS
  return !tooOld && !fromFuture
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

function getCurrentCompanionSummarySession(nowMs: number): { id: string, startedAtMs: number } | null {
  const storage = getSessionStorage()
  if (!storage) return null
  try {
    const existingId = storage.getItem(COMPANION_SUMMARY_SESSION_KEY)
    const existingStartedAtMs = toFiniteTimeMs(storage.getItem(COMPANION_SUMMARY_SESSION_STARTED_AT_KEY))
    if (existingId && existingStartedAtMs != null) {
      return { id: existingId, startedAtMs: existingStartedAtMs }
    }
    const next = createSessionId()
    const startedAt = new Date(nowMs).toISOString()
    storage.setItem(COMPANION_SUMMARY_SESSION_KEY, next)
    storage.setItem(COMPANION_SUMMARY_SESSION_STARTED_AT_KEY, startedAt)
    return { id: next, startedAtMs: nowMs }
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
  const savedAtMs = toFiniteTimeMs(candidate.savedAt)
  if (savedAtMs == null) return null
  if (!candidate.elapsedBucket || !COMPANION_ELAPSED_BUCKETS.includes(candidate.elapsedBucket)) return null
  if (!candidate.activityClass || !ACTIVITY_CLASSES.includes(candidate.activityClass)) return null
  const elapsedLabel = String(candidate.elapsedLabel ?? '').trim()
  if (!elapsedLabel) return null
  if (containsPreciseCompanionTimeLanguage(elapsedLabel)) return null

  return {
    sessionId,
    lifecycleId,
    savedAt: new Date(savedAtMs).toISOString(),
    elapsedBucket: candidate.elapsedBucket,
    elapsedLabel,
    activityClass: candidate.activityClass,
    userDeepFocused: Boolean(candidate.userDeepFocused),
  }
}

export function saveRecentCompanionSummary(summary: QuietObservationSummary, now = new Date()): RecentCompanionSummary | null {
  const nowMs = toFiniteTimeMs(now)
  if (nowMs == null) return null
  const savedAt = new Date(nowMs).toISOString()
  const session = getCurrentCompanionSummarySession(nowMs)
  if (!session) return null
  const recent = normalizeRecentCompanionSummary({
    sessionId: session.id,
    lifecycleId: COMPANION_SUMMARY_LIFECYCLE_ID,
    savedAt,
    elapsedBucket: summary.elapsedBucket,
    elapsedLabel: summary.elapsedLabel,
    activityClass: summary.activityClass,
    userDeepFocused: summary.userDeepFocused,
  })
  if (!recent) return null

  const withSavedAt: RecentCompanionSummary = {
    ...recent,
    savedAt,
  }

  const cache = cachedRecentSummary
  if (cache && summariesMatch(cache.summary, withSavedAt)) {
    const cacheAgeMs = nowMs - cache.loadedAtMs
    if (cacheAgeMs >= 0 && cacheAgeMs < PERSIST_CACHE_TTL_MS) {
      return cache.summary
    }
  }

  try {
    getStorage()?.setItem(COMPANION_SUMMARY_STORAGE_KEY, JSON.stringify(withSavedAt))
    cachedRecentSummary = {
      summary: withSavedAt,
      loadedAtMs: nowMs,
    }
    return withSavedAt
  } catch {
    return null
  }
}

export function loadRecentCompanionSummary(now = new Date()): RecentCompanionSummary | null {
  try {
    const nowMs = toFiniteTimeMs(now)
    if (nowMs == null) return null
    const session = getCurrentCompanionSummarySession(nowMs)

    if (cachedRecentSummary) {
      const cache = cachedRecentSummary.summary
      const cacheAgeMs = nowMs - cachedRecentSummary.loadedAtMs
      const cacheIsFresh = cacheAgeMs >= 0 && cacheAgeMs < PERSIST_CACHE_TTL_MS
      if (session && cacheIsFresh && isRecentSummaryCacheValid(nowMs, cache, session)) {
        return cache
      }

      clearRecentCompanionSummaryCache()
    }

    const raw = getStorage()?.getItem(COMPANION_SUMMARY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    const normalized = normalizeRecentCompanionSummary(parsed)

    const savedAtMs = toFiniteTimeMs(normalized?.savedAt)
    const tooOld = savedAtMs == null || nowMs - savedAtMs > COMPANION_SUMMARY_MAX_AGE_MS
    const beforeSession = !session
      || savedAtMs == null
      || savedAtMs < session.startedAtMs - CLOCK_SKEW_TOLERANCE_MS
    const fromFuture = savedAtMs == null
      || savedAtMs > nowMs + CLOCK_SKEW_TOLERANCE_MS
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
      clearRecentCompanionSummaryCache()
      return null
    }

    cachedRecentSummary = {
      summary: normalized,
      loadedAtMs: nowMs,
    }
    return normalized
  } catch {
    try {
      getStorage()?.removeItem(COMPANION_SUMMARY_STORAGE_KEY)
      clearRecentCompanionSummaryCache()
    } catch {
      // Best-effort local cleanup only.
    }
    return null
  }
}

export function clearRecentCompanionSummary(): void {
  try {
    getStorage()?.removeItem(COMPANION_SUMMARY_STORAGE_KEY)
    clearRecentCompanionSummaryCache()
  } catch {
    // Best-effort local cleanup only.
  }
}

export function recentCompanionSummaryToQuietObservation(
  summary: RecentCompanionSummary | null,
  uiLanguage: UiLanguage = 'en-US',
): QuietObservationSummary | null {
  if (!summary) return null
  return {
    elapsedBucket: summary.elapsedBucket,
    elapsedLabel: formatCompanionElapsedBucket(summary.elapsedBucket, uiLanguage),
    activityClass: summary.activityClass,
    userDeepFocused: summary.userDeepFocused,
    activeElsewhere: true,
    shouldStaySilent: true,
  }
}
