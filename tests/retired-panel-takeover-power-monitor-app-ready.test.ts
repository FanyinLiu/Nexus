import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

import {
  setAppReady,
  windowLifecycleState,
} from './helpers/window-lifecycle-stub-hooks.mjs'

register(new URL('./helpers/window-lifecycle-stub-hooks.mjs', import.meta.url))

// Cover the other startup branch: windowManager sees an already-ready host and
// subscribes immediately instead of waiting for the 'ready' event. This lives
// in its own file because the module cache fixes the import-time branch.
setAppReady(true)
await import('../electron/windowManager.js')

function powerMonitorListeners(event: 'resume' | 'unlock-screen'): Array<() => void> {
  const listeners = windowLifecycleState().powerMonitorListeners as Record<string, Array<() => void>>
  return listeners[event] ?? []
}

test('an already-ready app subscribes resume and unlock-screen immediately', () => {
  const resume = powerMonitorListeners('resume')
  const unlock = powerMonitorListeners('unlock-screen')
  assert.equal(resume.length, 1, 'windowManager subscribes resume exactly once')
  assert.equal(unlock.length, 1, 'windowManager subscribes unlock-screen exactly once')
  assert.equal(typeof resume[0], 'function')
  assert.equal(typeof unlock[0], 'function')
  assert.equal(
    windowLifecycleState().appReadyListeners.length,
    0,
    'registration did not wait for a deferred ready callback',
  )
})

test('the immediately registered handlers still run without throwing', () => {
  for (const event of ['resume', 'unlock-screen'] as const) {
    const [listener] = powerMonitorListeners(event)
    assert.equal(typeof listener, 'function')
    assert.doesNotThrow(() => listener())
  }
})
