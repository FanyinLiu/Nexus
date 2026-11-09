/**
 * Regression: the real OS-notification path registers its click handler and
 * trims the copy before constructing the notification. The previous suite could
 * not see this module at all: electron-main-stub-hooks.mjs replaces
 * proactiveNotification.js wholesale, so removing the `on('click')`
 * registration or the `onClick()` call survived every test.
 *
 * The loader hooks stand in for Electron and windowManager only; the module
 * under test is the real one.
 */

import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import {
  STATE_KEY,
  hookUrl,
  resetProactiveNotificationState,
} from './helpers/proactive-notification-hooks.mjs'

register(hookUrl)

type NotificationInstance = {
  options: { title: string; body: string; silent: boolean; icon: string }
  handlers: Map<string, Array<() => void>>
  shown: boolean
}

type PanelWindow = {
  loading: boolean
  finishLoad: () => void
}

type RuntimeState = {
  supported: boolean
  instances: NotificationInstance[]
  shown: number
  focusCalls: number
  createdWindows: number
  panelWindows: PanelWindow[]
  nextPanelLoading: boolean
}

type ShowNotification = (input: {
  title?: unknown
  body?: unknown
  onClick?: unknown
}) => boolean

const PET_ICON = '/fake/pet-icon.png'

function runtime(): RuntimeState {
  const state = (globalThis as unknown as Record<string, RuntimeState | undefined>)[STATE_KEY]
  assert.ok(state, 'notification hook state was never initialized')
  return state
}

function clickHandlers(notification: NotificationInstance): Array<() => void> {
  return notification.handlers.get('click') ?? []
}

async function loadShowNotification(): Promise<ShowNotification> {
  const module = await import('../electron/services/proactiveNotification.js')
  return module.showProactiveNotification as ShowNotification
}

test('a notification is created with trimmed copy, a click handler and show()', async () => {
  resetProactiveNotificationState()
  const show = await loadShowNotification()

  const shown = show({ title: '  Stand up  ', body: '  Time to move  ', onClick: () => {} })

  assert.equal(shown, true)
  assert.equal(runtime().instances.length, 1)
  const notification = runtime().instances[0]!
  assert.deepEqual(notification.options, {
    title: 'Stand up',
    body: 'Time to move',
    silent: false,
    icon: PET_ICON,
  })
  assert.equal(notification.shown, true)
  assert.equal(clickHandlers(notification).length, 1)
  assert.equal(runtime().shown, 1)
})

test('firing the click focuses the panel and calls onClick exactly once', async () => {
  resetProactiveNotificationState()
  const show = await loadShowNotification()
  const calls: string[] = []

  assert.equal(
    show({ title: 'Reminder', body: 'Body', onClick: () => calls.push('hand-off') }),
    true,
  )
  const handlers = clickHandlers(runtime().instances[0]!)
  assert.equal(handlers.length, 1, 'the notification registered more than one click handler')

  handlers[0]!()

  assert.deepEqual(calls, ['hand-off'])
  assert.equal(runtime().focusCalls, 1)
})

test('a rebuilt panel defers the notification hand-off until its renderer is ready', async () => {
  resetProactiveNotificationState()
  runtime().nextPanelLoading = true
  const show = await loadShowNotification()
  const calls: string[] = []

  assert.equal(show({ title: 'Reminder', body: 'Body', onClick: () => calls.push('hand-off') }), true)
  const handler = clickHandlers(runtime().instances[0]!)[0]
  assert.ok(handler)
  handler()

  assert.equal(runtime().createdWindows, 1, 'the retired panel is rebuilt')
  assert.equal(runtime().focusCalls, 1)
  assert.deepEqual(calls, [], 'the hand-off waits for did-finish-load')

  runtime().panelWindows[0]!.finishLoad()
  assert.deepEqual(calls, ['hand-off'])
})

test('a missing onClick still focuses the panel and does not throw', async () => {
  resetProactiveNotificationState()
  const show = await loadShowNotification()

  assert.equal(show({ title: 'Reminder', body: 'Body' }), true)
  const handler = clickHandlers(runtime().instances[0]!)[0]
  assert.ok(handler)

  assert.doesNotThrow(() => handler())
  assert.equal(runtime().focusCalls, 1)
})

test('an unsupported platform returns false without creating a notification', async () => {
  resetProactiveNotificationState()
  runtime().supported = false
  const show = await loadShowNotification()

  assert.equal(show({ title: 'Reminder', body: 'Body', onClick: () => {} }), false)
  assert.equal(runtime().instances.length, 0)
  assert.equal(runtime().shown, 0)
})

test('an empty or non-string title returns false without creating a notification', async () => {
  resetProactiveNotificationState()
  const show = await loadShowNotification()

  const invalid: Array<{ title?: unknown, body?: unknown }> = [
    { title: '', body: 'Body' },
    { title: '   ', body: 'Body' },
    { title: 42, body: 'Body' },
    { body: 'Body' },
  ]

  for (const input of invalid) {
    assert.equal(show(input), false, `expected false for ${JSON.stringify(input)}`)
  }
  assert.equal(runtime().instances.length, 0)
  assert.equal(runtime().shown, 0)
})

test('a title-only notification omits empty, missing or non-string body text', async () => {
  const inputs: Array<{ title?: unknown, body?: unknown }> = [
    { title: 'Title' },
    { title: 'Title', body: '' },
    { title: 'Title', body: '   ' },
    { title: 'Title', body: null },
    { title: 'Title', body: 42 },
  ]

  for (const input of inputs) {
    resetProactiveNotificationState()
    const show = await loadShowNotification()

    assert.equal(show(input), true, `expected true for ${JSON.stringify(input)}`)
    assert.equal(runtime().instances.length, 1)
    const notification = runtime().instances[0]!
    assert.equal(notification.options.title, 'Title')
    assert.equal('body' in notification.options, false)
    assert.equal(notification.shown, true)
    assert.equal(clickHandlers(notification).length, 1)
  }
})
