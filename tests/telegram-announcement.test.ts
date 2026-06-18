import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildTelegramAnnouncementContent,
  getTelegramAnnouncementPreview,
  getTelegramAnnouncementSender,
  type TelegramAnnouncementMessage,
} from '../src/app/controllers/telegramAnnouncement.ts'
import {
  buildMessagingDedupeKey,
  buildMessagingAnnouncementContent,
  getDiscordAnnouncementSettings,
} from '../src/app/controllers/messagingAnnouncement.ts'
import {
  buildLocalMessagingAnnouncementContent,
  shouldSuppressLocalNativeBridgeEcho,
} from '../src/app/controllers/localMessagingAnnouncement.ts'
import {
  routeTelegramMessage,
  type TelegramRouteDeps,
} from '../src/app/controllers/telegramMessageRouter.ts'
import type { TelegramIncoming } from '../src/hooks/useTelegramGateway.ts'
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
  assert.equal(result.dedupeKey, buildMessagingDedupeKey({
    sourceId: 'telegram',
    sourceName: 'Telegram',
    targetId: '42',
    messageId: '1001',
    sender: 'Klein',
    fallbackTitle: 'Product chat',
    text: message.text,
  }))
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
  assert.equal(result.dedupeKey, buildMessagingDedupeKey({
    sourceId: 'discord',
    sourceName: 'Discord',
    targetId: 'channel-1',
    messageId: 'msg-1',
    sender: 'Ada',
    fallbackTitle: 'general',
    text: 'private deployment note',
  }))
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

test('native and macOS Telegram announcements share a cross-pipeline dedupe key', () => {
  const nativeKey = buildMessagingDedupeKey({
    sourceId: 'telegram',
    sourceName: 'Telegram',
    targetId: '42',
    messageId: '1001',
    sender: 'Klein',
    fallbackTitle: 'Product chat',
    text: 'please check the release gate before shipping',
  })
  const macosKey = buildMessagingDedupeKey({
    sourceId: 'org.telegram.desktop',
    sourceName: 'Telegram',
    targetId: 'org.telegram.desktop:Product chat',
    messageId: 'org.telegram.desktop:row-987',
    sender: 'Klein',
    fallbackTitle: 'Product chat',
    text: 'please check the release gate before shipping',
  })

  assert.equal(nativeKey, macosKey)
  assert.match(nativeKey, /^message-xpipe:telegram:/)
})

test('local native bridge echo suppression only covers enabled native bridge sources', () => {
  const telegramMessage = {
    id: 'local-telegram',
    channelId: 'webhook',
    channelName: 'Telegram',
    kind: 'message' as const,
    sourceId: 'org.telegram.desktop',
    sourceName: 'Telegram',
    conversationId: 'org.telegram.desktop:Product chat',
    messageId: 'org.telegram.desktop:row-987',
    sender: 'Klein',
    title: 'Product chat',
    body: 'please check the release gate before shipping',
    receivedAt: new Date(0).toISOString(),
    read: false,
  }

  assert.equal(shouldSuppressLocalNativeBridgeEcho(telegramMessage, {
    discordBotToken: '',
    discordIntegrationEnabled: false,
    telegramBotToken: 'telegram-token',
    telegramIntegrationEnabled: true,
  }), true)
  assert.equal(shouldSuppressLocalNativeBridgeEcho(telegramMessage, {
    discordBotToken: '',
    discordIntegrationEnabled: false,
    telegramBotToken: '',
    telegramIntegrationEnabled: true,
  }), false)
  assert.equal(shouldSuppressLocalNativeBridgeEcho({
    ...telegramMessage,
    id: 'local-wechat',
    sourceId: 'wechat',
    sourceName: '微信',
  }, {
    discordBotToken: '',
    discordIntegrationEnabled: true,
    telegramBotToken: 'telegram-token',
    telegramIntegrationEnabled: true,
  }), false)
})

test('telegram media announcement stays generic and never leaks content even with preview on', () => {
  const result = buildTelegramAnnouncementContent(
    { ...message, text: '', media: 'photo' },
    {
      telegramAnnounceIncomingEnabled: true,
      telegramAnnounceMessagePreview: true,
    },
    t,
  )

  assert.ok(result)
  assert.match(result.dedupeKey, /^message-xpipe:telegram:/)
  assert.equal(result.speechContent, 'chat.bridge.messaging_announcement_speech_media|Klein|')
  assert.equal(result.chatContent.startsWith('chat.bridge.messaging_announcement_chat_media'), true)
})

// ── routeTelegramMessage: the IPC → bridge → announce/forward seam ────────────

function makeIncoming(overrides: Partial<TelegramIncoming> = {}): TelegramIncoming {
  return {
    chatId: 42,
    chatTitle: 'Product chat',
    fromUser: 'Klein',
    text: 'please check the release gate before shipping',
    media: null,
    messageId: 1001,
    timestamp: new Date(0).toISOString(),
    ...overrides,
  }
}

function makeDeps() {
  const notices: Array<{ chatContent: string; speechContent?: string; autoHideMs?: number }> = []
  const sends: Array<{ text?: string; options?: { source?: string } }> = []
  const debug: Array<{ title: string; detail: string }> = []
  const deps: TelegramRouteDeps = {
    appendDebugConsoleEvent: (event) => { debug.push({ title: event.title, detail: event.detail }) },
    pushCompanionNotice: async (payload) => { notices.push(payload) },
    sendMessage: async (text, options) => { sends.push({ text, options }); return undefined },
  }
  return { notices, sends, debug, deps }
}

test('routeTelegramMessage announces and forwards a text message', () => {
  const { notices, sends, debug, deps } = makeDeps()
  const out = routeTelegramMessage(
    makeIncoming(),
    { ownerTelegramChatIds: '', telegramAnnounceIncomingEnabled: true, telegramAnnounceMessagePreview: false },
    t,
    deps,
  )

  assert.equal(out.isOwner, false)
  assert.equal(notices.length, 1)
  assert.equal(notices[0].speechContent, 'chat.bridge.messaging_announcement_speech|Klein|')
  assert.equal(notices[0].autoHideMs, 10_000)
  assert.equal(sends.length, 1)
  assert.equal(sends[0].text, '【Telegram · Klein】please check the release gate before shipping')
  assert.equal(sends[0].options?.source, 'telegram')
  assert.deepEqual(debug.map((d) => d.title), ['Telegram message', 'Telegram announcement'])
})

test('routeTelegramMessage stays silent when announce is off but still forwards to chat', () => {
  const { notices, sends, deps } = makeDeps()
  routeTelegramMessage(
    makeIncoming(),
    { ownerTelegramChatIds: '', telegramAnnounceIncomingEnabled: false, telegramAnnounceMessagePreview: false },
    t,
    deps,
  )

  assert.equal(notices.length, 0)
  assert.equal(sends.length, 1)
})

test('routeTelegramMessage announces media generically and does NOT forward it to chat', () => {
  const { notices, sends, deps } = makeDeps()
  routeTelegramMessage(
    makeIncoming({ text: '', media: 'sticker' }),
    { ownerTelegramChatIds: '', telegramAnnounceIncomingEnabled: true, telegramAnnounceMessagePreview: true },
    t,
    deps,
  )

  assert.equal(notices.length, 1)
  assert.equal(notices[0].speechContent, 'chat.bridge.messaging_announcement_speech_media|Klein|')
  assert.equal(sends.length, 0)
})

test('routeTelegramMessage promotes an owner chat to an unnamed master prefix', () => {
  const { sends, debug, deps } = makeDeps()
  const out = routeTelegramMessage(
    makeIncoming(),
    { ownerTelegramChatIds: '42', telegramAnnounceIncomingEnabled: true, telegramAnnounceMessagePreview: false },
    t,
    deps,
  )

  assert.equal(out.isOwner, true)
  assert.equal(sends[0].text, '【Telegram】please check the release gate before shipping')
  assert.ok(debug[0].detail.includes('chat.bridge.owner_suffix'))
})
