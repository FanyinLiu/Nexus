import { useCallback, useEffect, useRef } from 'react'
import type { AppSettings, DebugConsoleEventSource } from '../../types'
import { useTelegramGateway, type TelegramIncoming } from '../../hooks/useTelegramGateway'
import { rememberTelegramChatId } from '../../lib/coreRuntime'
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

export type UseTelegramBridgeOptions = {
  settingsRef: React.RefObject<AppSettings>
  enabled: boolean
  chat: ChatBridge
  debugConsole: DebugConsoleBridge
}

export function useTelegramBridge({
  settingsRef,
  enabled,
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
    settingsRef,
    onMessage: handleTelegramMessage,
    enabled,
  })

  useEffect(() => {
    telegramSendMessageRef.current = gateway.sendMessage
  }, [gateway.sendMessage])

  // Send a reply back to a Telegram chat. If chatId is provided, replies to
  // that specific chat; otherwise falls back to the most recent incoming chat.
  const replyTo = useCallback(async (text: string, chatId?: number) => {
    const target = chatId != null
      ? telegramChatMapRef.current.get(chatId) ?? lastTelegramChatRef.current
      : lastTelegramChatRef.current
    if (!target || !telegramSendMessageRef.current) return
    if (!isActionAllowed(settingsRef.current, 'telegram', 'send')) {
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Telegram reply blocked',
        detail: `permission mode "${settingsRef.current.telegramPermissionMode}" does not allow sending messages`,
      })
      return
    }
    await telegramSendMessageRef.current(target.chatId, text)
  }, [debugConsole, settingsRef])

  return { gateway, replyTo }
}
