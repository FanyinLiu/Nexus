import {
  CHAT_STORAGE_KEY,
  DAILY_MEMORY_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
  ONBOARDING_STORAGE_KEY,
  readJson,
  SETTINGS_STORAGE_KEY,
  writeJson,
} from './core.ts'

type OnboardingState = {
  completedAt: string
}

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
  return { completedAt: new Date(parsed).toISOString() }
}

export function loadOnboardingCompleted() {
  const stored = readJson<unknown>(ONBOARDING_STORAGE_KEY, null)
  const normalized = normalizeOnboardingState(stored)
  if (normalized) {
    if (JSON.stringify(normalized) !== JSON.stringify(stored)) {
      writeJson(ONBOARDING_STORAGE_KEY, normalized)
    }
    return true
  }
  if (stored !== null) {
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY)
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

export function saveOnboardingCompleted(completed = true) {
  if (!completed) {
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY)
    return
  }

  writeJson(ONBOARDING_STORAGE_KEY, {
    completedAt: new Date().toISOString(),
  })
}
