import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../types'

export type TelegramStatus = {
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  botUsername: string | null
  lastError: string | null
}

export type TelegramIncoming = {
  chatId: number
  chatTitle: string
  fromUser: string
  text: string
  messageId: number
  timestamp: string
}

export type UseTelegramGatewayOptions = {
  settingsRef: React.RefObject<AppSettings>
  onMessage: (msg: TelegramIncoming) => void
  enabled: boolean
}

export function useTelegramGateway({
  settingsRef,
  onMessage,
  enabled,
}: UseTelegramGatewayOptions) {
  const [status, setStatus] = useState<TelegramStatus>({
    state: 'disconnected',
    botUsername: null,
    lastError: null,
  })
  const onMessageRef = useRef(onMessage)

  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  // Connect/disconnect based on enabled toggle
  useEffect(() => {
    if (!enabled) {
      void window.desktopPet?.telegramDisconnect?.()
      setStatus({ state: 'disconnected', botUsername: null, lastError: null })
      return
    }

    const settings = settingsRef.current
    const botToken = settings.telegramBotToken?.trim()
    if (!botToken) return

    const allowedChatIds = settings.telegramAllowedChatIds
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n !== 0)

    setStatus((prev) => ({ ...prev, state: 'connecting', lastError: null }))

    window.desktopPet?.telegramConnect?.({ botToken, allowedChatIds })
      .then((s) => {
        setStatus({
          state: s.state as TelegramStatus['state'],
          botUsername: s.botUsername,
          lastError: s.lastError,
        })
      })
      .catch((err) => {
        setStatus({
          state: 'error',
          botUsername: null,
          lastError: err instanceof Error ? err.message : String(err),
        })
      })

    return () => {
      void window.desktopPet?.telegramDisconnect?.()
    }
  }, [enabled, settingsRef])

  // Subscribe to incoming messages
  useEffect(() => {
    if (!enabled) return

    const unsubscribe = window.desktopPet?.subscribeTelegramMessage?.((msg) => {
      onMessageRef.current(msg)
    })

    return () => {
      unsubscribe?.()
    }
  }, [enabled])

  const sendMessage = useCallback(async (chatId: number, text: string, replyToMessageId?: number) => {
    await window.desktopPet?.telegramSendMessage?.({ chatId, text, replyToMessageId })
  }, [])

  const refreshStatus = useCallback(async () => {
    const s = await window.desktopPet?.telegramStatus?.()
    if (s) {
      setStatus({
        state: s.state as TelegramStatus['state'],
        botUsername: s.botUsername,
        lastError: s.lastError,
      })
    }
  }, [])

  return {
    status,
    sendMessage,
    refreshStatus,
  }
}
