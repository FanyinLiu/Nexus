import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildTelegramAnnouncementContent,
  getTelegramAnnouncementPreview,
  getTelegramAnnouncementSender,
  type TelegramAnnouncementMessage,
} from '../src/app/controllers/telegramAnnouncement.ts'
import {
  buildMessagingAnnouncementContent,
  getDiscordAnnouncementSettings,
} from '../src/app/controllers/messagingAnnouncement.ts'
import { buildLocalMessagingAnnouncementContent } from '../src/app/controllers/localMessagingAnnouncement.ts'
import type { TranslationKey } from '../src/types/i18n.ts'

const message: TelegramAnnouncementMessage = {
  chatId: 42,
  chatTitle: 'Product chat',
  fromUser: 'Klein',
  text: 'please check the release gate before shipping',
  messageId: 1001,
}

function t(key: TranslationKey, params: Record<string, string> = {}) {
  return `${key}|${params.sender ?? ''}|${params.text ?? ''}`
}

test('telegram announcement stays silent until explicitly enabled', () => {
  const result = buildTelegramAnnouncementContent(
    message,
    {
      telegramAnnounceIncomingEnabled: false,
      telegramAnnounceMessagePreview: true,
    },
    t,
  )

  assert.equal(result, null)
})

test('telegram announcement omits message text unless preview is enabled', () => {
  const result = buildTelegramAnnouncementContent(
    message,
    {
      telegramAnnounceIncomingEnabled: true,
      telegramAnnounceMessagePreview: false,
    },
    t,
  )

  assert.ok(result)
  assert.equal(result.dedupeKey, 'message:telegram:42:1001')
  assert.equal(result.speechContent, 'chat.bridge.messaging_announcement_speech|Klein|')
  assert.equal(result.speechContent.includes(message.text), false)
})

test('telegram announcement can include a normalized bounded preview', () => {
  const result = buildTelegramAnnouncementContent(
    {
      ...message,
      text: `  ${'x'.repeat(120)}\n\nsecond line`,
    },
    {
      telegramAnnounceIncomingEnabled: true,
      telegramAnnounceMessagePreview: true,
    },
    t,
  )

  assert.ok(result)
  assert.equal(result.speechContent.startsWith('chat.bridge.messaging_announcement_speech_preview|Klein|'), true)
  assert.equal(result.speechContent.includes('\n'), false)
  assert.ok(getTelegramAnnouncementPreview('x'.repeat(120)).endsWith('...'))
})

test('telegram announcement falls back to chat title when sender is missing', () => {
  assert.equal(
    getTelegramAnnouncementSender({
      ...message,
      fromUser: '',
      chatTitle: 'Release room',
    }),
    'Release room',
  )
})

test('discord announcement uses the same privacy defaults and unique message key', () => {
  const result = buildMessagingAnnouncementContent(
    {
      sourceId: 'discord',
      sourceName: 'Discord',
      targetId: 'channel-1',
      messageId: 'msg-1',
      sender: 'Ada',
      fallbackTitle: 'general',
      text: 'private deployment note',
    },
    getDiscordAnnouncementSettings({
      discordAnnounceIncomingEnabled: true,
      discordAnnounceMessagePreview: false,
    }),
    t,
  )

  assert.ok(result)
  assert.equal(result.dedupeKey, 'message:discord:channel-1:msg-1')
  assert.equal(result.speechContent, 'chat.bridge.messaging_announcement_speech|Ada|')
  assert.equal(result.speechContent.includes('private deployment note'), false)
})

test('generic messaging announcement includes source in localized params', () => {
  const result = buildMessagingAnnouncementContent(
    {
      sourceId: 'wechat',
      sourceName: 'WeChat',
      targetId: 'room-1',
      messageId: 'msg-2',
      sender: '',
      fallbackTitle: '项目群',
      text: '  ship it\nnow ',
    },
    {
      announceIncomingEnabled: true,
      announceMessagePreview: true,
    },
    (key, params = {}) => `${key}|${params.source ?? ''}|${params.sender ?? ''}|${params.text ?? ''}`,
  )

  assert.ok(result)
  assert.equal(result.speechContent, 'chat.bridge.messaging_announcement_speech_preview|WeChat|项目群|ship it now')
})

test('local webhook messages stay silent until message announcements are enabled', () => {
  const result = buildLocalMessagingAnnouncementContent(
    {
      id: 'local-1',
      channelId: 'webhook',
      channelName: '微信',
      kind: 'message',
      sourceId: 'wechat',
      sourceName: '微信',
      conversationId: 'room-1',
      messageId: 'msg-3',
      sender: '张三',
      title: '项目群',
      body: '晚上同步一下',
      receivedAt: new Date(0).toISOString(),
      read: false,
    },
    {
      autonomyNotificationMessageAnnouncementsEnabled: false,
      autonomyNotificationMessagePreviewEnabled: true,
    },
    t,
  )

  assert.equal(result, null)
})

test('local webhook messages use source, sender, preview, and provided message id', () => {
  const result = buildLocalMessagingAnnouncementContent(
    {
      id: 'local-1',
      channelId: 'webhook',
      channelName: '企业微信',
      kind: 'message',
      sourceId: 'wecom',
      sourceName: '企业微信',
      conversationId: 'room-2',
      messageId: 'msg-4',
      sender: '李四',
      title: '发布群',
      body: '  麻烦看下发布清单\n谢谢 ',
      receivedAt: new Date(0).toISOString(),
      read: false,
    },
    {
      autonomyNotificationMessageAnnouncementsEnabled: true,
      autonomyNotificationMessagePreviewEnabled: true,
    },
    (key, params = {}) => `${key}|${params.source ?? ''}|${params.sender ?? ''}|${params.text ?? ''}`,
  )

  assert.ok(result)
  assert.equal(result.dedupeKey, 'message:wecom:room-2:msg-4')
  assert.equal(result.speechContent, 'chat.bridge.messaging_announcement_speech_preview|企业微信|李四|麻烦看下发布清单 谢谢')
})
