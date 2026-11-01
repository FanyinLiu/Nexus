import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildReminderDeliveryContext,
  buildReminderProactiveMessage,
  proactiveBubbleAutoHideMs,
  REMINDER_NOTICE_AUTO_HIDE_MS,
} from '../src/features/reminders/proactiveMessage.ts'

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

test('the reminder bubble keeps its 16 s auto-hide without changing other sources', () => {
  assert.equal(proactiveBubbleAutoHideMs('reminder', 0), REMINDER_NOTICE_AUTO_HIDE_MS)
  assert.equal(REMINDER_NOTICE_AUTO_HIDE_MS, 16_000)
  assert.equal(proactiveBubbleAutoHideMs('agenda', 0), 0)
  assert.equal(proactiveBubbleAutoHideMs('agenda', 14_000), 14_000)
})
