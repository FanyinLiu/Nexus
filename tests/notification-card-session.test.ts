import assert from 'node:assert/strict'
import test from 'node:test'

import { enChat } from '../src/i18n/locales/en/chat.ts'
import { jaChat } from '../src/i18n/locales/ja/chat.ts'
import { koChat } from '../src/i18n/locales/ko/chat.ts'
import { zhCNChat } from '../src/i18n/locales/zh-CN/chat.ts'
import { zhTWChat } from '../src/i18n/locales/zh-TW/chat.ts'
import {
  buildNotificationReplyComposerText,
  canReplyToNotificationCard,
  captionRepeatsVisibleNotification,
  createNotificationReplyTarget,
  deliverNotificationReply,
  getNotificationCardBadge,
  getNotificationReplySource,
  NOTIFICATION_CARD_SNOOZE_MINUTES,
  planNotificationPrimaryAction,
  planNotificationReplyCompose,
  selectVisibleNotificationCards,
  shouldAppendNotificationChatLine,
  shouldCompleteNotificationReply,
  VISIBLE_NOTIFICATION_CARD_LIMIT,
} from '../src/features/notifications/notificationCardSession.ts'
import type { NotificationMessage } from '../src/types/autonomy.ts'
import type { TranslationKey, TranslationParams } from '../src/types/i18n.ts'

function makeMessage(overrides: Partial<NotificationMessage> = {}): NotificationMessage {
  return {
    id: 'msg-1',
    channelId: 'telegram',
    channelName: 'Telegram',
    kind: 'message',
    sourceId: 'telegram',
    sourceName: 'Telegram',
    conversationId: ' 1001 ',
    messageId: ' 55 ',
    sender: 'Alice',
    title: 'Friday design review',
    body: 'private dinner plan and one-time code 123456',
    summary: 'private summary that should stay off the draft',
    receivedAt: '2026-10-16T00:00:00.000Z',
    read: false,
    ...overrides,
  }
}

function translate(key: TranslationKey, params?: TranslationParams): string {
  return [key, params?.source ?? '', params?.sender ?? ''].filter(Boolean).join('|')
}

function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => params[key] ?? '')
}

test('visible cards keep the newest unread messages and skip read or snoozed ones', () => {
  const messages = [
    makeMessage({ id: 'new', read: false }),
    makeMessage({ id: 'read', read: true }),
    makeMessage({ id: 'snoozed', snoozedUntil: '2099-01-01T00:00:00.000Z' }),
    makeMessage({ id: 'second' }),
    makeMessage({ id: 'third' }),
    makeMessage({ id: 'fourth' }),
  ]

  const visible = selectVisibleNotificationCards(messages)

  assert.equal(VISIBLE_NOTIFICATION_CARD_LIMIT, 3)
  assert.deepEqual(visible.map((message) => message.id), ['new', 'second', 'third'])
})

test('telegram and discord cards can reply only when that bridge is available', () => {
  const telegram = makeMessage()
  const discord = makeMessage({ sourceId: 'discord', sourceName: 'Discord' })
  const alias = makeMessage({ sourceId: 'tg', sourceName: '' })
  const rss = makeMessage({ kind: 'notification', sourceId: 'rss', sourceName: 'RSS' })

  assert.equal(getNotificationReplySource(telegram), 'telegram')
  assert.equal(getNotificationReplySource(discord), 'discord')
  assert.equal(getNotificationReplySource(alias), 'telegram')
  assert.equal(getNotificationReplySource(rss), null)
  assert.equal(canReplyToNotificationCard(telegram, { telegram: true, discord: false }), true)
  assert.equal(canReplyToNotificationCard(telegram, { telegram: false, discord: true }), false)
  assert.equal(canReplyToNotificationCard(discord, { telegram: false, discord: true }), true)
  assert.equal(canReplyToNotificationCard(rss, { telegram: true, discord: true }), false)
  assert.equal(canReplyToNotificationCard(
    makeMessage({ kind: 'notification', sourceId: 'telegram' }),
    { telegram: true, discord: true },
  ), false)
})

test('reply target keeps bridge ids and the card actions do not copy message content', () => {
  const message = makeMessage()
  const target = createNotificationReplyTarget(message)
  assert.deepEqual(target, {
    source: 'telegram',
    conversationId: '1001',
    messageId: '55',
    notificationMessageId: 'msg-1',
  })
  assert.equal(createNotificationReplyTarget(makeMessage({ sourceId: 'rss', sourceName: 'RSS' })), null)

  const draft = planNotificationPrimaryAction('draft_reply', message, translate)
  assert.equal(draft.type, 'compose')
  if (draft.type === 'compose') {
    assert.equal(draft.reply, undefined)
    assert.match(draft.text, /panel\.notification\.draft_reply/)
    assert.doesNotMatch(draft.text, /private dinner|one-time code|private summary/)
  }

  const reply = planNotificationReplyCompose(message)
  assert.ok(reply)
  assert.equal(reply?.reply.source, 'telegram')
  assert.equal(reply?.text, '')
  assert.equal(buildNotificationReplyComposerText(), '')
  assert.doesNotMatch(reply?.text ?? '', /private dinner|private summary|reply_to/)

  const important = planNotificationPrimaryAction('mark_important', message, translate)
  assert.deepEqual(important, { type: 'toggle_important', messageId: 'msg-1' })
  const snooze = planNotificationPrimaryAction('snooze_later', message, translate)
  assert.deepEqual(snooze, {
    type: 'snooze_and_read',
    messageId: 'msg-1',
    delayMinutes: NOTIFICATION_CARD_SNOOZE_MINUTES,
  })
  assert.equal(NOTIFICATION_CARD_SNOOZE_MINUTES, 30)
})

test('a card reply is completed only when the bridge accepts it', async () => {
  const target = createNotificationReplyTarget(makeMessage())
  assert.ok(target)

  assert.equal(await deliverNotificationReply(target, '   ', {
    telegram: () => true,
  }), 'empty')
  assert.equal(await deliverNotificationReply(target, 'On my way', {}), 'unsupported')
  assert.equal(await deliverNotificationReply(target, 'On my way', {
    telegram: () => false,
  }), 'failed')

  const sent: string[] = []
  assert.equal(await deliverNotificationReply(target, ' On my way ', {
    telegram: async (text, conversationId, messageId) => {
      sent.push(`${text}|${conversationId}|${messageId}`)
      return true
    },
  }), 'sent')
  assert.deepEqual(sent, ['On my way|1001|55'])
  assert.equal(shouldCompleteNotificationReply('sent'), true)
  assert.equal(shouldCompleteNotificationReply('failed'), false)
  assert.equal(shouldCompleteNotificationReply('unsupported'), false)
  assert.equal(shouldCompleteNotificationReply('empty'), false)
})

test('announcement captions in every locale repeat a visible card, other lines do not', () => {
  const card = makeMessage({ sender: 'Alice', sourceName: 'Telegram', sourceId: 'telegram' })
  const locales = [enChat, zhCNChat, zhTWChat, jaChat, koChat]
  for (const locale of locales) {
    const caption = fill(locale['chat.bridge.messaging_announcement_chat'], {
      source: 'Telegram',
      sender: 'Alice',
    })
    assert.equal(captionRepeatsVisibleNotification(caption, [card]), true, caption)
    const forward = fill(locale['chat.prefix.desktop_message'], {
      source: 'Telegram',
      sender: 'Alice',
    })
    assert.equal(captionRepeatsVisibleNotification(forward, [card]), true, forward)
  }

  assert.equal(captionRepeatsVisibleNotification('Want to take a walk later?', [card]), false)
  assert.equal(captionRepeatsVisibleNotification('Telegram is down today', [card]), false)
  assert.equal(
    captionRepeatsVisibleNotification('private summary that should stay off the draft', [card]),
    true,
  )
  assert.equal(captionRepeatsVisibleNotification('Alice sent a note', []), false)
  assert.equal(captionRepeatsVisibleNotification(undefined, [card]), false)
})

test('cards show an app mark for telegram and discord, and a letter otherwise', () => {
  assert.equal(getNotificationCardBadge(makeMessage()).kind, 'telegram')
  assert.equal(getNotificationCardBadge(makeMessage({ sourceId: 'discord', sourceName: 'Discord' })).kind, 'discord')
  assert.deepEqual(
    getNotificationCardBadge(makeMessage({
      sourceId: 'wechat',
      sourceName: '微信',
      sender: '林夏',
    })),
    { kind: 'initial', letter: '林' },
  )
})

test('a notification is not copied into the chat transcript', () => {
  assert.equal(shouldAppendNotificationChatLine(), false)
})
