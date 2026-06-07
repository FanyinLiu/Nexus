import type { PetMood, PetWindowPreferences } from '../../types'
import {
  PET_RUNTIME_STORAGE_KEY,
  PET_WINDOW_PREFERENCES_STORAGE_KEY,
  readJson,
  writeJson,
} from './core.ts'

type PetRuntimeState = {
  mood: PetMood
}

const defaultPetWindowPreferences: PetWindowPreferences = {
  isPinned: true,
  clickThrough: false,
}

const defaultPetRuntimeState: PetRuntimeState = {
  mood: 'idle',
}

const VALID_PET_MOODS = new Set<PetMood>([
  'idle',
  'thinking',
  'happy',
  'sleepy',
  'surprised',
  'confused',
  'embarrassed',
  'excited',
  'affectionate',
  'proud',
  'curious',
  'worried',
  'playful',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizePetWindowPreferences(raw: unknown): PetWindowPreferences {
  if (!isObject(raw)) return defaultPetWindowPreferences
  return {
    isPinned: typeof raw.isPinned === 'boolean'
      ? raw.isPinned
      : defaultPetWindowPreferences.isPinned,
    clickThrough: typeof raw.clickThrough === 'boolean'
      ? raw.clickThrough
      : defaultPetWindowPreferences.clickThrough,
  }
}

function normalizePetMood(value: unknown): PetMood {
  return typeof value === 'string' && VALID_PET_MOODS.has(value as PetMood)
    ? value as PetMood
    : defaultPetRuntimeState.mood
}

export function normalizePetRuntimeState(raw: unknown): PetRuntimeState {
  if (!isObject(raw)) return defaultPetRuntimeState
  return {
    mood: normalizePetMood(raw.mood),
  }
}

export function loadPetWindowPreferences(): PetWindowPreferences {
  const raw = readJson<unknown>(PET_WINDOW_PREFERENCES_STORAGE_KEY, {})
  const normalized = normalizePetWindowPreferences(raw)
  if (JSON.stringify(normalized) !== JSON.stringify(raw)) {
    writeJson(PET_WINDOW_PREFERENCES_STORAGE_KEY, normalized)
  }
  return normalized
}

export function savePetWindowPreferences(preferences: PetWindowPreferences) {
  writeJson(PET_WINDOW_PREFERENCES_STORAGE_KEY, normalizePetWindowPreferences(preferences))
}

export function loadPetRuntimeState(): PetRuntimeState {
  const raw = readJson<unknown>(PET_RUNTIME_STORAGE_KEY, {})
  const normalized = normalizePetRuntimeState(raw)
  if (JSON.stringify(normalized) !== JSON.stringify(raw)) {
    writeJson(PET_RUNTIME_STORAGE_KEY, normalized)
  }
  return normalized
}

export function savePetRuntimeState(state: PetRuntimeState) {
  writeJson(PET_RUNTIME_STORAGE_KEY, normalizePetRuntimeState(state))
}
