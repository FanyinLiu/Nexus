import type { AppSettings, DebugConsoleEventSource, TranslationKey } from '../../types'
import type { DiscordIncoming } from '../../hooks/useDiscordGateway'
import {
  buildBridgeAnnouncementDebugDetail,
  buildBridgeIncomingDebugDetail,
  buildBridgeOwnerChatForwardText,
  shouldForwardBridgeIncomingToChat,
} from '../../lib/privacy/bridgeMessagePrivacy.ts'
import { parseCsvIdSet } from './bridgeUtils.ts'
import { buildMessagingAnnouncementContent, getDiscordAnnouncementSettings } from './messagingAnnouncement.ts'

type Translate = (key: TranslationKey, params?: Record<string, string>) => string

export type DiscordRouteSettings = Pick<
  AppSettings,
  'ownerDiscordUserIds' | 'discordAnnounceIncomingEnabled' | 'discordAnnounceMessagePreview'
>

export type DiscordRouteDeps = {
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

export function routeDiscordMessage(
  msg: DiscordIncoming,
  settings: DiscordRouteSettings,
  t: Translate,
  deps: DiscordRouteDeps,
): { isOwner: boolean } {
  const ownerUserIds = parseCsvIdSet(settings.ownerDiscordUserIds)
  const isOwner = ownerUserIds.has(msg.fromUserId)

  deps.appendDebugConsoleEvent({
    source: 'autonomy',
    title: 'Discord message',
    detail: buildBridgeIncomingDebugDetail({
      source: 'Discord',
      container: msg.channelName,
      sender: msg.fromUser,
      isOwner,
      ownerSuffix: t('chat.bridge.owner_suffix'),
      text: msg.text,
    }),
  })

  const announcement = buildMessagingAnnouncementContent(
    {
      sourceId: 'discord',
      sourceName: 'Discord',
      targetId: msg.channelId,
      messageId: msg.messageId,
      sender: msg.fromUser,
      fallbackTitle: msg.channelName,
      text: msg.text,
    },
    getDiscordAnnouncementSettings(settings),
    t,
  )
  if (announcement && deps.pushCompanionNotice) {
    deps.appendDebugConsoleEvent({
      source: 'autonomy',
      title: 'Discord announcement',
      detail: buildBridgeAnnouncementDebugDetail({
        source: 'Discord',
        sender: msg.fromUser,
        text: msg.text,
      }),
    })
    void deps.pushCompanionNotice({
      ...announcement,
      autoHideMs: 10_000,
    })
  }

  if (deps.sendMessage && shouldForwardBridgeIncomingToChat({ isOwner, text: msg.text })) {
    void deps.sendMessage(buildBridgeOwnerChatForwardText('Discord', msg.text), { source: 'discord' })
  }

  return { isOwner }
}
