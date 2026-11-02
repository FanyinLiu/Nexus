import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  inboxStatusAfterInteraction,
  PROACTIVE_INBOX_INTERACTIONS,
} from '../shared/proactiveInboxReadRule.js'

const WITH_ACTIONS = { actions: ['done', 'snooze', 'open'] }
const WITHOUT_ACTIONS = { actions: [] }
const NORMAL_NO_ACTIONS = { actions: [], priority: 'normal' }
const HIGH_CAPSULE = { actions: [], priority: 'high' }

test('opening the overlay never changes a status', () => {
  assert.equal(inboxStatusAfterInteraction(WITH_ACTIONS, 'overlay_open'), null)
  assert.equal(inboxStatusAfterInteraction(WITHOUT_ACTIONS, 'overlay_open'), null)
  assert.equal(inboxStatusAfterInteraction(NORMAL_NO_ACTIONS, 'overlay_open'), null)
  assert.equal(inboxStatusAfterInteraction(HIGH_CAPSULE, 'overlay_open'), null)
  assert.equal(PROACTIVE_INBOX_INTERACTIONS.includes('overlay_open'), true)
})

test('an entry with actions is read by done, open and reply', () => {
  for (const interaction of ['done', 'open', 'reply']) {
    assert.equal(inboxStatusAfterInteraction(WITH_ACTIONS, interaction), 'done', interaction)
  }
})

test('snooze and expand leave an actionable entry unread', () => {
  assert.equal(inboxStatusAfterInteraction(WITH_ACTIONS, 'snooze'), null)
  assert.equal(inboxStatusAfterInteraction(WITH_ACTIONS, 'expand'), null)
})

test('an action-less entry is read by expanding its full text, at any priority', () => {
  for (const entry of [WITHOUT_ACTIONS, NORMAL_NO_ACTIONS, HIGH_CAPSULE]) {
    assert.equal(inboxStatusAfterInteraction(entry, 'expand'), 'done')
  }
  for (const interaction of ['done', 'open', 'reply', 'snooze', 'overlay_open']) {
    for (const entry of [WITHOUT_ACTIONS, NORMAL_NO_ACTIONS, HIGH_CAPSULE]) {
      assert.equal(inboxStatusAfterInteraction(entry, interaction), null, interaction)
    }
  }
})

test('clicking the OS notification is read at any priority and with or without actions', () => {
  assert.equal(PROACTIVE_INBOX_INTERACTIONS.includes('notification_click'), true)
  assert.equal(inboxStatusAfterInteraction(WITH_ACTIONS, 'notification_click'), 'done')
  assert.equal(inboxStatusAfterInteraction(NORMAL_NO_ACTIONS, 'notification_click'), 'done')
  assert.equal(inboxStatusAfterInteraction(HIGH_CAPSULE, 'notification_click'), 'done')
})

test('unknown and missing entries are a no-op', () => {
  assert.equal(inboxStatusAfterInteraction(null, 'expand'), null)
  assert.equal(inboxStatusAfterInteraction(undefined, 'done'), null)
  assert.equal(inboxStatusAfterInteraction(WITH_ACTIONS, 'expire'), null)
})
