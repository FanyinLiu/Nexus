import { useCallback, useEffect, useRef } from 'react'
import type { AppSettings, DebugConsoleEventSource } from '../../types'
import type { AssistantReplyDeliveredPayload } from '../../hooks/chat/types.ts'
import { useTelegramGateway, type TelegramIncoming } from '../../hooks/useTelegramGateway'
import { rememberTelegramChatId } from '../../lib/coreRuntime'
import { isActionAllowed } from '../../features/integrations/permissions'
import {
  type BridgeForwardQueue,
  createBridgeForwardQueue,
  decideBridgeAutoReply,
  isTelegramVoiceCompatibleMime,
  parseCsvIdSet,
  resolveBridgeReplyTarget,
} from './bridgeUtils'
import { routeTelegramMessage } from './telegramMessageRouter'
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
  busyRef: React.RefObject<boolean>
  debugConsole: DebugConsoleBridge
}

type TelegramChatEntry = { chatId: number; messageId: number; isOwner: boolean; wasVoice: boolean }

/**
 * Transcribe a Telegram voice note with the user's configured STT provider.
 * Cloud/API providers only — the transcription IPC posts the compressed blob
 * as multipart, which the local sherpa recognizers (PCM-stream based) can't
 * take. Returns null when transcription is unavailable or comes back empty,
 * in which case the caller falls back to announce-only.
 */
async function transcribeTelegramVoice(
  msg: TelegramIncoming,
  settings: AppSettings,
): Promise<string | null> {
  const transcribe = window.desktopPet?.transcribeAudio
  if (!transcribe || !msg.voiceBase64) return null
  if (!settings.speechInputApiBaseUrl?.trim()) return null
  try {
    const result = await transcribe({
      providerId: settings.speechInputProviderId,
      baseUrl: settings.speechInputApiBaseUrl,
      apiKey: settings.speechInputApiKey,
      model: settings.speechInputModel,
      language: settings.speechRecognitionLang,
      hotwords: settings.speechInputHotwords,
      audioBase64: msg.voiceBase64,
      mimeType: msg.voiceMimeType ?? 'audio/ogg',
      fileName: 'telegram-voice.ogg',
    })
    const text = result.text?.trim()
    return text || null
  } catch {
    return null
  }
}

export function useTelegramBridge({
  settingsRef,
  enabled,
  botToken,
  allowedChatIds,
  chat,
  busyRef,
  debugConsole,
}: UseTelegramBridgeOptions) {
  const { t } = useTranslation()
  const lastTelegramChatRef = useRef<TelegramChatEntry | null>(null)
  // Per-chatId tracking so concurrent Telegram chats don't overwrite each other.
  const telegramChatMapRef = useRef<Map<number, TelegramChatEntry>>(new Map())
  const telegramSendMessageRef = useRef<(chatId: number, text: string, replyTo?: number) => Promise<void>>(undefined)
  const chatRef = useRef(chat)
  useEffect(() => { chatRef.current = chat }, [chat])

  // Retry bridge messages that arrive while the assistant is mid-reply
  // instead of silently dropping them (the busy gate in useChat.sendMessage
  // returns false and previously nobody listened). Created in an effect —
  // not useMemo — because the queue closes over refs, which render-phase
  // code is not allowed to touch.
  const forwardQueueRef = useRef<BridgeForwardQueue | null>(null)
  useEffect(() => {
    const queue = createBridgeForwardQueue({
      send: async (text) => {
        const result = await chatRef.current.sendMessage?.(text, { source: 'telegram' })
        return result !== false
      },
      isBusy: () => Boolean(busyRef.current),
      onDrop: (text, reason) => {
        debugConsole.appendDebugConsoleEvent({
          source: 'autonomy',
          title: 'Telegram message dropped',
          detail: `${reason}: ${text.slice(0, 120)}`,
        })
      },
    })
    forwardQueueRef.current = queue
    return () => {
      queue.dispose()
      forwardQueueRef.current = null
    }
  }, [busyRef, debugConsole])

  const handleTelegramMessage = useCallback((msg: TelegramIncoming) => {
    const routeDeps = {
      appendDebugConsoleEvent: debugConsole.appendDebugConsoleEvent,
      pushCompanionNotice: chat.pushCompanionNotice,
      sendMessage: async (text?: string) => {
        if (text) forwardQueueRef.current?.push(text)
        return undefined
      },
    }

    const wasVoice = msg.media === 'voice'
    let isOwner: boolean
    if (wasVoice && msg.voiceBase64) {
      // Voice note: transcribe first so it reaches the companion as text.
      // Route async; on transcription failure fall back to the original
      // announce-only routing for media messages.
      isOwner = parseCsvIdSet(settingsRef.current.ownerTelegramChatIds).has(String(msg.chatId))
      void (async () => {
        const transcript = await transcribeTelegramVoice(msg, settingsRef.current)
        if (transcript) {
          routeTelegramMessage({ ...msg, text: transcript, media: null }, settingsRef.current, t, routeDeps)
        } else {
          debugConsole.appendDebugConsoleEvent({
            source: 'autonomy',
            title: 'Telegram voice not transcribed',
            detail: 'no API STT configured or transcription failed — announced only',
          })
          routeTelegramMessage(msg, settingsRef.current, t, routeDeps)
        }
      })()
    } else {
      isOwner = routeTelegramMessage(msg, settingsRef.current, t, routeDeps).isOwner
    }

    const chatEntry: TelegramChatEntry = { chatId: msg.chatId, messageId: msg.messageId, isOwner, wasVoice }
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
  // Returns true only when the message actually went out, so callers (the
  // panel reply box) can stop pretending a blocked/failed send succeeded.
  const replyTo = useCallback(async (
    text: string,
    chatId?: number | string,
    messageId?: number | string,
  ): Promise<boolean> => {
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
    if (!target || !telegramSendMessageRef.current) return false
    if (!isActionAllowed(settingsRef.current, 'telegram', 'send')) {
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Telegram reply blocked',
        detail: `permission mode "${settingsRef.current.telegramPermissionMode}" does not allow sending messages`,
      })
      return false
    }
    try {
      await telegramSendMessageRef.current(
        target.chatId,
        text,
        Number.isFinite(resolvedMessageId) ? resolvedMessageId : target.messageId,
      )
      return true
    } catch (error) {
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Telegram reply failed',
        detail: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }, [debugConsole, settingsRef])

  // Route a completed companion reply back to the chat that triggered it.
  // Text goes out first; the voice note is best-effort on top — a TTS or
  // upload failure must never take the text reply down with it.
  const deliverAssistantReply = useCallback(async (payload: AssistantReplyDeliveredPayload) => {
    const settings = settingsRef.current
    const target = lastTelegramChatRef.current
    const decision = decideBridgeAutoReply({
      autoReplyEnabled: settings.telegramAutoReplyEnabled,
      permissionMode: settings.telegramPermissionMode,
      target,
    })
    if (decision.kind === 'skip') {
      if (decision.reason !== 'disabled') {
        debugConsole.appendDebugConsoleEvent({
          source: 'autonomy',
          title: 'Telegram auto-reply skipped',
          detail: decision.reason,
        })
      }
      return
    }

    const text = payload.displayText.trim()
    if (!text || !telegramSendMessageRef.current) return
    try {
      await telegramSendMessageRef.current(target!.chatId, text)
    } catch (error) {
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Telegram auto-reply failed',
        detail: error instanceof Error ? error.message : String(error),
      })
      return
    }

    const voiceMode = settings.telegramVoiceReplyMode
    if (voiceMode === 'off') return
    // 'inbound': mirror the user's modality — only answer voice with voice.
    if (voiceMode === 'inbound' && !target!.wasVoice) return
    const spoken = payload.spokenText.trim()
    if (!spoken) return
    try {
      const synthesize = window.desktopPet?.synthesizeAudio
      const sendVoice = window.desktopPet?.telegramSendVoice
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
      if (!isTelegramVoiceCompatibleMime(audio.mimeType)) {
        debugConsole.appendDebugConsoleEvent({
          source: 'autonomy',
          title: 'Telegram voice reply skipped',
          detail: `provider returned ${audio.mimeType}; Telegram voice notes need mp3/ogg/m4a`,
        })
        return
      }
      await sendVoice({
        chatId: target!.chatId,
        audioBase64: audio.audioBase64,
        mimeType: audio.mimeType,
      })
    } catch (error) {
      debugConsole.appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Telegram voice reply failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }, [debugConsole, settingsRef])

  return { gateway, replyTo, deliverAssistantReply }
}
