/**
 * Typing-aware presence is fail-closed at the IPC payload boundary.
 *
 * Only boolean true may enable typing awareness. Every other shape — missing
 * field, string, number, null/undefined payload, array — either normalizes to
 * false or is rejected by the validator the handler calls. Dropping the
 * `=== true` comparison (to `!== false`) makes the non-boolean cases below
 * enable the keyboard hook.
 */

import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./helpers/desktop-presence-stub-hooks.mjs', import.meta.url))

const { validateDesktopPresencePreferencesPayload } = await import('../electron/ipc/desktopPresenceIpc.js')

test('typing awareness stays off for every non-boolean or missing payload field', () => {
  const payloads: unknown[] = [
    {},
    { gazeFollowEnabled: true },
    { typingAwarenessEnabled: 'true' },
    { typingAwarenessEnabled: 1 },
    { typingAwarenessEnabled: '1' },
    { typingAwarenessEnabled: false },
    { typingAwarenessEnabled: null },
    { typingAwarenessEnabled: undefined },
    { gazeFollowEnabled: false },
  ]

  for (const payload of payloads) {
    const preferences = validateDesktopPresencePreferencesPayload(payload)
    assert.equal(
      preferences.typingAwarenessEnabled,
      false,
      `typing awareness must stay off for ${JSON.stringify(payload)}`,
    )
  }
})

test('only boolean true enables typing awareness', () => {
  assert.equal(
    validateDesktopPresencePreferencesPayload({ typingAwarenessEnabled: true }).typingAwarenessEnabled,
    true,
  )
})

test('a null, undefined or array payload is rejected instead of enabling typing', () => {
  for (const payload of [null, undefined, [], 'true', 1]) {
    assert.throws(
      () => validateDesktopPresencePreferencesPayload(payload),
      /desktop presence preferences must be an object/,
    )
  }
})
