import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatProactiveUnreadBadge,
  proactiveUnreadBadgeLabelKey,
} from '../src/features/proactive/proactiveUnreadBadge.ts'
import { ensureLocaleLoaded, t } from '../src/i18n/runtime.ts'

function label(locale: 'en-US' | 'ja', unreadCount: number): string {
  const badge = formatProactiveUnreadBadge(unreadCount)
  assert.ok(badge)
  return t(proactiveUnreadBadgeLabelKey(unreadCount), { count: badge }, locale)
}

test('the badge label uses the singular key only for exactly one unread message', () => {
  assert.equal(proactiveUnreadBadgeLabelKey(0), 'pet.proactive.unread_badge')
  assert.equal(proactiveUnreadBadgeLabelKey(1), 'pet.proactive.unread_badge_one')
  assert.equal(proactiveUnreadBadgeLabelKey(2), 'pet.proactive.unread_badge')
})

test('English distinguishes one unread message from several', async () => {
  await ensureLocaleLoaded('en-US')

  assert.equal(label('en-US', 1), '1 unread message')
  assert.equal(label('en-US', 2), '2 unread messages')
})

test('a locale without plural forms reuses its text for the singular key', async () => {
  await ensureLocaleLoaded('ja')

  assert.equal(label('ja', 1), '未読 1 件')
  assert.equal(label('ja', 2), '未読 2 件')
})
