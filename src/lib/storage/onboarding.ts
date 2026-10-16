import {
  normalizeGuideDeferral,
  nextGuideDeferral,
  withGuideReshown,
  type GuideDeferral,
} from '../../features/onboarding/guideDeferral.ts'
import { isObject } from '../guards.ts'
import {
  CHAT_STORAGE_KEY,
  DAILY_MEMORY_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
  ONBOARDING_STORAGE_KEY,
  readJson,
  SETTINGS_STORAGE_KEY,
  writeJson,
} from './core.ts'

export type OnboardingState = {
  completedAt: string
  firstConversationAt?: string
  firstConversationElapsedMs?: number
}

let lastMirroredOnboardingState: string | null = null

export function normalizeOnboardingState(raw: unknown): OnboardingState | null {
  if (!isObject(raw)) return null
  if (typeof raw.completedAt !== 'string' && typeof raw.completedAt !== 'number') {
    return null
  }
  const parsed = typeof raw.completedAt === 'number'
    ? raw.completedAt
    : Date.parse(raw.completedAt)
  if (!Number.isFinite(parsed)) return null

  const normalized: OnboardingState = {
    completedAt: new Date(parsed).toISOString(),
  }

  const firstConversationRaw = raw.firstConversationAt
  const firstConversationParsed = typeof firstConversationRaw === 'string' || typeof firstConversationRaw === 'number'
    ? (typeof firstConversationRaw === 'number' ? firstConversationRaw : Date.parse(firstConversationRaw))
    : NaN
  if (Number.isFinite(firstConversationParsed) && firstConversationParsed >= parsed) {
    normalized.firstConversationAt = new Date(firstConversationParsed).toISOString()
    normalized.firstConversationElapsedMs = Math.round(firstConversationParsed - parsed)
  }

  return normalized
}

function readOnboardingRaw(): unknown {
  return readJson<unknown>(ONBOARDING_STORAGE_KEY, null)
}

function composeOnboardingRecord(
  completion: OnboardingState | null,
  deferral: GuideDeferral | null,
  inProgress: boolean,
): Record<string, unknown> | null {
  if (!completion && !deferral && !inProgress) return null
  return {
    ...(completion ? {
      completedAt: completion.completedAt,
      ...(completion.firstConversationAt ? {
        firstConversationAt: completion.firstConversationAt,
        firstConversationElapsedMs: completion.firstConversationElapsedMs,
      } : {}),
    } : {}),
    ...(inProgress && !completion ? { status: 'in-progress' } : {}),
    ...(deferral ? {
      guideDismissedAt: deferral.dismissedAt,
      guideDismissCount: deferral.dismissCount,
      ...(deferral.reshownAt ? { guideReshownAt: deferral.reshownAt } : {}),
    } : {}),
  }
}

function writeOnboardingRecord(
  completion: OnboardingState | null,
  deferral: GuideDeferral | null,
  inProgress: boolean,
) {
  const payload = composeOnboardingRecord(completion, deferral, inProgress)
  if (!payload) {
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY)
    mirrorOnboardingState(null)
    return
  }
  writeJson(ONBOARDING_STORAGE_KEY, payload)
  if (completion) mirrorOnboardingState(completion)
}

function mirrorOnboardingState(state: OnboardingState | null) {
  if (typeof window === 'undefined') return
  const bridge = window.desktopPet?.localDataMirrorOnboarding
  if (typeof bridge !== 'function') return

  const payload = state ? { state } : {}
  const mirrorKey = JSON.stringify(payload)
  if (lastMirroredOnboardingState === mirrorKey) return
  lastMirroredOnboardingState = mirrorKey

  void bridge(payload).catch(() => {
    if (lastMirroredOnboardingState === mirrorKey) {
      lastMirroredOnboardingState = null
    }
  })
}

/**
 * Saved settings from a half-finished guide. The legacy backfill below treats
 * any settings blob as an upgrade that already finished setup. This marker
 * keeps a language pick from being read that way.
 */
function isOnboardingInProgressRecord(raw: unknown): boolean {
  return isObject(raw) && raw.status === 'in-progress' && typeof raw.completedAt === 'undefined'
}

export function loadOnboardingState() {
  if (typeof window === 'undefined' || !window.localStorage) return null

  const stored = readOnboardingRaw()
  const normalized = normalizeOnboardingState(stored)
  const deferral = normalizeGuideDeferral(stored)
  const inProgress = isOnboardingInProgressRecord(stored)
  if (!normalized && !deferral && !inProgress) {
    if (stored !== null) {
      window.localStorage.removeItem(ONBOARDING_STORAGE_KEY)
      mirrorOnboardingState(null)
    }
    return null
  }

  const payload = composeOnboardingRecord(normalized, deferral, inProgress)
  if (JSON.stringify(payload) !== JSON.stringify(stored)) {
    writeJson(ONBOARDING_STORAGE_KEY, payload)
  }
  if (normalized) mirrorOnboardingState(normalized)
  return normalized
}

/** Dismissal stored beside completion. A dismissal alone does not finish setup. */
export function loadGuideDeferral(): GuideDeferral | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  return normalizeGuideDeferral(readOnboardingRaw())
}

/**
 * Record "Maybe later" without finishing setup.
 * The first dismissal still allows one later launch to show the guide.
 */
export function recordGuideDismiss(dismissedAt = new Date()): GuideDeferral | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  if (loadOnboardingCompleted()) return loadGuideDeferral()

  const stored = readOnboardingRaw()
  const next = nextGuideDeferral(normalizeGuideDeferral(stored), dismissedAt.toISOString())
  writeOnboardingRecord(
    normalizeOnboardingState(stored),
    next,
    isOnboardingInProgressRecord(stored),
  )
  return next
}

/** Remember that the one later showing has already happened. */
export function markGuideReshown(reshownAt = new Date()): GuideDeferral | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  const stored = readOnboardingRaw()
  const current = normalizeGuideDeferral(stored)
  if (!current) return null
  const next = withGuideReshown(current, reshownAt.toISOString())
  if (next === current) return current
  writeOnboardingRecord(
    normalizeOnboardingState(stored),
    next,
    isOnboardingInProgressRecord(stored),
  )
  return next
}

/**
 * Remember that setup is still open so a mid-guide settings write does not
 * count as a finished upgrade.
 */
export function markOnboardingInProgress() {
  if (typeof window === 'undefined' || !window.localStorage) return
  const stored = readOnboardingRaw()
  if (normalizeOnboardingState(stored) || isOnboardingInProgressRecord(stored)) return
  writeOnboardingRecord(null, normalizeGuideDeferral(stored), true)
}

export function loadOnboardingCompleted() {
  if (loadOnboardingState()) {
    return true
  }

  const stored = readJson<unknown>(ONBOARDING_STORAGE_KEY, null)
  if (isOnboardingInProgressRecord(stored)) return false

  // Backfill: any pre-existing user data implies onboarding was already done in
  // an older build that didn't yet record the flag explicitly.
  return Boolean(
    window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    || window.localStorage.getItem(CHAT_STORAGE_KEY)
    || window.localStorage.getItem(MEMORY_STORAGE_KEY)
    || window.localStorage.getItem(DAILY_MEMORY_STORAGE_KEY),
  )
}

export function saveOnboardingCompleted(completed = true, completedAt = new Date()) {
  if (!completed) {
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY)
    mirrorOnboardingState(null)
    return
  }

  const current = loadOnboardingState()
  const next = current ?? {
    completedAt: completedAt.toISOString(),
  }
  writeJson(ONBOARDING_STORAGE_KEY, next)
  mirrorOnboardingState(next)
}

export function markOnboardingFirstConversationCompleted(firstConversationAt = new Date()) {
  const current = loadOnboardingState()
  if (!current || current.firstConversationAt) {
    return current ? { state: current, recorded: false } : null
  }

  const completedMs = Date.parse(current.completedAt)
  const firstConversationMs = firstConversationAt.getTime()
  const state: OnboardingState = {
    ...current,
    firstConversationAt: firstConversationAt.toISOString(),
    firstConversationElapsedMs: Math.max(0, Math.round(firstConversationMs - completedMs)),
  }
  writeJson(ONBOARDING_STORAGE_KEY, state)
  mirrorOnboardingState(state)

  return {
    state,
    recorded: true,
  }
}
