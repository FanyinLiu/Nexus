import { useCallback, useEffect, useRef, useState } from 'react'
import { parseTelegramChatIdList } from '../features/integrations/allowlists.ts'

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
  /** Non-text message kind (photo/voice/sticker/...), or null for a text message. */
  media?: string | null
  messageId: number
  timestamp: string
  /** Voice-note audio (downloaded by the gateway) for STT, when media === 'voice'. */
  voiceBase64?: string | null
  voiceMimeType?: string | null
}

export type UseTelegramGatewayOptions = {
  botToken: string
  allowedChatIds: string
  onMessage: (msg: TelegramIncoming) => void
  enabled: boolean
}

export function useTelegramGateway({
  botToken,
  allowedChatIds,
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

  // Connect/disconnect on enable toggle AND on credential changes, so editing
  // the bot token or allow-list while enabled re-applies to the live connection
  // (reconnect = disconnect-then-connect) instead of keeping stale credentials.
  useEffect(() => {
    if (!enabled) {
      void window.desktopPet?.telegramDisconnect?.()
      return
    }

    const token = botToken?.trim()
    if (!token) return

    const allowed = parseTelegramChatIdList(allowedChatIds)

    window.desktopPet?.telegramConnect?.({ botToken: token, allowedChatIds: allowed })
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
  }, [enabled, botToken, allowedChatIds])

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
