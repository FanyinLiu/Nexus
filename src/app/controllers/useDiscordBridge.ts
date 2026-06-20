import { useCallback, useEffect, useRef } from 'react'
import type { AppSettings, DebugConsoleEventSource } from '../../types'
import type { AssistantReplyDeliveredPayload } from '../../hooks/chat/types.ts'
import { useDiscordGateway, type DiscordIncoming } from '../../hooks/useDiscordGateway'
import { rememberDiscordChannelId } from '../../lib/coreRuntime'
import { isActionAllowed } from '../../features/integrations/permissions'
import {
  type BridgeForwardQueue,
  createBridgeForwardQueue,
  decideBridgeAutoReply,
  resolveBridgeReplyTarget,
} from './bridgeUtils'
import { routeDiscordMessage } from './discordMessageRouter'
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
    options?: { source?: 'text' | 'voice' | 'telegram' | 'discord' | 'notification'; traceId?: string },
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
  botToken: string
  allowedChannelIds: string
  chat: ChatBridge
  busyRef: React.RefObject<boolean>
  debugConsole: DebugConsoleBridge
}

type DiscordChannelEntry = { channelId: string; messageId: string; isOwner: boolean }

export function useDiscordBridge({
  settingsRef,
  enabled,
  botToken,
  allowedChannelIds,
  chat,
  busyRef,
  debugConsole,
}: UseDiscordBridgeOptions) {
  const { t } = useTranslation()
  const lastDiscordChannelRef = useRef<DiscordChannelEntry | null>(null)
  // Per-channelId tracking so concurrent Discord channels don't overwrite each other.
  const discordChannelMapRef = useRef<Map<string, DiscordChannelEntry>>(new Map())
  const discordSendMessageRef = useRef<(channelId: string, text: string, replyTo?: string) => Promise<void>>(undefined)
  const chatRef = useRef(chat)
  useEffect(() => { chatRef.current = chat }, [chat])

  // Retry bridge messages that arrive while the assistant is mid-reply
  // instead of silently dropping them (same rationale as the Telegram queue).
  // Created in an effect — not useMemo — because the queue closes over refs,
  // which render-phase code is not allowed to touch.
  const forwardQueueRef = useRef<BridgeForwardQueue | null>(null)
  useEffect(() => {
    const queue = createBridgeForwardQueue({
      send: async (text) => {
        const result = await chatRef.current.sendMessage?.(text, { source: 'discord' })
        return result !== false
      },
      isBusy: () => Boolean(busyRef.current),
      onDrop: (text, reason) => {
        debugConsole.appendDebugConsoleEvent({
          source: 'autonomy',
          title: 'Discord message dropped',
          detail: `${reason}: textLength=${text.length}`,
        })
      },
    })
    forwardQueueRef.current = queue
    return () => {
      queue.dispose()
      forwardQueueRef.current = null
    }
  }, [busyRef, debugConsole])

  const handleDiscordMessage = useCallback((msg: DiscordIncoming) => {
    const isOwner = routeDiscordMessage(msg, settingsRef.current, t, {
      appendDebugConsoleEvent: debugConsole.appendDebugConsoleEvent,
      pushCompanionNotice: chat.pushCompanionNotice,
      sendMessage: async (text?: string) => {
        if (text) forwardQueueRef.current?.push(text)
        return undefined
      },
    }).isOwner

    const channelEntry: DiscordChannelEntry = { channelId: msg.channelId, messageId: msg.messageId, isOwner }
    lastDiscordChannelRef.current = channelEntry
    discordChannelMapRef.current.set(msg.channelId, channelEntry)
    rememberDiscordChannelId(msg.channelId)
  }, [chat, debugConsole, settingsRef, t])

  const gateway = useDiscordGateway({
    botToken,
    allowedChannelIds,
    onMessage: handleDiscordMessage,
    enabled,
  })

  useEffect(() => {
    discordSendMessageRef.current = gateway.sendMessage
  }, [gateway.sendMessage])

  // Send a reply back to a Discord channel. If channelId is provided, replies
  // to that specific channel; otherwise falls back to the most recent incoming.
  // Returns true only when the message actually went out.
  const replyTo = useCallback(async (text: string, channelId?: string, messageId?: string): Promise<boolean> => {
    const target = resolveBridgeReplyTarget(
      discordChannelMapRef.current,
      lastDiscordChannelRef.current,
      channelId,
    )
    if (!target || !discordSendMessageRef.current) return false
    if (!isActionAllowed(settingsRef.current, 'discord', 'send')) {
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Discord reply blocked',
        detail: `permission mode "${settingsRef.current.discordPermissionMode}" does not allow sending messages`,
      })
      return false
    }
    try {
      await discordSendMessageRef.current(target.channelId, text, messageId)
      return true
    } catch (error) {
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Discord reply failed',
        detail: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }, [debugConsole, settingsRef])

  // Route a completed companion reply back to the channel that triggered it.
  // Text first; the audio attachment is best-effort on top.
  const deliverAssistantReply = useCallback(async (payload: AssistantReplyDeliveredPayload) => {
    const settings = settingsRef.current
    const target = lastDiscordChannelRef.current
    const decision = decideBridgeAutoReply({
      autoReplyEnabled: settings.discordAutoReplyEnabled,
      permissionMode: settings.discordPermissionMode,
      target,
    })
    if (decision.kind === 'skip') {
      if (decision.reason !== 'disabled') {
        debugConsole.appendDebugConsoleEvent({
          source: 'autonomy',
          title: 'Discord auto-reply skipped',
          detail: decision.reason,
        })
      }
      return
    }

    const text = payload.displayText.trim()
    if (!text || !discordSendMessageRef.current) return
    try {
      await discordSendMessageRef.current(target!.channelId, text)
    } catch (error) {
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Discord auto-reply failed',
        detail: error instanceof Error ? error.message : String(error),
      })
      return
    }

    if (!settings.discordVoiceReplyEnabled) return
    const spoken = payload.spokenText.trim()
    if (!spoken) return
    try {
      const synthesize = window.desktopPet?.synthesizeAudio
      const sendVoice = window.desktopPet?.discordSendVoice
      if (!synthesize || !sendVoice) return
      const audio = await synthesize({
        providerId: settings.speechOutputProviderId,
        baseUrl: settings.speechOutputApiBaseUrl,
        apiKey: settings.speechOutputApiKey,
        model: settings.speechOutputModel,
        voice: settings.speechOutputVoice,
        text: spoken,
        ...(settings.speechSynthesisLang ? { language: settings.speechSynthesisLang } : {}),
        ...(typeof settings.speechRate === 'number' ? { rate: settings.speechRate } : {}),
      })
      // Discord renders any common audio container as a playable attachment,
      // so unlike Telegram there is no format gate here.
      await sendVoice({
        channelId: target!.channelId,
        audioBase64: audio.audioBase64,
        mimeType: audio.mimeType,
      })
    } catch (error) {
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Discord voice reply failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }, [debugConsole, settingsRef])

  return { gateway, replyTo, deliverAssistantReply }
}
