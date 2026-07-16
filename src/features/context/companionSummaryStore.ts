import type { ActivityClass } from './activityClassification.ts'
import type { QuietObservationSummary } from './companionAwareness.ts'
import {
  COMPANION_CHECK_IN_REASONS,
  COMPANION_CHECK_IN_TRIGGER_REASONS,
  type CompanionCheckInDecision,
  type CompanionCheckInReason,
  type CompanionCheckInTriggerReason,
} from './companionCheckInPolicy.ts'
import {
  COMPANION_ELAPSED_BUCKETS,
  containsPreciseCompanionTimeLanguage,
  type CompanionElapsedBucket,
  formatCompanionElapsedBucket,
} from './companionTimeLanguage.ts'
import { toFiniteTimeMs } from '../../lib/time.ts'
import type { UiLanguage } from '../../types'

export const COMPANION_SUMMARY_STORAGE_KEY = 'nexus:companion-awareness:recent-summary'
export const COMPANION_CHECK_IN_DECISION_STORAGE_KEY = 'nexus:companion-awareness:recent-check-in-decision'
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

export type RecentCompanionCheckInDecision = {
  sessionId: string
  lifecycleId: string
  savedAt: string
  shouldCheckIn: boolean
  reason: CompanionCheckInReason
  surface: CompanionCheckInDecision['surface']
  priority: CompanionCheckInDecision['priority']
  signalKeyPresent: boolean
}

export const COMPANION_DISCLOSURE_CATEGORIES = {
  coarseShortLivedSummary: 'coarse_short_lived_summary',
  recentLocalCheckInDecision: 'recent_local_check_in_decision',
  sessionLifecycleExpiryMetadata: 'session_lifecycle_expiry_metadata',
} as const

export type DisclosureCategory = typeof COMPANION_DISCLOSURE_CATEGORIES[keyof typeof COMPANION_DISCLOSURE_CATEGORIES]

export const RECENT_COMPANION_CHECK_IN_DECISION_DISCLOSURE: Record<
  keyof RecentCompanionCheckInDecision,
  DisclosureCategory
> = {
  sessionId: COMPANION_DISCLOSURE_CATEGORIES.sessionLifecycleExpiryMetadata,
  lifecycleId: COMPANION_DISCLOSURE_CATEGORIES.sessionLifecycleExpiryMetadata,
  savedAt: COMPANION_DISCLOSURE_CATEGORIES.sessionLifecycleExpiryMetadata,
  shouldCheckIn: COMPANION_DISCLOSURE_CATEGORIES.recentLocalCheckInDecision,
  reason: COMPANION_DISCLOSURE_CATEGORIES.recentLocalCheckInDecision,
  surface: COMPANION_DISCLOSURE_CATEGORIES.recentLocalCheckInDecision,
  priority: COMPANION_DISCLOSURE_CATEGORIES.recentLocalCheckInDecision,
  signalKeyPresent: COMPANION_DISCLOSURE_CATEGORIES.recentLocalCheckInDecision,
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

type PersistedCheckInDecisionCache = {
  decision: RecentCompanionCheckInDecision
  loadedAtMs: number
}

let cachedRecentSummary: PersistedSummaryCache | null = null
let cachedRecentCheckInDecision: PersistedCheckInDecisionCache | null = null

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

function clearRecentCompanionCheckInDecisionCache(): void {
  cachedRecentCheckInDecision = null
}

function summariesMatch(a: RecentCompanionSummary, b: RecentCompanionSummary) {
  return a.sessionId === b.sessionId
    && a.lifecycleId === b.lifecycleId
    && a.elapsedBucket === b.elapsedBucket
    && a.elapsedLabel === b.elapsedLabel
    && a.activityClass === b.activityClass
    && a.userDeepFocused === b.userDeepFocused
}

function checkInDecisionsMatch(a: RecentCompanionCheckInDecision, b: RecentCompanionCheckInDecision) {
  return a.sessionId === b.sessionId
    && a.lifecycleId === b.lifecycleId
    && a.shouldCheckIn === b.shouldCheckIn
    && a.reason === b.reason
    && a.surface === b.surface
    && a.priority === b.priority
    && a.signalKeyPresent === b.signalKeyPresent
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

function isRecentCheckInDecisionCacheValid(
  nowMs: number,
  decision: RecentCompanionCheckInDecision,
  session: { id: string } | null,
) {
  if (!session) return false
  if (decision.sessionId !== session.id) return false
  if (decision.lifecycleId !== COMPANION_SUMMARY_LIFECYCLE_ID) return false

  const savedAtMs = toFiniteTimeMs(decision.savedAt)
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
      getStorage()?.removeItem(COMPANION_CHECK_IN_DECISION_STORAGE_KEY)
      clearRecentCompanionSummaryCache()
      clearRecentCompanionCheckInDecisionCache()
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

function normalizeRecentCompanionCheckInDecision(value: unknown): RecentCompanionCheckInDecision | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<RecentCompanionCheckInDecision>
  const sessionId = String(candidate.sessionId ?? '').trim()
  const lifecycleId = String(candidate.lifecycleId ?? '').trim()
  if (!sessionId) return null
  if (!lifecycleId) return null
  const savedAtMs = toFiniteTimeMs(candidate.savedAt)
  if (savedAtMs == null) return null
  const reason = typeof candidate.reason === 'string' ? candidate.reason : ''
  if (!COMPANION_CHECK_IN_REASONS.includes(reason as CompanionCheckInReason)) return null
  const surface = candidate.surface
  if (surface !== 'none' && surface !== 'in_app') return null
  const priority = candidate.priority
  if (priority !== 'none' && priority !== 'low' && priority !== 'normal') return null
  const shouldCheckIn = Boolean(candidate.shouldCheckIn)

  if (shouldCheckIn) {
    if (surface !== 'in_app') return null
    if (priority !== 'low' && priority !== 'normal') return null
    if (!COMPANION_CHECK_IN_TRIGGER_REASONS.includes(reason as CompanionCheckInTriggerReason)) return null
  } else if (surface !== 'none' || priority !== 'none') {
    return null
  }

  return {
    sessionId,
    lifecycleId,
    savedAt: new Date(savedAtMs).toISOString(),
    shouldCheckIn,
    reason: reason as CompanionCheckInReason,
    surface,
    priority,
    signalKeyPresent: Boolean(candidate.signalKeyPresent),
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

export function saveRecentCompanionCheckInDecision(
  decision: CompanionCheckInDecision,
  now = new Date(),
): RecentCompanionCheckInDecision | null {
  const nowMs = toFiniteTimeMs(now)
  if (nowMs == null) return null
  const savedAt = new Date(nowMs).toISOString()
  const session = getCurrentCompanionSummarySession(nowMs)
  if (!session) return null
  const recent = normalizeRecentCompanionCheckInDecision({
    sessionId: session.id,
    lifecycleId: COMPANION_SUMMARY_LIFECYCLE_ID,
    savedAt,
    shouldCheckIn: decision.shouldCheckIn,
    reason: decision.reason,
    surface: decision.surface,
    priority: decision.priority,
    signalKeyPresent: Boolean(decision.signalKeyPresent || decision.signalKey),
  })
  if (!recent) return null

  const withSavedAt: RecentCompanionCheckInDecision = {
    ...recent,
    savedAt,
  }

  const cache = cachedRecentCheckInDecision
  if (cache && checkInDecisionsMatch(cache.decision, withSavedAt)) {
    const cacheAgeMs = nowMs - cache.loadedAtMs
    if (cacheAgeMs >= 0 && cacheAgeMs < PERSIST_CACHE_TTL_MS) {
      return cache.decision
    }
  }

  try {
    getStorage()?.setItem(COMPANION_CHECK_IN_DECISION_STORAGE_KEY, JSON.stringify(withSavedAt))
    cachedRecentCheckInDecision = {
      decision: withSavedAt,
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

export function loadRecentCompanionCheckInDecision(now = new Date()): RecentCompanionCheckInDecision | null {
  try {
    const nowMs = toFiniteTimeMs(now)
    if (nowMs == null) return null
    const session = getCurrentCompanionSummarySession(nowMs)

    if (cachedRecentCheckInDecision) {
      const cache = cachedRecentCheckInDecision.decision
      const cacheAgeMs = nowMs - cachedRecentCheckInDecision.loadedAtMs
      const cacheIsFresh = cacheAgeMs >= 0 && cacheAgeMs < PERSIST_CACHE_TTL_MS
      if (session && cacheIsFresh && isRecentCheckInDecisionCacheValid(nowMs, cache, session)) {
        return cache
      }

      clearRecentCompanionCheckInDecisionCache()
    }

    const raw = getStorage()?.getItem(COMPANION_CHECK_IN_DECISION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    const normalized = normalizeRecentCompanionCheckInDecision(parsed)

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
      getStorage()?.removeItem(COMPANION_CHECK_IN_DECISION_STORAGE_KEY)
      clearRecentCompanionCheckInDecisionCache()
      return null
    }

    cachedRecentCheckInDecision = {
      decision: normalized,
      loadedAtMs: nowMs,
    }
    return normalized
  } catch {
    try {
      getStorage()?.removeItem(COMPANION_CHECK_IN_DECISION_STORAGE_KEY)
      clearRecentCompanionCheckInDecisionCache()
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

export function clearRecentCompanionCheckInDecision(): void {
  try {
    getStorage()?.removeItem(COMPANION_CHECK_IN_DECISION_STORAGE_KEY)
    clearRecentCompanionCheckInDecisionCache()
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

export function recentCompanionCheckInDecisionToDecision(
  decision: RecentCompanionCheckInDecision | null,
): CompanionCheckInDecision | null {
  if (!decision) return null
  return {
    shouldCheckIn: decision.shouldCheckIn,
    reason: decision.reason,
    surface: decision.surface,
    priority: decision.priority,
    signalKeyPresent: decision.signalKeyPresent,
  }
}
