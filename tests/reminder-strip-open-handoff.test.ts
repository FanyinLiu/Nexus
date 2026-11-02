/**
 * Regression: the strip's `open` and `reply` actions focus the companion panel
 * and still reach the inbox hand-off. No test drove the real reminderStrip.js
 * wiring, so a `return` after focusCompanionPanel() passed the whole suite.
 *
 * The module loader hooks stand in for Electron and the main-process
 * singletons; the queue, the session and the strip's action handler stay real.
 */

import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test, type TestContext } from 'node:test'

import { STATE_KEY, hookUrl, resetReminderStripState } from './helpers/reminder-strip-runtime-hooks.mjs'

register(hookUrl)

type ActionHandler = (event: unknown, payload?: unknown) => unknown
type StripWindow = { handlers: Map<string, ActionHandler> }
type RuntimeState = { windows: StripWindow[]; focusCalls: number; }

const LABELS = { done: 'Done', snooze: 'Snooze 10 min', open: 'Open chat' }

function runtime(): RuntimeState {
  return (globalThis as unknown as Record<string, RuntimeState>)[STATE_KEY]!
}

function payload(id: string, actions: string[]) {
  return { id, title: `Title ${id}`, body: `Body ${id}`, labels: LABELS, actions }
}

async function createHarness(t: TestContext) {
  const strip = await import('../electron/services/reminderStrip.js')
  strip.destroyReminderStrip()
  const handoffs: Array<{ action: string; id: string }> = []
  strip.configureReminderStrip({
    onAction: (action: string, id: string) => {
      handoffs.push({ action, id })
    },
  })
  resetReminderStripState()
  t.after(() => {
    strip.destroyReminderStrip()
    strip.configureReminderStrip({})
  })
  return { strip, handoffs }
}

/** The handler the strip page reaches through reminder-strip:action. */
function actionHandler(): ActionHandler {
  const win = runtime().windows.at(-1)
  assert.ok(win, 'the strip window was never created')
  const handler = win.handlers.get('reminder-strip:action')
  assert.ok(handler, 'the strip window has no action handler')
  return handler
}

for (const action of ['open', 'reply']) {
  test(`a strip ${action} focuses the companion panel once and reaches the inbox hand-off`, async (t) => {
    const harness = await createHarness(t)
    const id = `reminder:${action}:1700000000000`
    harness.strip.showReminderStrip(payload(id, [action]))

    const result = await actionHandler()({}, { id, action })

    assert.deepEqual(result, { ok: true })
    assert.equal(runtime().focusCalls, 1)
    assert.deepEqual(harness.handoffs, [{ action, id }])
  })
}

test('a strip done reaches the inbox hand-off without focusing the panel', async (t) => {
  const harness = await createHarness(t)
  const id = 'reminder:done:1700000000000'
  harness.strip.showReminderStrip(payload(id, ['done']))

  const result = await actionHandler()({}, { id, action: 'done' })

  assert.deepEqual(result, { ok: true })
  assert.equal(runtime().focusCalls, 0)
  assert.deepEqual(harness.handoffs, [{ action: 'done', id }])
})
