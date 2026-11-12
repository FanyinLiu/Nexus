/**
 * Saved desktop-context switch wiring for the proactive delivery context.
 *
 * ipcRegistry assembles these dependencies through
 * createProactiveDeliveryContextWiring(); this suite drives that factory, not a
 * re-implementation. The provider gate and the getActiveWindow guard are
 * asserted separately: the provider never enters the capture path while the
 * saved switch is off, so deleting only the inner guard stays invisible there.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createProactiveDeliveryContextWiring } from '../electron/services/proactiveDeliveryContextWiring.js'

function createHarness(savedActiveWindow: boolean) {
  const flags = { activeWindow: savedActiveWindow }
  const counts = { loads: 0, captures: 0 }
  const wiring = createProactiveDeliveryContextWiring({
    isPanelFocused: () => false,
    getFocusState: () => 'active',
    getSavedDesktopContextFlags: () => flags,
    loadCaptureActiveWindowContext: async () => {
      counts.loads += 1
      return async () => {
        counts.captures += 1
        return {
          activeWindowTitle: 'Synthetic Fullscreen Player',
          activeWindowAppName: 'Synthetic Player',
        }
      }
    },
    getPreferences: () => ({ desktopAwarenessAllowed: true }),
    now: () => 0,
  })
  return { flags, counts, wiring }
}

test('isActiveWindowAllowed mirrors the saved switch, not the renderer copy', () => {
  const { flags, wiring } = createHarness(false)

  assert.equal(wiring.isActiveWindowAllowed(), false)

  flags.activeWindow = true
  assert.equal(wiring.isActiveWindowAllowed(), true)
})

test('saved switch off: the renderer preference cannot open the capture path', async () => {
  const { counts, wiring } = createHarness(false)

  const context = await wiring.getDeliveryContext()

  assert.equal(context.fullscreen, false)
  assert.equal(counts.loads, 0, 'the capture module must not load')
  assert.equal(counts.captures, 0, 'the active window must not be read')
})

test('saved switch off: getActiveWindow returns null before loading the capture module', async () => {
  const { counts, wiring } = createHarness(false)

  assert.equal(await wiring.getActiveWindow(), null)
  assert.equal(counts.loads, 0)
  assert.equal(counts.captures, 0)
})

test('saved switch on: the same preference reads the active window once', async () => {
  const { counts, wiring } = createHarness(true)

  const context = await wiring.getDeliveryContext()

  assert.equal(context.fullscreen, true)
  assert.equal(counts.loads, 1)
  assert.equal(counts.captures, 1)
})

test('saved switch on: getActiveWindow maps the snapshot', async () => {
  const { counts, wiring } = createHarness(true)

  assert.deepEqual(await wiring.getActiveWindow(), {
    title: 'Synthetic Fullscreen Player',
    appName: 'Synthetic Player',
  })
  assert.equal(counts.captures, 1)
})
