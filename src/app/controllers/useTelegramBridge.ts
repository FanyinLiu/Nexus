import { useCallback, useEffect, useRef } from 'react'
import type { AppSettings, DebugConsoleEventSource } from '../../types'
import { useTelegramGateway, type TelegramIncoming } from '../../hooks/useTelegramGateway'
import { rememberTelegramChatId } from '../../lib/coreRuntime'
import { isActionAllowed } from '../../features/integrations/permissions'
import { parseCsvIdSet, resolveBridgeReplyTarget } from './bridgeUtils'
import { buildTelegramAnnouncementContent } from './telegramAnnouncement'
import { useTranslation } from '../../i18n/useTranslation.ts'

type ChatBridge = {
  pushCompanionNotice?: (payload: {
    chatContent: string
    bubbleContent?: string
    speechContent?: string
    dedupeKey?: string
    autoHideMs?: number
  }) => Promise<void>
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

export type UseTelegramBridgeOptions = {
  settingsRef: React.RefObject<AppSettings>
  enabled: boolean
  botToken: string
  allowedChatIds: string
  chat: ChatBridge
  debugConsole: DebugConsoleBridge
}

export function useTelegramBridge({
  settingsRef,
  enabled,
  botToken,
  allowedChatIds,
  chat,
  debugConsole,
}: UseTelegramBridgeOptions) {
  const { t } = useTranslation()
  const lastTelegramChatRef = useRef<{ chatId: number; messageId: number } | null>(null)
  // Per-chatId tracking so concurrent Telegram chats don't overwrite each other.
  const telegramChatMapRef = useRef<Map<number, { chatId: number; messageId: number }>>(new Map())
  const telegramSendMessageRef = useRef<(chatId: number, text: string, replyTo?: number) => Promise<void>>(undefined)

  const handleTelegramMessage = useCallback((msg: TelegramIncoming) => {
    const ownerChatIds = parseCsvIdSet(settingsRef.current.ownerTelegramChatIds)
    // Default: until the master explicitly declares their own chatId(s),
    // every incoming Telegram message is treated as an external contact
    // (named bridge prefix). Only chatIds that match the configured owner
    // list are promoted to "master via Telegram".
    const isOwner = ownerChatIds.has(String(msg.chatId))

    debugConsole.appendDebugConsoleEvent({
      source: 'autonomy',
      title: 'Telegram message',
      detail: `[${msg.chatTitle}] ${msg.fromUser}${isOwner ? t('chat.bridge.owner_suffix') : ''}: ${msg.text}`,
    })

    const announcement = buildTelegramAnnouncementContent(msg, settingsRef.current, t)
    if (announcement && chat.pushCompanionNotice) {
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Telegram announcement',
        detail: announcement.speechContent,
      })
      void chat.pushCompanionNotice({
        ...announcement,
        autoHideMs: 10_000,
      })
    }

    // Forward to companion chat as a Telegram-sourced message.
    // Owner-match → prefix without a name so the system prompt treats it as
    // the master speaking via Telegram. Otherwise keep the named prefix so
    // the model responds to the external contact directly.
    if (chat.sendMessage) {
      const prefixedText = isOwner
        ? `【Telegram】${msg.text}`
        : `【Telegram · ${msg.fromUser}】${msg.text}`
      void chat.sendMessage(prefixedText, { source: 'telegram' })
    }

    const chatEntry = { chatId: msg.chatId, messageId: msg.messageId }
    lastTelegramChatRef.current = chatEntry
    telegramChatMapRef.current.set(msg.chatId, chatEntry)
    rememberTelegramChatId(msg.chatId)
  }, [chat, debugConsole, settingsRef, t])

  const gateway = useTelegramGateway({
    botToken,
    allowedChatIds,
    onMessage: handleTelegramMessage,
    enabled,
  })

  useEffect(() => {
    telegramSendMessageRef.current = gateway.sendMessage
  }, [gateway.sendMessage])

  // Send a reply back to a Telegram chat. If chatId is provided, replies to
  // that specific chat; otherwise falls back to the most recent incoming chat.
  const replyTo = useCallback(async (
    text: string,
    chatId?: number | string,
    messageId?: number | string,
  ) => {
    const resolvedChatId = chatId === undefined
      ? undefined
      : typeof chatId === 'number' ? chatId : Number.parseInt(chatId, 10)
    const resolvedMessageId = messageId === undefined
      ? undefined
      : typeof messageId === 'number' ? messageId : Number.parseInt(messageId, 10)

    const target = resolveBridgeReplyTarget(
      telegramChatMapRef.current,
      lastTelegramChatRef.current,
      Number.isFinite(resolvedChatId) ? resolvedChatId : undefined,
    )
    if (!target || !telegramSendMessageRef.current) return
    if (!isActionAllowed(settingsRef.current, 'telegram', 'send')) {
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Telegram reply blocked',
        detail: `permission mode "${settingsRef.current.telegramPermissionMode}" does not allow sending messages`,
      })
      return
    }
    await telegramSendMessageRef.current(
      target.chatId,
      text,
      Number.isFinite(resolvedMessageId) ? resolvedMessageId : target.messageId,
    )
  }, [debugConsole, settingsRef])

  return { gateway, replyTo }
}
