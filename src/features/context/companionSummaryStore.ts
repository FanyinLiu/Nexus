import type { ActivityClass } from './activityClassification.ts'
import type { CompanionElapsedBucket, QuietObservationSummary } from './companionAwareness.ts'

export const COMPANION_SUMMARY_STORAGE_KEY = 'nexus:companion-awareness:recent-summary'

export type RecentCompanionSummary = {
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

const ELAPSED_BUCKETS: CompanionElapsedBucket[] = [
  'just_started',
  'a_while',
  'about_half_hour',
  'about_hour',
  'two_hours_or_more',
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

function normalizeRecentCompanionSummary(value: unknown): RecentCompanionSummary | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<RecentCompanionSummary>
  if (!candidate.savedAt || Number.isNaN(Date.parse(candidate.savedAt))) return null
  if (!candidate.elapsedBucket || !ELAPSED_BUCKETS.includes(candidate.elapsedBucket)) return null
  if (!candidate.activityClass || !ACTIVITY_CLASSES.includes(candidate.activityClass)) return null
  const elapsedLabel = String(candidate.elapsedLabel ?? '').trim()
  if (!elapsedLabel) return null

  return {
    savedAt: new Date(candidate.savedAt).toISOString(),
    elapsedBucket: candidate.elapsedBucket,
    elapsedLabel,
    activityClass: candidate.activityClass,
    userDeepFocused: Boolean(candidate.userDeepFocused),
  }
}

export function saveRecentCompanionSummary(summary: QuietObservationSummary, now = new Date()): RecentCompanionSummary | null {
  const recent = normalizeRecentCompanionSummary({
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

export function loadRecentCompanionSummary(): RecentCompanionSummary | null {
  try {
    const raw = getStorage()?.getItem(COMPANION_SUMMARY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    const normalized = normalizeRecentCompanionSummary(parsed)
    if (!normalized) {
      getStorage()?.removeItem(COMPANION_SUMMARY_STORAGE_KEY)
    }
    return normalized
  } catch {
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
