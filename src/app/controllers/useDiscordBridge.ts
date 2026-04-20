import { useCallback, useEffect, useRef } from 'react'
import type { AppSettings, DebugConsoleEventSource } from '../../types'
import { useDiscordGateway, type DiscordIncoming } from '../../hooks/useDiscordGateway'
import { rememberDiscordChannelId } from '../../lib/coreRuntime'
import { isActionAllowed } from '../../features/integrations/permissions'
import { parseCsvIdSet } from './bridgeUtils'
import { useTranslation } from '../../i18n/useTranslation.ts'

type ChatBridge = {
  sendMessage?: (
    text?: string,
    options?: { source?: 'text' | 'voice' | 'telegram' | 'discord'; traceId?: string },
  ) => Promise<unknown>
}

type DebugConsoleBridge = {
  appendDebugConsoleEvent: (event: {
    source: DebugConsoleEventSource
    title: string
    detail: string
  }) => void
}

export type UseDiscordBridgeOptions = {
  settingsRef: React.RefObject<AppSettings>
  enabled: boolean
  chat: ChatBridge
  debugConsole: DebugConsoleBridge
}

export function useDiscordBridge({
  settingsRef,
  enabled,
  chat,
  debugConsole,
}: UseDiscordBridgeOptions) {
  const { t } = useTranslation()
  const lastDiscordChannelRef = useRef<{ channelId: string; messageId: string } | null>(null)
  // Per-channelId tracking so concurrent Discord channels don't overwrite each other.
  const discordChannelMapRef = useRef<Map<string, { channelId: string; messageId: string }>>(new Map())
  const discordSendMessageRef = useRef<(channelId: string, text: string, replyTo?: string) => Promise<void>>(undefined)

  const handleDiscordMessage = useCallback((msg: DiscordIncoming) => {
    const ownerUserIds = parseCsvIdSet(settingsRef.current.ownerDiscordUserIds)
    // Default: empty ownerDiscordUserIds means every incoming Discord message
    // is treated as an external contact. Only fromUserIds that match the
    // configured owner list are promoted to "master via Discord".
    const isOwner = ownerUserIds.has(msg.fromUserId)

    debugConsole.appendDebugConsoleEvent({
      source: 'autonomy',
      title: 'Discord message',
      detail: `[${msg.channelName}] ${msg.fromUser}${isOwner ? t('chat.bridge.owner_suffix') : ''}: ${msg.text}`,
    })

    // Forward to companion chat as a Discord-sourced message.
    // Owner-match → prefix without a name so the system prompt treats it as
    // the master speaking via Discord. Otherwise use the named prefix for
    // external contacts.
    if (chat.sendMessage) {
      const prefixedText = isOwner
        ? `【Discord】${msg.text}`
        : `【Discord · ${msg.fromUser}】${msg.text}`
      void chat.sendMessage(prefixedText, { source: 'discord' })
    }

    const channelEntry = { channelId: msg.channelId, messageId: msg.messageId }
    lastDiscordChannelRef.current = channelEntry
    discordChannelMapRef.current.set(msg.channelId, channelEntry)
    rememberDiscordChannelId(msg.channelId)
  }, [chat, debugConsole, settingsRef, t])

  const gateway = useDiscordGateway({
    settingsRef,
    onMessage: handleDiscordMessage,
    enabled,
  })

  useEffect(() => {
    discordSendMessageRef.current = gateway.sendMessage
  }, [gateway.sendMessage])

  // Send a reply back to a Discord channel. If channelId is provided, replies
  // to that specific channel; otherwise falls back to the most recent incoming.
  const replyTo = useCallback(async (text: string, channelId?: string) => {
    const target = channelId != null
      ? discordChannelMapRef.current.get(channelId) ?? lastDiscordChannelRef.current
      : lastDiscordChannelRef.current
    if (!target || !discordSendMessageRef.current) return
    if (!isActionAllowed(settingsRef.current, 'discord', 'send')) {
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Discord reply blocked',
        detail: `permission mode "${settingsRef.current.discordPermissionMode}" does not allow sending messages`,
      })
      return
    }
    await discordSendMessageRef.current(target.channelId, text)
  }, [debugConsole, settingsRef])

  return { gateway, replyTo }
}
