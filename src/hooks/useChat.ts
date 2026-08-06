import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createId,
  shorten,
} from '../lib/index.ts'
import { useTranslation } from '../i18n/useTranslation.ts'
import {
  markRecalled,
} from '../features/memory/index.ts'
import { logVoiceEvent } from '../features/voice/index.ts'
import {
  createAssistantReplyRunner,
  createLocalReminderActionRunner,
  createPendingReminderDraft,
  getFreshPendingReminderDraft,
  PENDING_REMINDER_DRAFT_TTL_MS,
  cancelActiveTurn as cancelActiveTurnRuntime,
  getSpeechOutputErrorMessage,
  type PendingReminderDraft,
  type PendingReminderDraftInput,
  type UseChatContext,
} from './chat/index.ts'
import { useChatPersistence } from './chat/useChatPersistence.ts'
import { createSendMessageHandler } from './chat/sendMessage.ts'
import { usePetDialogBubbles } from './chat/usePetDialogBubbles.ts'
import { useCompanionNotices } from './chat/useCompanionNotices.ts'
import { useChatHistoryArchive } from './chat/useChatHistoryArchive.ts'
import type {
  AssistantRuntimeActivity,
  ChatMessage,
  ChatMessageTone,
} from '../types/index.ts'

export type { UseChatContext } from './chat/index.ts'

const MAX_CHAT_MESSAGES = 500

export function useChat(ctx: UseChatContext) {
  const { t } = useTranslation()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setErrorRaw] = useState<string | null>(null)
  const errorTimerRef = useRef<number | null>(null)
  const setError = useCallback((value: string | null) => {
    if (errorTimerRef.current) {
      window.clearTimeout(errorTimerRef.current)
      errorTimerRef.current = null
    }
    setErrorRaw(value)
    if (value) {
      errorTimerRef.current = window.setTimeout(() => {
        setErrorRaw(null)
        errorTimerRef.current = null
      }, 8_000)
    }
  }, [])
  const [assistantActivity, setAssistantActivity] = useState<AssistantRuntimeActivity>('idle')
  const [pendingImage, setPendingImageState] = useState<string | null>(null)

  const messagesRef = useRef<ChatMessage[]>(messages)
  const inputRef = useRef('')
  const setInputValue = useCallback((value: string) => {
    inputRef.current = value
    setInput(value)
  }, [])
  const pendingImageRef = useRef<string | null>(null)
  const busyRef = useRef(false)
  const submissionLockRef = useRef(false)
  const activeTurnIdRef = useRef(0)
  const activeStreamAbortRef = useRef<(() => Promise<void>) | null>(null)
  const ctxRef = useRef(ctx)
  // Only read from callbacks (cancelActiveTurn), so the write can live in an
  // every-commit effect instead of render (react-hooks/refs).
  useEffect(() => {
    ctxRef.current = ctx
  })
  const pendingReminderDraftRef = useRef<PendingReminderDraft | null>(null)

  const {
    applyRemoteMessages: applyRemoteMessagesToState,
    currentSessionId,
  } = useChatPersistence({
    messages,
    setMessages,
  })

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    inputRef.current = input
  }, [input])

  const setPendingImage = useCallback((dataUrl: string | null) => {
    pendingImageRef.current = dataUrl
    setPendingImageState(dataUrl)
  }, [])

  // Track busy → assistantActivity with the render-time adjust pattern
  // (setState during render, guarded by a previous-value snapshot) instead of
  // an effect — react-hooks/set-state-in-effect forbids the synchronous
  // effect-body setState, and the guarded render adjust is equivalent here:
  // it fires exactly on busy transitions, including the mount no-op.
  const [previousBusy, setPreviousBusy] = useState(busy)
  if (previousBusy !== busy) {
    setPreviousBusy(busy)
    setAssistantActivity(busy ? 'thinking' : 'idle')
  }

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  // Called by useDesktopBridge when a BroadcastChannel message says another
  // window wrote the chat-messages storage key. Replaces local messages
  // state AND primes the save-effect guards so the replacement doesn't
  // immediately re-broadcast (which would kick the originating window into
  // rewriting over its own in-flight additions).
  const applyRemoteMessages = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next
    applyRemoteMessagesToState(next)
  }, [applyRemoteMessagesToState])

  const {
    petDialogBubble,
    petThoughtBubble,
    presentPetDialogBubble,
    hidePetDialogBubble,
    pushInnerThought,
    hideInnerThought,
  } = usePetDialogBubbles()

  useEffect(() => () => {
    if (errorTimerRef.current) {
      window.clearTimeout(errorTimerRef.current)
    }
    activeStreamAbortRef.current?.()
  }, [])

  const appendChatMessage = useCallback((message: ChatMessage) => {
    setMessages((current) => {
      const appended = [...current, message]
      const updatedMessages =
        appended.length > MAX_CHAT_MESSAGES
          ? [...appended.slice(0, 2), ...appended.slice(appended.length - (MAX_CHAT_MESSAGES - 2))]
          : appended
      messagesRef.current = updatedMessages
      return updatedMessages
    })
  }, [])

  const appendSystemMessage = useCallback((content: string, tone: ChatMessageTone = 'neutral') => {
    // Cap system-message length so a stack trace or serialized payload cannot
    // tear the chat list layout even if the CSS guard regresses. 500 chars
    // keeps the first line plus enough context to diagnose without the full
    // wall of text — users who need more can copy from DevTools / logs.
    const MAX_SYSTEM_MESSAGE_CHARS = 500
    const trimmed = content.length > MAX_SYSTEM_MESSAGE_CHARS
      ? `${content.slice(0, MAX_SYSTEM_MESSAGE_CHARS - 1)}…`
      : content
    appendChatMessage({
      id: createId('msg'),
      role: 'system',
      content: trimmed,
      tone,
      createdAt: new Date().toISOString(),
    })
  }, [appendChatMessage])

  const {
    pushCompanionNotice,
    flushDeferredCompanionNotices,
  } = useCompanionNotices({
    ctx,
    t,
    busyRef,
    appendChatMessage,
    presentPetDialogBubble,
    setError,
  })

  function getPendingReminderDraft() {
    const draft = getFreshPendingReminderDraft(
      pendingReminderDraftRef.current,
      PENDING_REMINDER_DRAFT_TTL_MS,
    )

    if (!draft) {
      pendingReminderDraftRef.current = null
      return null
    }

    return draft
  }

  const setPendingReminderDraft = useCallback((draft: PendingReminderDraftInput) => {
    pendingReminderDraftRef.current = createPendingReminderDraft(draft)
  }, [])

  const clearPendingReminderDraft = useCallback(() => {
    pendingReminderDraftRef.current = null
  }, [])

  const handleSpeechPlaybackFailure = useCallback((speechError: unknown, options: {
    traceId?: string
    traceLabel?: string
    source: 'text' | 'voice' | 'telegram' | 'discord' | 'notification'
    fromVoice: boolean
    shouldResumeContinuousVoice: boolean
  }) => {
    const speechErrorMessage = getSpeechOutputErrorMessage(speechError)
    logVoiceEvent('assistant reply speech output failed', {
      source: options.source,
      errorPresent: Boolean(speechErrorMessage),
    })

    if (options.fromVoice && options.traceLabel) {
      ctx.appendVoiceTrace(t('chat.voice.playback_failed_label'), `#${options.traceLabel} ${shorten(speechErrorMessage, 48)}`, 'error')
    }

    setError(options.fromVoice ? t('chat.error.playback_with_reply', { error: speechErrorMessage }) : speechErrorMessage)
    // Bus drives voiceState → 'idle' + restart_voice + setMood('idle')
    ctx.busEmit({
      type: 'tts:error',
      message: speechErrorMessage,
      speechGeneration: 0,
      shouldResumeContinuousVoice: options.shouldResumeContinuousVoice,
    })
  }, [ctx, setError, t])

  const syncAssistantActivity = useCallback(() => {
    setAssistantActivity(busyRef.current ? 'thinking' : 'idle')
  }, [])

  // eslint-disable-next-line react-hooks/refs -- runner factory receives ctx (which holds refs) but only dereferences them inside the returned async callbacks, never during this render
  const runLocalReminderAction = useMemo(() => createLocalReminderActionRunner({
      ctx,
      clearPendingReminderDraft,
      pushCompanionNotice,
      setAssistantActivity,
      setPendingReminderDraft,
      syncAssistantActivity,
    }), [clearPendingReminderDraft, ctx, pushCompanionNotice, setPendingReminderDraft, syncAssistantActivity])

  // eslint-disable-next-line react-hooks/refs -- runner factory receives ctx (which holds refs) but only dereferences them inside the returned async callbacks, never during this render
  const runAssistantReplyTurn = useMemo(() => createAssistantReplyRunner({
      ctx,
      appendChatMessage,
      appendSystemMessage,
      presentPetDialogBubble,
      handleSpeechPlaybackFailure,
      setError,
      setActiveStreamAbort: (abortOrUpdater) => {
        if (typeof abortOrUpdater === 'function' && abortOrUpdater.length > 0) {
          // Updater form: (current) => newValue
          const updater = abortOrUpdater as (
            current: (() => Promise<void>) | null,
          ) => (() => Promise<void>) | null
          activeStreamAbortRef.current = updater(activeStreamAbortRef.current)
        } else {
          // Direct value form (null or an abort fn with 0 params)
          activeStreamAbortRef.current = abortOrUpdater as (() => Promise<void>) | null
        }
      },
      onMemoryRecalled: (recalledIds) => {
        const idSet = new Set(recalledIds)
        ctx.setMemories((prev) => markRecalled(prev, idSet))
      },
    }), [appendChatMessage, appendSystemMessage, ctx, handleSpeechPlaybackFailure, presentPetDialogBubble, setError])

  const {
    replaceChatHistory,
    exportChatHistory,
    importChatHistory,
    clearChatHistory,
  } = useChatHistoryArchive({
    ctx,
    t,
    messagesRef,
    setMessages,
    setError,
    setInputValue,
  })

  // eslint-disable-next-line react-hooks/refs -- handler factory receives refs but only dereferences them inside the returned async sendMessage, never during this render
  const sendMessage = createSendMessageHandler({
    ctx,
    t,
    messagesRef,
    inputRef,
    pendingImageRef,
    busyRef,
    submissionLockRef,
    activeTurnIdRef,
    activeStreamAbortRef,
    setMessages,
    setBusy,
    setError,
    setInputValue,
    setPendingImageState,
    hidePetDialogBubble,
    appendSystemMessage,
    getPendingReminderDraft,
    clearPendingReminderDraft,
    runLocalReminderAction,
    runAssistantReplyTurn,
    flushDeferredCompanionNotices,
  })

  const sendMessageRef = useRef(sendMessage)
  useEffect(() => {
    sendMessageRef.current = sendMessage
  })

  // Stable reference — delegates to the ref so downstream hooks / memos don't churn
  const stableSendMessage = useCallback(
    (...args: Parameters<typeof sendMessage>) => sendMessageRef.current(...args),
    [],
  )

  const cancelActiveTurn = useCallback(() => {
    cancelActiveTurnRuntime({
      activeTurnIdRef,
      activeStreamAbortRef,
      busyRef,
      setBusy,
      setAssistantActivity,
      onCancel: () => {
        const currentCtx = ctxRef.current
        hidePetDialogBubble()
        currentCtx.clearPetPerformanceCue()
        currentCtx.setLiveTranscript('')
        currentCtx.setMood('idle')
        if (currentCtx.voiceStateRef.current !== 'processing') return
        currentCtx.setVoiceState('idle')
        currentCtx.busEmit({
          type: 'session:aborted',
          abortReason: 'user_cancelled',
        })
      },
    })
  }, [hidePetDialogBubble])

  // Memoize the return bag so its identity is stable between renders that
  // don't change any observable state. Returning a fresh object literal each
  // render made every downstream consumer (useAppController's chatWithAutonomy,
  // petView, overlays, panelView) invalidate on every parent re-render — which
  // in turn cascaded into their children's useEffect deps and, wherever those
  // effects wrote back to state, produced a "Maximum update depth exceeded"
  // render storm. Stabilizing here cuts the cascade at its source.
  return useMemo(() => ({
    messages,
    currentSessionId,
    input,
    busy,
    error,
    assistantActivity,
    petDialogBubble,
    petThoughtBubble,
    pendingImage,
    messagesRef,
    inputRef,
    busyRef,
    sendMessageRef,
    setMessages,
    applyRemoteMessages,
    setInput: setInputValue,
    setBusy,
    setError,
    setPendingImage,
    appendChatMessage,
    appendSystemMessage,
    pushCompanionNotice,
    pushInnerThought,
    hideInnerThought,
    replaceChatHistory,
    exportChatHistory,
    importChatHistory,
    clearChatHistory,
    cancelActiveTurn,
    hidePetDialogBubble,
    sendMessage: stableSendMessage,
  }), [
    messages,
    input,
    busy,
    error,
    assistantActivity,
    currentSessionId,
    petDialogBubble,
    petThoughtBubble,
    pendingImage,
    setMessages,
    applyRemoteMessages,
    setInputValue,
    setBusy,
    setError,
    setPendingImage,
    appendChatMessage,
    appendSystemMessage,
    pushCompanionNotice,
    pushInnerThought,
    hideInnerThought,
    replaceChatHistory,
    exportChatHistory,
    importChatHistory,
    clearChatHistory,
    cancelActiveTurn,
    hidePetDialogBubble,
    stableSendMessage,
  ])
}
