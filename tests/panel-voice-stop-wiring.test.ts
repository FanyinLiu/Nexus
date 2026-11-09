import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import type { AppSettings } from '../src/types/index.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { useAppOverlays } = await import('../src/app/controllers/useAppOverlays.ts')
const { createHookRenderer, createOverlayProps } = await import('./helpers/wakewordHarness.ts')

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
  removeItem(key: string) { this.data.delete(key) }
  clear() { this.data.clear() }
}

test('the panel stop-voice wiring uses the button path, not a bare interrupt', () => {
  const localStorage = new MemoryStorage()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      localStorage,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      addEventListener: () => undefined,
    },
  })

  const calls = { stopVoice: 0, interrupt: 0, stopAll: 0 }
  const baseline = createOverlayProps('panel', {
    uiLanguage: 'en-US',
    speechOutputEnabled: false,
    speechInputEnabled: false,
  } as AppSettings)
  const props = {
    ...baseline,
    voice: {
      ...baseline.voice,
      stopVoiceConversation: () => { calls.stopVoice += 1 },
      speechStop: {
        interrupt: () => { calls.interrupt += 1 },
        stopAll: () => { calls.stopAll += 1 },
        stopAllLocally: () => { calls.stopAll += 1 },
      },
    },
  }
  const overlays: { current: ReturnType<typeof useAppOverlays>['overlays'] | null } = { current: null }
  const renderer = createHookRenderer(() => {
    overlays.current = useAppOverlays(props).overlays
  })
  try {
    renderer.render()
    assert.ok(overlays.current, 'the panel overlay did not render')
    overlays.current.settingsDrawerProps.onStopVoiceConversation()

    assert.equal(calls.stopVoice, 1, 'the panel keeps the button/session path')
    assert.equal(calls.interrupt, 0, 'a bare interrupt would lose the user-button origin')
    assert.equal(calls.stopAll, 0)
  } finally {
    renderer.unmount()
  }
})
