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

test('notification card menu keeps later and important, and leaves reply on the card', () => {
  const actions = getNotificationCardPrimaryActions(makeMessage())

  assert.deepEqual(actions.map((action) => action.id), [
    'mark_important',
    'snooze_later',
  ])
  assert.deepEqual(actions.map((action) => action.labelKey), [
    'panel.notification.action.mark_important',
    'panel.notification.action.snooze_later',
  ])
  assert.equal(actions.some((action) => action.id === 'draft_reply'), false)
})

test('notification card menu actions keep long helper copy out of button labels', () => {
  const actions = getNotificationCardPrimaryActions(makeMessage())
  const snoozeAction = actions.find((action) => action.id === 'snooze_later')

  assert.equal(snoozeAction?.labelKey, 'panel.notification.action.snooze_later')
  assert.equal(snoozeAction?.titleKey, 'panel.notification.snooze_30m')
})

test('notification card important action toggles its label when already important', () => {
  const actions = getNotificationCardPrimaryActions(makeMessage({ isImportant: true }))

  assert.equal(actions[0]?.id, 'mark_important')
  assert.equal(actions[0]?.labelKey, 'panel.notification.action.unmark_important')
})
