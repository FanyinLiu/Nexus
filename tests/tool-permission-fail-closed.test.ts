import assert from 'node:assert/strict'
import { test } from 'node:test'

import { confirmBuiltInToolExecution } from '../src/features/tools/permissions.ts'

const WEATHER_TOOL = { id: 'weather', location: 'Seattle' } as const
const CONFIRM_POLICY = { enabled: true, requiresConfirmation: true }

function installWindow(value: Record<string, unknown>): void {
  Object.defineProperty(globalThis, 'window', {
    value,
    configurable: true,
    writable: true,
  })
}

test('confirmBuiltInToolExecution denies when no confirmation channel exists', async () => {
  installWindow({})

  const allowed = await confirmBuiltInToolExecution(WEATHER_TOOL, CONFIRM_POLICY)

  assert.equal(allowed, false)
})

test('confirmBuiltInToolExecution denies when the bridge has no dialog and the window has no confirm', async () => {
  installWindow({ desktopPet: { openExternalLink: async () => true } })

  const allowed = await confirmBuiltInToolExecution(WEATHER_TOOL, CONFIRM_POLICY)

  assert.equal(allowed, false)
})

test('confirmBuiltInToolExecution denies when the bridge dialog fails and no other channel exists', async () => {
  installWindow({
    desktopPet: {
      showConfirmDialog: async () => {
        throw new Error('dialog unavailable')
      },
    },
  })

  const allowed = await confirmBuiltInToolExecution(WEATHER_TOOL, CONFIRM_POLICY)

  assert.equal(allowed, false)
})

test('confirmBuiltInToolExecution follows the bridge dialog answer', async () => {
  const asked: string[] = []
  installWindow({
    desktopPet: {
      showConfirmDialog: async (message: string) => {
        asked.push(message)
        return true
      },
    },
  })

  assert.equal(await confirmBuiltInToolExecution(WEATHER_TOOL, CONFIRM_POLICY), true)
  assert.equal(asked.length, 1)

  installWindow({ desktopPet: { showConfirmDialog: async () => false } })

  assert.equal(await confirmBuiltInToolExecution(WEATHER_TOOL, CONFIRM_POLICY), false)
})

test('confirmBuiltInToolExecution follows the window confirm answer', async () => {
  installWindow({ confirm: () => true })
  assert.equal(await confirmBuiltInToolExecution(WEATHER_TOOL, CONFIRM_POLICY), true)

  installWindow({ confirm: () => false })
  assert.equal(await confirmBuiltInToolExecution(WEATHER_TOOL, CONFIRM_POLICY), false)
})

test('a tool that needs no confirmation runs without any channel', async () => {
  installWindow({})

  const allowed = await confirmBuiltInToolExecution(WEATHER_TOOL, { enabled: true, requiresConfirmation: false })

  assert.equal(allowed, true)
})
