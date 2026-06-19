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

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

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

export function loadOnboardingState() {
  if (typeof window === 'undefined' || !window.localStorage) return null

  const stored = readJson<unknown>(ONBOARDING_STORAGE_KEY, null)
  const normalized = normalizeOnboardingState(stored)
  if (normalized) {
    if (JSON.stringify(normalized) !== JSON.stringify(stored)) {
      writeJson(ONBOARDING_STORAGE_KEY, normalized)
    }
    mirrorOnboardingState(normalized)
    return normalized
  }
  if (stored !== null) {
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY)
    mirrorOnboardingState(null)
  }

  return null
}

export function loadOnboardingCompleted() {
  if (loadOnboardingState()) {
    return true
  }

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
