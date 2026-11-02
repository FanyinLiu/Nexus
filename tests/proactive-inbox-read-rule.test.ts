import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  inboxStatusAfterInteraction,
  PROACTIVE_INBOX_INTERACTIONS,
} from '../shared/proactiveInboxReadRule.js'

const WITH_ACTIONS = { actions: ['done', 'snooze', 'open'] }
const WITHOUT_ACTIONS = { actions: [] }
const NORMAL_NO_ACTIONS = { actions: [], priority: 'normal' }
const HIGH_NO_ACTIONS = { actions: [], priority: 'high' }
const CAPSULE_NO_ACTIONS = { actions: [], kind: 'capsule' }
const CAPSULE_WITH_ACTIONS = { actions: ['done', 'open'], kind: 'capsule' }

test('opening the overlay never changes a status', () => {
  for (const entry of [
    WITH_ACTIONS,
    WITHOUT_ACTIONS,
    NORMAL_NO_ACTIONS,
    HIGH_NO_ACTIONS,
    CAPSULE_NO_ACTIONS,
    CAPSULE_WITH_ACTIONS,
  ]) {
    assert.equal(inboxStatusAfterInteraction(entry, 'overlay_open'), null)
  }
  assert.equal(PROACTIVE_INBOX_INTERACTIONS.includes('overlay_open'), true)
})

test('done, open and reply mark every entry done, with or without buttons', () => {
  for (const interaction of ['done', 'open', 'reply']) {
    for (const entry of [
      WITH_ACTIONS,
      WITHOUT_ACTIONS,
      NORMAL_NO_ACTIONS,
      HIGH_NO_ACTIONS,
      CAPSULE_NO_ACTIONS,
      CAPSULE_WITH_ACTIONS,
    ]) {
      assert.equal(inboxStatusAfterInteraction(entry, interaction), 'done', interaction)
    }
  }
})

test('snooze, expire and unknown interactions leave every entry unchanged', () => {
  assert.equal(PROACTIVE_INBOX_INTERACTIONS.includes('expire'), true)
  for (const interaction of ['snooze', 'expire', 'delete', '']) {
    for (const entry of [
      WITH_ACTIONS,
      WITHOUT_ACTIONS,
      CAPSULE_NO_ACTIONS,
      CAPSULE_WITH_ACTIONS,
    ]) {
      assert.equal(inboxStatusAfterInteraction(entry, interaction), null, interaction)
    }
  }
})

test('expand marks a no-button entry done but leaves an actionable entry unchanged', () => {
  for (const entry of [WITHOUT_ACTIONS, NORMAL_NO_ACTIONS, HIGH_NO_ACTIONS, CAPSULE_NO_ACTIONS]) {
    assert.equal(inboxStatusAfterInteraction(entry, 'expand'), 'done')
  }
  assert.equal(inboxStatusAfterInteraction(WITH_ACTIONS, 'expand'), null)
  assert.equal(inboxStatusAfterInteraction(CAPSULE_WITH_ACTIONS, 'expand'), null)
})

test('a notification click reads an actionable entry but never a capsule', () => {
  assert.equal(PROACTIVE_INBOX_INTERACTIONS.includes('notification_click'), true)
  assert.equal(inboxStatusAfterInteraction(WITH_ACTIONS, 'notification_click'), 'read')
  assert.equal(inboxStatusAfterInteraction(CAPSULE_WITH_ACTIONS, 'notification_click'), null)
  assert.equal(inboxStatusAfterInteraction(CAPSULE_NO_ACTIONS, 'notification_click'), null)
})

test('a notification click marks a no-button non-capsule entry done', () => {
  for (const entry of [WITHOUT_ACTIONS, NORMAL_NO_ACTIONS, HIGH_NO_ACTIONS]) {
    assert.equal(inboxStatusAfterInteraction(entry, 'notification_click'), 'done')
  }
})

test('unknown and missing entries are a no-op', () => {
  assert.equal(inboxStatusAfterInteraction(null, 'expand'), null)
  assert.equal(inboxStatusAfterInteraction(undefined, 'done'), null)
  assert.equal(inboxStatusAfterInteraction(null, 'notification_click'), null)
})
