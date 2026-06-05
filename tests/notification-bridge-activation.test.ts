import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isNotificationBridgeEnabled } from '../src/app/controllers/notificationBridgeActivation.ts'
import type { AppSettings } from '../src/types/app.ts'

function settings(overrides: Partial<AppSettings>): AppSettings {
  return {
    autonomyEnabled: false,
    autonomyNotificationsEnabled: false,
    ...overrides,
  } as AppSettings
}

test('notification bridge can run without enabling the full autonomy loop', () => {
  assert.equal(
    isNotificationBridgeEnabled(settings({
      autonomyEnabled: false,
      autonomyNotificationsEnabled: true,
    })),
    true,
  )
})

test('notification bridge stays off when its own switch is disabled', () => {
  assert.equal(
    isNotificationBridgeEnabled(settings({
      autonomyEnabled: true,
      autonomyNotificationsEnabled: false,
    })),
    false,
  )
})
