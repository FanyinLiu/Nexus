import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isNotificationBridgeEnabled,
  shouldPanelArmNotificationBridge,
} from '../src/app/controllers/notificationBridgeActivation.ts'
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

test('the panel arms the bridge when it is not the runtime owner', () => {
  assert.equal(shouldPanelArmNotificationBridge(false, true), true)
  assert.equal(shouldPanelArmNotificationBridge(true, true), false)
  assert.equal(shouldPanelArmNotificationBridge(false, false), false)
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
