import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { isAllowedSender } from '../electron/services/allowlistPolicy.js'

// telegramGateway/discordGateway themselves cannot be loaded under plain
// node:test (they import `{ net } from 'electron'`), so this pins the shared
// policy function both gateways now delegate to.
describe('allowlistPolicy.isAllowedSender', () => {
  test('empty allowlist denies everyone (deny-by-default)', () => {
    assert.equal(isAllowedSender(new Set(), 12345), false)
    assert.equal(isAllowedSender(new Set(), 'channel-1'), false)
  })

  test('listed sender is allowed', () => {
    assert.equal(isAllowedSender(new Set([12345]), 12345), true)
    assert.equal(isAllowedSender(new Set(['channel-1']), 'channel-1'), true)
  })

  test('unlisted sender is denied when the list is non-empty', () => {
    assert.equal(isAllowedSender(new Set([12345]), 99999), false)
  })

  test('comparison is type-strict, matching Set semantics', () => {
    // Telegram chat IDs are numbers; a string of the same digits must not pass.
    assert.equal(isAllowedSender(new Set([12345]), '12345'), false)
  })
})
