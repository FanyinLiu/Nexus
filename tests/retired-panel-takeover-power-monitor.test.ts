import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

import {
  emitAppReady,
  windowLifecycleState,
} from './helpers/window-lifecycle-stub-hooks.mjs'

register(new URL('./helpers/window-lifecycle-stub-hooks.mjs', import.meta.url))

// The fake app starts not ready, so importing windowManager must leave
// powerMonitor untouched and defer registration to the 'ready' event. The
// lifecycle hooks replace Electron itself, so no host window is created.
const windowManager = await import('../electron/windowManager.js')

function powerMonitorListeners(event: 'resume' | 'unlock-screen'): Array<() => void> {
  const listeners = windowLifecycleState().powerMonitorListeners as Record<string, Array<() => void>>
  return listeners[event] ?? []
}

test('importing windowManager before ready registers no powerMonitor listeners', () => {
  assert.equal(powerMonitorListeners('resume').length, 0, 'resume is not subscribed before ready')
  assert.equal(powerMonitorListeners('unlock-screen').length, 0, 'unlock-screen is not subscribed before ready')
})

test('app ready subscribes resume and unlock-screen exactly once', () => {
  emitAppReady()
  const resume = powerMonitorListeners('resume')
  const unlock = powerMonitorListeners('unlock-screen')
  assert.equal(resume.length, 1, 'windowManager subscribes resume exactly once')
  assert.equal(unlock.length, 1, 'windowManager subscribes unlock-screen exactly once')
  assert.equal(typeof resume[0], 'function')
  assert.equal(typeof unlock[0], 'function')
})

test('re-emitting ready or registering again does not duplicate listeners', () => {
  emitAppReady()
  windowManager.registerRetiredPanelPowerListeners()
  assert.equal(powerMonitorListeners('resume').length, 1, 'resume stays subscribed exactly once')
  assert.equal(powerMonitorListeners('unlock-screen').length, 1, 'unlock-screen stays subscribed exactly once')
})

test('the registered resume and unlock-screen handlers still run without throwing', () => {
  for (const event of ['resume', 'unlock-screen'] as const) {
    const [listener] = powerMonitorListeners(event)
    assert.equal(typeof listener, 'function')
    assert.doesNotThrow(() => listener())
  }
})
