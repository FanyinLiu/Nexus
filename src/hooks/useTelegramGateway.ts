import { useCallback, useEffect, useRef, useState } from 'react'
import { parseTelegramChatIdList } from '../features/integrations/allowlists.ts'
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
  // Status updates are made during render (on enabled-prop transitions) or from
  // async callbacks — never synchronously inside an effect — so the React 19
  // set-state-in-effect rule stays satisfied. The effect below only owns the
  // side effect of calling into the desktop bridge.
  const [status, setStatus] = useState<TelegramStatus>(() => (
    enabled
      ? { state: 'connecting', botUsername: null, lastError: null }
      : { state: 'disconnected', botUsername: null, lastError: null }
  ))
  const [prevEnabled, setPrevEnabled] = useState(enabled)
  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled)
    if (enabled) {
      setStatus((prev) => ({ ...prev, state: 'connecting', lastError: null }))
    } else {
      setStatus({ state: 'disconnected', botUsername: null, lastError: null })
    }
  }
  const onMessageRef = useRef(onMessage)

  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  // Connect/disconnect based on enabled toggle
  useEffect(() => {
    if (!enabled) {
      void window.desktopPet?.telegramDisconnect?.()
      return
    }

    const settings = settingsRef.current
    const botToken = settings.telegramBotToken?.trim()
    if (!botToken) return

    const allowedChatIds = parseTelegramChatIdList(settings.telegramAllowedChatIds)

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
