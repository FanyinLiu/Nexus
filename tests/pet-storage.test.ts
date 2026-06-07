import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  loadPetRuntimeState,
  loadPetWindowPreferences,
  normalizePetRuntimeState,
  normalizePetWindowPreferences,
  savePetRuntimeState,
  savePetWindowPreferences,
} from '../src/lib/storage/pet.ts'
import {
  PET_RUNTIME_STORAGE_KEY,
  PET_WINDOW_PREFERENCES_STORAGE_KEY,
} from '../src/lib/storage/core.ts'

function createLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

function installStorage(initial: Record<string, string> = {}) {
  const localStorage = createLocalStorageMock(initial)
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })
  return localStorage
}

test('normalizePetWindowPreferences falls back per malformed boolean field', () => {
  assert.deepEqual(normalizePetWindowPreferences({
    isPinned: false,
    clickThrough: 'yes',
    extra: true,
  }), {
    isPinned: false,
    clickThrough: false,
  })
  assert.deepEqual(normalizePetWindowPreferences(null), {
    isPinned: true,
    clickThrough: false,
  })
})

test('loadPetWindowPreferences compacts malformed preferences and writes back', () => {
  const storage = installStorage({
    [PET_WINDOW_PREFERENCES_STORAGE_KEY]: JSON.stringify({
      isPinned: 'bad',
      clickThrough: true,
      extra: 'drop',
    }),
  })

  const preferences = loadPetWindowPreferences()

  assert.deepEqual(preferences, {
    isPinned: true,
    clickThrough: true,
  })
  assert.deepEqual(JSON.parse(storage.getItem(PET_WINDOW_PREFERENCES_STORAGE_KEY) ?? '{}'), preferences)
})

test('normalizePetRuntimeState accepts known moods and falls back for unknown mood', () => {
  assert.deepEqual(normalizePetRuntimeState({ mood: 'playful', extra: true }), { mood: 'playful' })
  assert.deepEqual(normalizePetRuntimeState({ mood: 'unknown' }), { mood: 'idle' })
  assert.deepEqual(normalizePetRuntimeState(null), { mood: 'idle' })
})

test('loadPetRuntimeState compacts malformed runtime state and writes back', () => {
  const storage = installStorage({
    [PET_RUNTIME_STORAGE_KEY]: JSON.stringify({ mood: 'angry', extra: 'drop' }),
  })

  const state = loadPetRuntimeState()

  assert.deepEqual(state, { mood: 'idle' })
  assert.deepEqual(JSON.parse(storage.getItem(PET_RUNTIME_STORAGE_KEY) ?? '{}'), state)
})

test('savePetWindowPreferences and savePetRuntimeState normalize before persisting', () => {
  const storage = installStorage()

  savePetWindowPreferences({ isPinned: false, clickThrough: true })
  savePetRuntimeState({ mood: 'curious' })

  assert.deepEqual(JSON.parse(storage.getItem(PET_WINDOW_PREFERENCES_STORAGE_KEY) ?? '{}'), {
    isPinned: false,
    clickThrough: true,
  })
  assert.deepEqual(JSON.parse(storage.getItem(PET_RUNTIME_STORAGE_KEY) ?? '{}'), {
    mood: 'curious',
  })
})
