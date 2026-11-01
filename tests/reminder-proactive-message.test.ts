import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildReminderDeliveryContext,
  buildReminderProactiveMessage,
  readProactiveDesktopContext,
} from '../src/features/reminders/proactiveMessage.ts'
import * as reminderMessage from '../src/features/reminders/proactiveMessage.ts'
import { PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS } from '../src/features/uiV2/caption.ts'
import type { AppSettings } from '../src/types/index.ts'

const NOW = new Date(2026, 0, 1, 14, 0, 0).getTime()

const task = { id: 'task-1', title: 'Stand up' }

test('a reminder message carries one id per firing and updates in place for the same firing', () => {
  const first = buildReminderProactiveMessage(task, { displayText: 'Time to move', speech: 'Stand up now', now: NOW })
  const repeat = buildReminderProactiveMessage(task, { displayText: 'Time to move', speech: 'Stand up now', now: NOW })
  const nextFiring = buildReminderProactiveMessage(task, { displayText: 'Time to move', speech: 'Stand up now', now: NOW + 60_000 })

  assert.equal(first.id, `reminder:task-1:${NOW}`)
  assert.equal(repeat.id, first.id)
  assert.notEqual(nextFiring.id, first.id)
})

test('a reminder message is high priority, actionable and points back at its task', () => {
  const message = buildReminderProactiveMessage(task, {
    displayText: 'Time to move',
    speech: 'Stand up now',
    now: NOW,
  })

  assert.equal(message.source, 'reminder')
  assert.equal(message.kind, 'reminder_follow_up')
  assert.equal(message.priority, 'high')
  assert.deepEqual(message.actions, ['done', 'snooze', 'open'])
  assert.deepEqual(message.origin, { taskId: 'task-1' })
  assert.equal(message.createdAt, NOW)
  assert.equal(message.speech, 'Stand up now')
})

test('an empty speech signal leaves the message silent', () => {
  const message = buildReminderProactiveMessage(task, { displayText: 'Time to move', speech: '   ', now: NOW })
  assert.equal('speech' in message, false)
})

test('title and body are clipped to the 80/160 character contract', () => {
  const message = buildReminderProactiveMessage(
    { id: 'task-2', title: 't'.repeat(120) },
    { displayText: 'b'.repeat(300), speech: 'spoken', now: NOW },
  )

  assert.equal(message.title.length, 80)
  assert.ok(message.title.endsWith('…'))
  assert.equal(message.body.length, 160)
  assert.ok(message.body.endsWith('…'))
})

test('the delivery context uses the focus, quiet-hours, fullscreen and away signals it is given', () => {
  const context = buildReminderDeliveryContext({
    focusState: 'active',
    activeWindowTitle: 'YouTube — Fullscreen',
    activeWindowAppName: 'Safari',
    quietStart: 14,
    quietEnd: 15,
    awayNotificationsEnabled: true,
    now: NOW,
  })

  assert.deepEqual(context, {
    panelFocused: false,
    fullscreen: true,
    focusState: 'active',
    inQuietHours: true,
    systemDnd: null,
    awayNotificationsEnabled: true,
    stripEnabled: true,
  })
})

test('the delivery context stays out of quiet hours outside the window', () => {
  const context = buildReminderDeliveryContext({
    focusState: 'idle',
    quietStart: 9,
    quietEnd: 10,
    awayNotificationsEnabled: false,
    now: NOW,
  })

  assert.equal(context.inQuietHours, false)
  assert.equal(context.fullscreen, false)
  assert.equal(context.focusState, 'idle')
  assert.equal(context.awayNotificationsEnabled, false)
})

test('the reminder module no longer exports a source-specific auto-hide', () => {
  assert.equal('REMINDER_NOTICE_AUTO_HIDE_MS' in reminderMessage, false)
  assert.equal('proactiveBubbleAutoHideMs' in reminderMessage, false)
  assert.equal(PROACTIVE_BUBBLE_AUTO_COLLAPSE_MS, 12_000)
})

// ── Desktop context permission ──────────────────────────────────────────────

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    contextAwarenessEnabled: true,
    activeWindowContextEnabled: true,
    companionAwarenessPaused: false,
    ...overrides,
  } as AppSettings
}

function installDesktopPet(
  getDesktopContext: (payload: { includeActiveWindow: boolean }) => Promise<unknown>,
): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    value: { desktopPet: { getDesktopContext } },
    configurable: true,
    writable: true,
  })
  return () => {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

const DENIED_CONTEXT_CASES: ReadonlyArray<{
  name: string
  settings: Partial<AppSettings>
}> = [
  { name: 'context awareness off', settings: { contextAwarenessEnabled: false } },
  { name: 'active window context off', settings: { activeWindowContextEnabled: false } },
  { name: 'companion awareness paused', settings: { companionAwarenessPaused: true } },
]

for (const denied of DENIED_CONTEXT_CASES) {
  test(`readProactiveDesktopContext skips the bridge when ${denied.name}`, async (t) => {
    let calls = 0
    const restore = installDesktopPet(async () => {
      calls += 1
      return { activeWindowTitle: 'should not be read' }
    })
    t.after(restore)

    const result = await readProactiveDesktopContext(makeSettings(denied.settings))

    assert.equal(result, null)
    assert.equal(calls, 0)
  })
}

test('readProactiveDesktopContext calls the bridge once with the active-window request when granted', async (t) => {
  const snapshot = { activeWindowTitle: 'Editor', activeWindowAppName: 'Code' }
  const payloads: Array<{ includeActiveWindow: boolean }> = []
  const restore = installDesktopPet(async (payload) => {
    payloads.push(payload)
    return snapshot
  })
  t.after(restore)

  const result = await readProactiveDesktopContext(makeSettings())

  assert.deepEqual(result, snapshot)
  assert.deepEqual(payloads, [{ includeActiveWindow: true }])
})
