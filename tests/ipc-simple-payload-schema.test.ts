import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  validateConfirmDialogPayload,
  validateLaunchOnStartupPayload,
  validateNotificationWatcherSetPayload,
  validatePersonaInitPayload,
  validatePersonaSaveMemoryPayload,
  validateProactiveShowNotificationPayload,
  validateSystemVibrancyPayload,
} from '../electron/ipc/payloadSchemas.js'

test('IPC boolean toggle schemas accept only booleans and strip stray fields', () => {
  assert.deepEqual(validateSystemVibrancyPayload({ enabled: false }), { enabled: false })
  assert.deepEqual(validateSystemVibrancyPayload(undefined), {})
  assert.throws(
    () => validateSystemVibrancyPayload({ enabled: 'false' }),
    /Invalid IPC payload for window:set-system-vibrancy: payload\.enabled must be a boolean/,
  )

  assert.equal(validateLaunchOnStartupPayload(true), true)
  assert.equal(validateLaunchOnStartupPayload(false), false)
  assert.equal(validateLaunchOnStartupPayload(undefined), false)
  assert.throws(
    () => validateLaunchOnStartupPayload('true'),
    /Invalid IPC payload for app:set-launch-on-startup: payload must be a boolean/,
  )
})

test('IPC dialog confirm schema accepts only a string message', () => {
  assert.equal(validateConfirmDialogPayload('Delete this memory?'), 'Delete this memory?')
  assert.equal(validateConfirmDialogPayload(undefined), '')
  assert.throws(
    () => validateConfirmDialogPayload(42),
    /Invalid IPC payload for dialog:confirm: payload must be a string/,
  )
})

test('IPC watcher and proactive notification schemas pin their string fields', () => {
  assert.deepEqual(
    validateNotificationWatcherSetPayload({ enabled: true, appsPattern: 'Slack', rogue: true }),
    { enabled: true, appsPattern: 'Slack' },
  )
  assert.deepEqual(validateNotificationWatcherSetPayload(undefined), {})
  assert.throws(
    () => validateNotificationWatcherSetPayload({ enabled: 'yes' }),
    /Invalid IPC payload for notification:watcher-set: payload\.enabled must be a boolean/,
  )
  assert.throws(
    () => validateNotificationWatcherSetPayload({ appsPattern: 7 }),
    /Invalid IPC payload for notification:watcher-set: payload\.appsPattern must be a string/,
  )

  assert.deepEqual(
    validateProactiveShowNotificationPayload({ title: 'Nexus', body: 'Thinking of you', rogue: true }),
    { title: 'Nexus', body: 'Thinking of you' },
  )
  assert.deepEqual(validateProactiveShowNotificationPayload(undefined), {})
  assert.throws(
    () => validateProactiveShowNotificationPayload({ title: 1 }),
    /Invalid IPC payload for proactive:show-notification: payload\.title must be a string/,
  )
})

test('IPC persona text schemas pass strings through and reject other types', () => {
  assert.deepEqual(
    validatePersonaSaveMemoryPayload({ content: '# Memory\n- tea', rogue: true }),
    { content: '# Memory\n- tea' },
  )
  assert.deepEqual(validatePersonaSaveMemoryPayload(undefined), {})
  assert.throws(
    () => validatePersonaSaveMemoryPayload({ content: ['not', 'a', 'string'] }),
    /Invalid IPC payload for persona:save-memory: payload\.content must be a string/,
  )

  assert.deepEqual(validatePersonaInitPayload({ defaultSoul: '# SOUL' }), { defaultSoul: '# SOUL' })
  assert.deepEqual(validatePersonaInitPayload(undefined), {})
  assert.throws(
    () => validatePersonaInitPayload({ defaultSoul: 1 }),
    /Invalid IPC payload for persona:init: payload\.defaultSoul must be a string/,
  )
})
