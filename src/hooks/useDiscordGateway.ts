import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../types'

export type DiscordStatus = {
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  botUsername: string | null
  lastError: string | null
}

export type DiscordIncoming = {
  channelId: string
  guildId: string | null
  guildName: string | null
  channelName: string
  fromUser: string
  fromUserId: string
  text: string
  messageId: string
  timestamp: string
}

export type UseDiscordGatewayOptions = {
  settingsRef: React.RefObject<AppSettings>
  onMessage: (msg: DiscordIncoming) => void
  enabled: boolean
}

export function useDiscordGateway({
  settingsRef,
  onMessage,
  enabled,
}: UseDiscordGatewayOptions) {
  const [status, setStatus] = useState<DiscordStatus>({
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
      void window.desktopPet?.discordDisconnect?.()
      setStatus({ state: 'disconnected', botUsername: null, lastError: null })
      return
    }

    const settings = settingsRef.current
    const botToken = settings.discordBotToken?.trim()
    if (!botToken) return

    const allowedChannelIds = settings.discordAllowedChannelIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    setStatus((prev) => ({ ...prev, state: 'connecting', lastError: null }))

    window.desktopPet?.discordConnect?.({ botToken, allowedChannelIds })
      .then((s) => {
        setStatus({
          state: s.state as DiscordStatus['state'],
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
      void window.desktopPet?.discordDisconnect?.()
    }
  }, [enabled, settingsRef])

  // Subscribe to incoming messages
  useEffect(() => {
    if (!enabled) return

    const unsubscribe = window.desktopPet?.subscribeDiscordMessage?.((msg) => {
      onMessageRef.current(msg)
    })

    return () => {
      unsubscribe?.()
    }
  }, [enabled])

  const sendMessage = useCallback(async (channelId: string, text: string, replyToMessageId?: string) => {
    await window.desktopPet?.discordSendMessage?.({ channelId, text, replyToMessageId })
  }, [])

  const refreshStatus = useCallback(async () => {
    const s = await window.desktopPet?.discordStatus?.()
    if (s) {
      setStatus({
        state: s.state as DiscordStatus['state'],
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
