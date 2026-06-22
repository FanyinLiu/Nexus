import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getNotificationCardPrimaryActions } from '../src/features/notifications/notificationCardActions.ts'
import type { NotificationMessage } from '../src/types/autonomy.ts'

function makeMessage(overrides: Partial<NotificationMessage> = {}): NotificationMessage {
  return {
    id: 'msg-1',
    channelId: 'macos',
    channelName: 'Messages',
    kind: 'message',
    sourceId: 'imessage',
    sourceName: 'Messages',
    conversationId: 'thread-1',
    messageId: 'external-1',
    sender: 'Ada',
    title: 'Ada',
    body: 'private message body',
    receivedAt: new Date(0).toISOString(),
    read: false,
    ...overrides,
  }
}

test('notification card exposes the three primary action buttons in a stable order', () => {
  const actions = getNotificationCardPrimaryActions(makeMessage())

  assert.deepEqual(actions.map((action) => action.id), [
    'draft_reply',
    'mark_important',
    'snooze_later',
  ])
  assert.deepEqual(actions.map((action) => action.labelKey), [
    'panel.notification.action.draft_reply',
    'panel.notification.action.mark_important',
    'panel.notification.action.snooze_later',
  ])
})

test('notification card primary actions keep long helper copy out of button labels', () => {
  const actions = getNotificationCardPrimaryActions(makeMessage())
  const draftAction = actions.find((action) => action.id === 'draft_reply')
  const snoozeAction = actions.find((action) => action.id === 'snooze_later')

  assert.equal(draftAction?.labelKey, 'panel.notification.action.draft_reply')
  assert.equal(draftAction?.titleKey, 'panel.notification.draft_reply')
  assert.equal(snoozeAction?.labelKey, 'panel.notification.action.snooze_later')
  assert.equal(snoozeAction?.titleKey, 'panel.notification.snooze_30m')
})

test('notification card important action toggles its label when already important', () => {
  const actions = getNotificationCardPrimaryActions(makeMessage({ isImportant: true }))

  assert.equal(actions[1]?.id, 'mark_important')
  assert.equal(actions[1]?.labelKey, 'panel.notification.action.unmark_important')
})
