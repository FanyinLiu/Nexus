import type { AppSettings, DebugConsoleEventSource, TranslationKey } from '../../types'
import type { TelegramIncoming } from '../../hooks/useTelegramGateway'
import {
  buildBridgeAnnouncementDebugDetail,
  buildBridgeIncomingDebugDetail,
  buildBridgeOwnerChatForwardText,
  shouldForwardBridgeIncomingToChat,
} from '../../lib/privacy/bridgeMessagePrivacy.ts'
import { parseCsvIdSet } from './bridgeUtils.ts'
import { buildTelegramAnnouncementContent } from './telegramAnnouncement.ts'

type Translate = (key: TranslationKey, params?: Record<string, string>) => string

export type TelegramRouteSettings = Pick<
  AppSettings,
  'ownerTelegramChatIds' | 'telegramAnnounceIncomingEnabled' | 'telegramAnnounceMessagePreview'
>

export type TelegramRouteDeps = {
  appendDebugConsoleEvent: (event: {
    source: DebugConsoleEventSource
    title: string
    detail: string
  }) => void
  pushCompanionNotice?: (payload: {
    chatContent: string
    bubbleContent?: string
    speechContent?: string
    dedupeKey?: string
    autoHideMs?: number
  }) => Promise<void>
  sendMessage?: (
    text?: string,
    options?: { source?: 'text' | 'voice' | 'telegram' | 'discord' | 'notification'; traceId?: string },
  ) => Promise<unknown>
}

/**
 * Pure routing for one incoming Telegram message: emits debug events, builds and
 * pushes the companion announce notice, and forwards only owner-originated text
 * into the companion chat. External contacts are local announcements only. No
 * React and no side effects beyond the injected deps, so this bridge path is
 * unit-testable.
 *
 * Returns whether the message was owner-originated so the caller can keep its own
 * per-chat reply bookkeeping.
 */
export function routeTelegramMessage(
  msg: TelegramIncoming,
  settings: TelegramRouteSettings,
  t: Translate,
  deps: TelegramRouteDeps,
): { isOwner: boolean } {
  const ownerChatIds = parseCsvIdSet(settings.ownerTelegramChatIds)
  // Until the master declares their own chatId(s), every incoming message is an
  // external contact (named prefix). Owner-listed chatIds are promoted to
  // "master via Telegram".
  const isOwner = ownerChatIds.has(String(msg.chatId))

  deps.appendDebugConsoleEvent({
    source: 'autonomy',
    title: 'Telegram message',
    detail: buildBridgeIncomingDebugDetail({
      source: 'Telegram',
      container: msg.chatTitle,
      sender: msg.fromUser,
      isOwner,
      ownerSuffix: t('chat.bridge.owner_suffix'),
      text: msg.text,
      media: msg.media,
    }),
  })

  const announcement = buildTelegramAnnouncementContent(msg, settings, t)
  if (announcement && deps.pushCompanionNotice) {
    deps.appendDebugConsoleEvent({
      source: 'autonomy',
      title: 'Telegram announcement',
      detail: buildBridgeAnnouncementDebugDetail({
        source: 'Telegram',
        sender: msg.fromUser,
        text: msg.text,
        media: msg.media,
      }),
    })
    void deps.pushCompanionNotice({
      ...announcement,
      autoHideMs: 10_000,
    })
  }

  if (deps.sendMessage && shouldForwardBridgeIncomingToChat({ isOwner, text: msg.text })) {
    void deps.sendMessage(buildBridgeOwnerChatForwardText('Telegram', msg.text), { source: 'telegram' })
  }

  return { isOwner }
}
