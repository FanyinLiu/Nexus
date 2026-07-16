import { useCallback, useEffect, useRef, useState } from 'react'
import { parseDiscordChannelIdList } from '../features/integrations/allowlists.ts'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'

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
  botToken: string
  allowedChannelIds: string
  onMessage: (msg: DiscordIncoming) => void
  enabled: boolean
  /** Only the background owner may touch the shared main-process gateway. */
  runtimeOwner?: boolean
}

export function useDiscordGateway({
  botToken,
  allowedChannelIds,
  onMessage,
  enabled,
  runtimeOwner = true,
}: UseDiscordGatewayOptions) {
  const featureEnabled = enabled && runtimeOwner
  // Status updates are made during render (on enabled-prop transitions) or from
  // async callbacks — never synchronously inside an effect — so the React 19
  // set-state-in-effect rule stays satisfied. The effect below only owns the
  // side effect of calling into the desktop bridge.
  const [status, setStatus] = useState<DiscordStatus>(() => (
    featureEnabled
      ? { state: 'connecting', botUsername: null, lastError: null }
      : { state: 'disconnected', botUsername: null, lastError: null }
  ))
  const [prevFeatureEnabled, setPrevFeatureEnabled] = useState(featureEnabled)
  if (featureEnabled !== prevFeatureEnabled) {
    setPrevFeatureEnabled(featureEnabled)
    if (featureEnabled) {
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
    if (!runtimeOwner) return
    if (!enabled) {
      void window.desktopPet?.discordDisconnect?.()
      return
    }

    const token = botToken?.trim()
    if (!token) return

    const allowed = parseDiscordChannelIdList(allowedChannelIds)

    window.desktopPet?.discordConnect?.({ botToken: token, allowedChannelIds: allowed })
      .then((s) => {
        setStatus({
          state: s.state as DiscordStatus['state'],
          botUsername: s.botUsername,
          lastError: s.lastError ? getRedactedLogErrorMessage(s.lastError) : null,
        })
      })
      .catch((err) => {
        setStatus({
          state: 'error',
          botUsername: null,
          lastError: getRedactedLogErrorMessage(err),
        })
      })

    return () => {
      void window.desktopPet?.discordDisconnect?.()
    }
  }, [runtimeOwner, enabled, botToken, allowedChannelIds])

  // Subscribe to incoming messages
  useEffect(() => {
    if (!runtimeOwner) return
    if (!enabled) return

    const unsubscribe = window.desktopPet?.subscribeDiscordMessage?.((msg) => {
      onMessageRef.current(msg)
    })

    return () => {
      unsubscribe?.()
    }
  }, [runtimeOwner, enabled])

  const sendMessage = useCallback(async (channelId: string, text: string, replyToMessageId?: string) => {
    await window.desktopPet?.discordSendMessage?.({ channelId, text, replyToMessageId })
  }, [])

  const refreshStatus = useCallback(async () => {
    const s = await window.desktopPet?.discordStatus?.()
    if (s) {
      setStatus({
        state: s.state as DiscordStatus['state'],
        botUsername: s.botUsername,
        lastError: s.lastError ? getRedactedLogErrorMessage(s.lastError) : null,
      })
    }
  }, [])

  return {
    status,
    sendMessage,
    refreshStatus,
  }
}
