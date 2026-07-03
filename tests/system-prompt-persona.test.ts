import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { loadActiveProfilePersona } from '../src/features/chat/systemPromptBuilder.ts'
import type { AppSettings } from '../src/types'

function settingsWith(partial: Partial<AppSettings>): AppSettings {
  return partial as AppSettings
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: { desktopPet: {} },
    configurable: true,
    writable: true,
  })
})

test('loadActiveProfilePersona returns null when the flag is off (no IPC call)', async () => {
  let called = false
  window.desktopPet = {
    personaLoadProfile: async () => {
      called = true
      return { present: true, soul: 'x' }
    },
  } as unknown as typeof window.desktopPet

  const result = await loadActiveProfilePersona(
    settingsWith({ profilePersonaInChatEnabled: false, activeCharacterProfileId: 'card-1' }),
  )
  assert.equal(result, null)
  assert.equal(called, false)
})

test('loadActiveProfilePersona returns the active profile persona when present', async () => {
  const ids: string[] = []
  window.desktopPet = {
    personaLoadProfile: async (id: string) => {
      ids.push(id)
      return { id, present: true, soul: 'card soul' }
    },
  } as unknown as typeof window.desktopPet

  const result = await loadActiveProfilePersona(
    settingsWith({ profilePersonaInChatEnabled: true, activeCharacterProfileId: 'card-1' }),
  )
  assert.equal(result?.soul, 'card soul')
  assert.deepEqual(ids, ['card-1'])
})

test('loadActiveProfilePersona falls back to the default profile when the active one is empty', async () => {
  const ids: string[] = []
  window.desktopPet = {
    personaLoadProfile: async (id: string) => {
      ids.push(id)
      return id === 'xinghui'
        ? { id, present: true, soul: 'default soul' }
        : { id, present: false, soul: '' }
    },
  } as unknown as typeof window.desktopPet

  const result = await loadActiveProfilePersona(
    settingsWith({ profilePersonaInChatEnabled: true, activeCharacterProfileId: 'card-empty' }),
  )
  assert.equal(result?.soul, 'default soul')
  assert.deepEqual(ids, ['card-empty', 'xinghui'])
})

test('loadActiveProfilePersona returns null when nothing is present after fallback', async () => {
  window.desktopPet = {
    personaLoadProfile: async (id: string) => ({ id, present: false, soul: '' }),
  } as unknown as typeof window.desktopPet

  const result = await loadActiveProfilePersona(
    settingsWith({ profilePersonaInChatEnabled: true, activeCharacterProfileId: 'card-empty' }),
  )
  assert.equal(result, null)
})

test('loadActiveProfilePersona returns null when the bridge is unavailable', async () => {
  window.desktopPet = {} as typeof window.desktopPet
  const result = await loadActiveProfilePersona(
    settingsWith({ profilePersonaInChatEnabled: true, activeCharacterProfileId: 'card-1' }),
  )
  assert.equal(result, null)
})

test('loadActiveProfilePersona returns null and does not throw when loading fails', async () => {
  const originalWarn = console.warn
  const warnCalls: unknown[][] = []
  window.desktopPet = {
    personaLoadProfile: async () => {
      throw new Error('failed settings:apiKey token=xai-abcdefghijklmnop at /Users/klein/SOUL.md')
    },
  } as unknown as typeof window.desktopPet
  console.warn = (...args: unknown[]) => { warnCalls.push(args) }

  try {
    const result = await loadActiveProfilePersona(
      settingsWith({ profilePersonaInChatEnabled: true, activeCharacterProfileId: 'card-1' }),
    )
    assert.equal(result, null)
  } finally {
    console.warn = originalWarn
  }

  const serialized = JSON.stringify(warnCalls)
  assert.equal(warnCalls.length, 1)
  assert.match(serialized, /token=\*\*\*/)
  assert.match(serialized, /~\/SOUL\.md/)
  assert.doesNotMatch(serialized, /settings:apiKey/)
  assert.doesNotMatch(serialized, /xai-abcdefghijklmnop/)
  assert.doesNotMatch(serialized, /\/Users\/klein/)
})
