import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

register(new URL('./helpers/window-ipc-stub-hooks.mjs', import.meta.url))

const { normalizePetPrefs } = await import('../electron/services/petPrefsStore.js')
const { getPetWindowStateForEvent } = await import('../electron/petWindowInstances.js')

test('legacy freeMode in saved pet prefs is ignored and never reaches pet window state', () => {
  assert.deepEqual(normalizePetPrefs({ freeMode: true }), {})

  const state = getPetWindowStateForEvent({ sender: {} })
  assert.equal('freeMode' in state, false)
  assert.equal('roamCapable' in state, false)
  assert.equal('locomotionActivity' in state, false)
})
