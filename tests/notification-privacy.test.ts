import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildNotificationHistorySafeNoticeContent,
  buildNotificationMessageChatForwardText,
  buildNotificationMessageFollowUpInput,
  sanitizeNotificationMessageForStorage,
  sanitizeNotificationMessagesForStorage,
} from '../src/lib/privacy/notificationPrivacy.ts'
import type { NotificationMessage } from '../src/types/autonomy.ts'
import type { TranslationKey } from '../src/types/i18n.ts'

function makeMessage(overrides: Partial<NotificationMessage> = {}): NotificationMessage {
  return {
    id: 'msg-1',
    channelId: 'macos',
    channelName: 'macOS Messages',
    kind: 'message',
    sourceId: 'imessage',
    sourceName: 'Messages',
    conversationId: 'thread-1',
    messageId: 'external-1',
    sender: 'Ada',
    title: 'Ada',
    body: 'private dinner plan and one-time code 123456',
    summary: 'private summary',
    receivedAt: new Date(0).toISOString(),
    read: false,
    ...overrides,
  }
}

function t(key: TranslationKey, params: Record<string, string> = {}) {
  return [
    key,
    params.source ?? '',
    params.sender ?? '',
    params.channel ?? '',
    params.title ?? '',
    params.body ?? '',
    params.text ?? '',
  ].join('|')
}

test('desktop notification message forwarding is metadata-only', () => {
  const message = makeMessage()
  const text = buildNotificationMessageChatForwardText(message, t)

  assert.equal(text, 'chat.prefix.desktop_message|Messages|Ada||||')
  assert.equal(text.includes(message.body), false)
})

test('missed-message follow-up input never carries body snippets', () => {
  const message = makeMessage()
  const input = buildNotificationMessageFollowUpInput(message)
  const serialized = JSON.stringify(input)

  assert.deepEqual(input, {
    conversationKey: 'thread-1',
    sourceLabel: 'Messages',
    senderLabel: 'Ada',
  })
  assert.equal(serialized.includes(message.body), false)
  assert.equal('topicHint' in input, false)
})

test('notification notice content stored in chat history omits notification body', () => {
  const message = makeMessage({
    kind: 'notification',
    channelName: 'Mail',
    title: 'Bank alert',
    body: 'Your private account balance is visible here',
  })
  const notice = buildNotificationHistorySafeNoticeContent(message, t)

  assert.equal(notice.chatContent, 'chat.prefix.notification_bubble|||Mail|Bank alert||')
  assert.equal(notice.chatContent.includes(message.body), false)
  assert.equal(notice.bubbleContent.includes(message.body), false)
  assert.equal(notice.speechContent.includes(message.body), false)
})

test('notification persistence strips body and summaries before renderer storage', () => {
  const message = makeMessage({ snoozedUntil: new Date(1).toISOString(), isImportant: true })
  const sanitized = sanitizeNotificationMessageForStorage(message)

  assert.equal(sanitized.body, '')
  assert.equal(sanitized.summary, undefined)
  assert.equal(sanitized.title, message.title)
  assert.equal(sanitized.sender, message.sender)
  assert.equal(sanitized.snoozedUntil, message.snoozedUntil)
  assert.equal(sanitized.isImportant, true)
})

test('notification persistence sanitizes every item in a list', () => {
  const items = sanitizeNotificationMessagesForStorage([
    makeMessage({ id: 'a', body: 'secret a' }),
    makeMessage({ id: 'b', kind: 'notification', body: 'secret b' }),
  ])

  assert.deepEqual(items.map((item) => item.body), ['', ''])
  assert.deepEqual(items.map((item) => item.summary), [undefined, undefined])
})
