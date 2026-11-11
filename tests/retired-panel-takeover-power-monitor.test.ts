import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

import { windowLifecycleState } from './helpers/window-lifecycle-stub-hooks.mjs'

register(new URL('./helpers/window-lifecycle-stub-hooks.mjs', import.meta.url))

// Importing windowManager wires the real powerMonitor subscriptions; the
// lifecycle hooks replace Electron itself, so no host window is created.
await import('../electron/windowManager.js')

function powerMonitorListeners(event: string): Array<() => void> {
  const listeners = windowLifecycleState().powerMonitorListeners as Record<string, Array<() => void>>
  return listeners[event] ?? []
}

test('the live app starts the takeover grace on powerMonitor resume', () => {
  const listeners = powerMonitorListeners('resume')
  assert.equal(listeners.length, 1, 'windowManager subscribes resume exactly once')
  assert.equal(typeof listeners[0], 'function')
  assert.doesNotThrow(() => listeners[0]())
})

test('the live app starts the takeover grace on powerMonitor unlock-screen', () => {
  const listeners = powerMonitorListeners('unlock-screen')
  assert.equal(listeners.length, 1, 'windowManager subscribes unlock-screen exactly once')
  assert.equal(typeof listeners[0], 'function')
  assert.doesNotThrow(() => listeners[0]())
})
