import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createId,
  inferSessionTitle,
  openTextFileWithFallback,
  saveTextFileWithFallback,
  shorten,
  upsertChatSession,
} from '../lib'
import { getCoreRuntime } from '../lib/coreRuntime'
import { parseChatHistoryArchive, serializeChatHistoryArchive } from '../features/chat'
import {
  createDailyMemoryEntry,
  extractMemoriesFromMessage,
  markRecalled,
  mergeMemories,
} from '../features/memory'
import { formatTraceLabel, logVoiceEvent } from '../features/voice'
import {
  createAssistantReplyRunner,
  createLocalReminderActionRunner,
  createPendingReminderDraft,
  executeAssistantTurn,
  getFreshPendingReminderDraft,
  handleSlashCommand,
  PENDING_REMINDER_DRAFT_TTL_MS,
  getSpeechOutputErrorMessage,
  resolveReminderIntentWithPendingDraft,
  sanitizeLoadedMessages,
  type CompanionNoticePayload,
  type PendingReminderDraft,
  type PendingReminderDraftInput,
  type UseChatContext,
} from './chat'
import type {
  AssistantRuntimeActivity,
  ChatMessage,
  ChatMessageTone,
  DailyMemoryEntry,
  PetDialogBubbleState,
  PetThoughtBubbleState,
} from '../types'

export type { UseChatContext } from './chat'

const MAX_CHAT_MESSAGES = 500

export function useChat(ctx: UseChatContext) {
  // Each app launch opens a fresh chat bucket. Past sessions are persisted
  // by id and browsable from Settings → 聊天记录; the pane itself only
  // ever renders the current session. LLM context continuity across
  // launches is handled by the memory + dream system, not by dragging
  // raw message history forward.
  const currentSessionIdRef = useRef<string>(createId('chat-session'))
  const currentSessionStartedAtRef = useRef<number>(Date.now())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // Retained for backwards compatibility with consumers that may still
  // read these fields. archivedMessageIds is now an empty set — since
  // the pane renders the current session only, nothing needs filtering.
  const sessionStartAtRef = useRef<number>(currentSessionStartedAtRef.current)
  const archivedMessageIdsRef = useRef<Set<string>>(new Set())
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
  const [petDialogBubble, setPetDialogBubble] = useState<PetDialogBubbleState | null>(null)
  const [petThoughtBubble, setPetThoughtBubble] = useState<PetThoughtBubbleState | null>(null)
  const [assistantActivity, setAssistantActivity] = useState<AssistantRuntimeActivity>('idle')
  const [pendingImage, setPendingImageState] = useState<string | null>(null)

  const messagesRef = useRef<ChatMessage[]>(messages)
  const inputRef = useRef('')
  const pendingImageRef = useRef<string | null>(null)
  const busyRef = useRef(false)
  const activeTurnIdRef = useRef(0)
  const activeStreamAbortRef = useRef<(() => Promise<void>) | null>(null)
  const pendingReminderDraftRef = useRef<PendingReminderDraft | null>(null)
  const petDialogHideTimerRef = useRef<number | null>(null)
  const petThoughtHideTimerRef = useRef<number | null>(null)
  const deferredCompanionNoticesRef = useRef<CompanionNoticePayload[]>([])
  const flushingDeferredCompanionNoticesRef = useRef(false)
  const recentCompanionNoticesRef = useRef<Map<string, number>>(new Map())
  const messagesSaveSkipRef = useRef(true)

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

  useEffect(() => {
    busyRef.current = busy
    setAssistantActivity(busy ? 'thinking' : 'idle')
  }, [busy])

  const sessionIdRef = useRef<string | null>(null)
  const mirroredMessageIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (messagesSaveSkipRef.current) {
      messagesSaveSkipRef.current = false
      return
    }
    upsertChatSession({
      id: currentSessionIdRef.current,
      startedAt: currentSessionStartedAtRef.current,
      lastActiveAt: Date.now(),
      title: inferSessionTitle(messages),
      messages,
    })

    const { sessionStore } = getCoreRuntime()
    if (!sessionIdRef.current) {
      const session = sessionStore.createSession('local-chat', 'Companion chat')
      sessionIdRef.current = session.id
    }
    const mirrored = mirroredMessageIdsRef.current
    for (const msg of messages) {
      if (mirrored.has(msg.id)) continue
      if (msg.role !== 'user' && msg.role !== 'assistant') {
        mirrored.add(msg.id)
        continue
      }
      sessionStore.appendMessage(sessionIdRef.current!, {
        role: msg.role,
        content: msg.content,
        timestamp: Date.parse(msg.createdAt) || Date.now(),
      })
      mirrored.add(msg.id)
    }
  }, [messages])

  const clearPetDialogHideTimer = useCallback(() => {
    if (petDialogHideTimerRef.current) {
      window.clearTimeout(petDialogHideTimerRef.current)
      petDialogHideTimerRef.current = null
    }
  }, [])

  const hidePetDialogBubble = useCallback(() => {
    clearPetDialogHideTimer()
    setPetDialogBubble(null)
  }, [clearPetDialogHideTimer])

  const presentPetDialogBubble = useCallback((
    bubble: PetDialogBubbleState,
    options?: { autoHideMs?: number },
  ) => {
    clearPetDialogHideTimer()
    setPetDialogBubble({
      ...bubble,
      createdAt: bubble.createdAt ?? new Date().toISOString(),
    })

    if ((options?.autoHideMs ?? 0) > 0) {
      petDialogHideTimerRef.current = window.setTimeout(() => {
        petDialogHideTimerRef.current = null
        setPetDialogBubble(null)
      }, options!.autoHideMs)
    }
  }, [clearPetDialogHideTimer])

  useEffect(() => () => {
    clearPetDialogHideTimer()
  }, [clearPetDialogHideTimer])

  const clearPetThoughtHideTimer = useCallback(() => {
    if (petThoughtHideTimerRef.current) {
      window.clearTimeout(petThoughtHideTimerRef.current)
      petThoughtHideTimerRef.current = null
    }
  }, [])

  const pushInnerThought = useCallback((thought: string, urgency: number, autoHideMs = 8_000) => {
    const trimmed = thought.trim()
    if (!trimmed) return
    clearPetThoughtHideTimer()
    setPetThoughtBubble({
      thought: trimmed,
      urgency: Math.max(0, Math.min(100, Math.round(urgency))),
      createdAt: new Date().toISOString(),
    })
    if (autoHideMs > 0) {
      petThoughtHideTimerRef.current = window.setTimeout(() => {
        petThoughtHideTimerRef.current = null
        setPetThoughtBubble(null)
      }, autoHideMs)
    }
  }, [clearPetThoughtHideTimer])

  const hideInnerThought = useCallback(() => {
    clearPetThoughtHideTimer()
    setPetThoughtBubble(null)
  }, [clearPetThoughtHideTimer])

  useEffect(() => () => {
    clearPetThoughtHideTimer()
  }, [clearPetThoughtHideTimer])

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

  const pushCompanionNotice = useCallback(async (options: CompanionNoticePayload) => {
    const chatContent = options.chatContent.trim()
    const bubbleContent = (options.bubbleContent ?? chatContent).trim()
    const speechContent = options.speechContent?.trim() ?? ''
    const createdAt = new Date().toISOString()

    // Dedupe gate: drop near-identical broadcasts within 10min. StrictMode
    // double-mount and cross-category autonomy paths (proactive speak /
    // scheduled / context trigger / brief) can otherwise produce twin
    // notices for the same underlying thought. We key on bubbleContent —
    // the label-free core text — so 【早报】X and 【自主】X collapse to
    // one entry instead of bypassing the gate through their prefix.
    const DEDUPE_WINDOW_MS = 10 * 60_000
    const dedupeKey = bubbleContent || speechContent || chatContent
    if (dedupeKey) {
      const now = Date.now()
      const recent = recentCompanionNoticesRef.current
      for (const [key, ts] of recent) {
        if (now - ts > DEDUPE_WINDOW_MS) recent.delete(key)
      }
      const lastTs = recent.get(dedupeKey)
      if (lastTs !== undefined && now - lastTs < DEDUPE_WINDOW_MS) {
        return
      }
      recent.set(dedupeKey, now)
    }

    if (chatContent) {
      appendChatMessage({
        id: createId('msg'),
        role: 'assistant',
        content: chatContent,
        toolResult: options.toolResult,
        createdAt,
      })
    }

    if (bubbleContent) {
      presentPetDialogBubble(
        {
          content: bubbleContent,
          toolResult: options.toolResult,
          streaming: false,
          createdAt,
        },
        { autoHideMs: options.autoHideMs ?? 14_000 },
      )
    }

    ctx.markPresenceActivity()
    ctx.setMood('happy')

    if (!speechContent) {
      return
    }

    try {
      await ctx.speakAssistantReply(speechContent, options.shouldResumeContinuousVoice ?? false)
    } catch (speechError) {
      const speechErrorMessage = getSpeechOutputErrorMessage(speechError)
      setError(`内容已展示，但语音播报失败：${speechErrorMessage}`)
    }
  }, [appendChatMessage, ctx, presentPetDialogBubble, setError])

  const canDeliverDeferredCompanionNotice = useCallback(() => (
    !busyRef.current
    && ctx.voiceStateRef.current !== 'processing'
    && ctx.voiceStateRef.current !== 'speaking'
  ), [ctx.voiceStateRef])

  const flushDeferredCompanionNotices = useCallback(async () => {
    if (flushingDeferredCompanionNoticesRef.current || !canDeliverDeferredCompanionNotice()) {
      return
    }

    flushingDeferredCompanionNoticesRef.current = true

    try {
      while (deferredCompanionNoticesRef.current.length && canDeliverDeferredCompanionNotice()) {
        const nextNotice = deferredCompanionNoticesRef.current.shift()
        if (!nextNotice) {
          continue
        }

        await pushCompanionNotice(nextNotice)
      }
    } finally {
      flushingDeferredCompanionNoticesRef.current = false
    }
  }, [canDeliverDeferredCompanionNotice, pushCompanionNotice])

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
    source: 'text' | 'voice' | 'telegram' | 'discord'
    fromVoice: boolean
    shouldResumeContinuousVoice: boolean
  }) => {
    const speechErrorMessage = getSpeechOutputErrorMessage(speechError)
    logVoiceEvent('assistant reply speech output failed', {
      traceId: options.traceId || undefined,
      source: options.source,
      error: speechErrorMessage,
    })

    if (options.fromVoice && options.traceLabel) {
      ctx.appendVoiceTrace('语音播报失败', `#${options.traceLabel} ${shorten(speechErrorMessage, 48)}`, 'error')
    }

    setError(options.fromVoice ? `模型已经回复，但语音播报失败：${speechErrorMessage}` : speechErrorMessage)
    // Bus drives voiceState → 'idle' + restart_voice + setMood('idle')
    ctx.busEmit({
      type: 'tts:error',
      message: speechErrorMessage,
      speechGeneration: 0,
      shouldResumeContinuousVoice: options.shouldResumeContinuousVoice ?? false,
    })
  }, [ctx, setError])

  const syncAssistantActivity = useCallback(() => {
    setAssistantActivity(busyRef.current ? 'thinking' : 'idle')
  }, [])

  const runLocalReminderAction = useMemo(() => createLocalReminderActionRunner({
      ctx,
      clearPendingReminderDraft,
      pushCompanionNotice,
      setAssistantActivity,
      setPendingReminderDraft,
      syncAssistantActivity,
    }), [clearPendingReminderDraft, ctx, pushCompanionNotice, setPendingReminderDraft, syncAssistantActivity])

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

  const replaceChatHistory = useCallback((nextMessages: ChatMessage[]) => {
    messagesRef.current = nextMessages
    setMessages(nextMessages)
    setError(null)
    setInput('')
    inputRef.current = ''
  }, [setError])

  const exportChatHistory = useCallback(async () => {
    const fileNameDate = new Date().toISOString().slice(0, 10)
    const exportContent = serializeChatHistoryArchive(messagesRef.current, {
      companionName: ctx.settingsRef.current.companionName,
      userName: ctx.settingsRef.current.userName,
    })

    return saveTextFileWithFallback({
      title: '导出聊天记录',
      defaultFileName: `nexus-chat-history-${fileNameDate}.json`,
      content: exportContent,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
  }, [ctx.settingsRef])

  const importChatHistory = useCallback(async () => {
    const result = await openTextFileWithFallback({
      title: '导入聊天记录',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })

    if (result.canceled || !result.content) {
      return result
    }

    const importedMessages = sanitizeLoadedMessages(parseChatHistoryArchive(result.content))
    replaceChatHistory(importedMessages)

    return {
      canceled: false,
      filePath: result.filePath,
      message: `已导入 ${importedMessages.length} 条聊天消息。`,
    }
  }, [replaceChatHistory])

  const clearChatHistory = useCallback(async () => {
    replaceChatHistory([])

    return {
      canceled: false,
      message: '聊天记录已清空。',
    }
  }, [replaceChatHistory])

  async function sendMessage(
    rawContent?: string,
    options?: {
      source?: 'text' | 'voice' | 'telegram' | 'discord'
      traceId?: string
    },
  ) {
    const currentSettings = ctx.settingsRef.current
    const source = options?.source ?? 'text'
    const fromVoice = source === 'voice'
    const traceId = fromVoice ? (options?.traceId ?? createId('voice')) : ''
    const traceLabel = traceId ? formatTraceLabel(traceId) : ''
    const content = (rawContent ?? inputRef.current).trim()
    // Capture the pending image once at the top — we don't want it to disappear
    // mid-flight if the user clears it during send. Voice turns ignore images
    // (they go through the STT pipeline with no composer attachment).
    const attachedImage = !fromVoice && !rawContent ? pendingImageRef.current : null

    if (!content && !attachedImage) {
      if (fromVoice) {
        logVoiceEvent('voice transcript was empty, nothing was sent', { traceId })
        ctx.updateVoicePipeline('idle', '没有可发送的语音文本')
        ctx.appendVoiceTrace('发送取消', `#${traceLabel} 识别文本为空`, 'error')
      }
      return false
    }

    const slashResult = await handleSlashCommand(content)
    if (slashResult.handled) {
      if (slashResult.messages) {
        setMessages((prev) => [...prev, ...slashResult.messages!])
      }
      setInput('')
      return true
    }

    if (busyRef.current) {
      if (fromVoice) {
        logVoiceEvent('assistant is busy, voice transcript was not sent', { traceId, content })
        ctx.fillComposerWithVoiceTranscript(content)
        ctx.updateVoicePipeline('blocked_busy', '上一轮还在处理中，本句已放入输入框，可稍后发送。', content)
        ctx.appendVoiceTrace('发送被拦截', `#${traceLabel} 上一轮还在处理中，本句已放入输入框`, 'error')
        setError('上一轮回复还没完成，这句语音已放进输入框。')
        ctx.updatePetStatus('上一句还没结束，这句先放进输入框。', 2_600)
      }
      return false
    }

    // Resume the voice loop after TTS for ALL voice-originated turns. Even
    // in wake-word mode, this gives the user a brief VAD window to speak
    // again immediately after the companion replies, without re-waking.
    // If they don't speak, the noSpeechTimer (3 s, see constants.ts)
    // closes the session and the wake word listener takes over normally.
    const shouldResumeContinuousVoice = fromVoice

    if (ctx.voiceStateRef.current === 'speaking') {
      if (!ctx.canInterruptSpeech()) {
        setError('当前关闭了语音打断，请等上一句播报结束后再发送。')
        ctx.updatePetStatus('当前关闭了语音打断，请等我说完。', 3_000)
        return false
      }

      ctx.stopActiveSpeechOutput()
      ctx.setVoiceState('idle')
      ctx.setMood('happy')
    }

    hidePetDialogBubble()
    ctx.markPresenceActivity()
    if (fromVoice) {
      ctx.appendVoiceTrace('语音已发送', `#${traceLabel} 用户消息已写入聊天记录`)
    }

    const userMessage: ChatMessage = {
      id: createId('msg'),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
      ...(attachedImage ? { images: [attachedImage] } : {}),
    }

    // Consume the pending image as soon as it's attached to the outgoing
    // message — both the ref (for reentrancy) and React state (for the UI chip).
    if (attachedImage) {
      pendingImageRef.current = null
      setPendingImageState(null)
    }

    const nextMessages = [...messagesRef.current, userMessage]
    const nextMemories = mergeMemories(ctx.memoriesRef.current, extractMemoriesFromMessage(userMessage))
    const nextDailyMemories = ctx.appendDailyMemoryEntries(
      [createDailyMemoryEntry(userMessage, fromVoice ? 'voice' : 'chat')].filter(
        (entry): entry is DailyMemoryEntry => Boolean(entry),
      ),
    )

    messagesRef.current = nextMessages
    ctx.memoriesRef.current = nextMemories
    ctx.setMemories(nextMemories)
    setMessages(nextMessages)

    if (!rawContent) {
      inputRef.current = ''
      setInput('')
    }

    const resolvedReminderIntent = resolveReminderIntentWithPendingDraft(
      content,
      getPendingReminderDraft(),
    )
    const parsedReminderIntent = resolvedReminderIntent.intent
    if (resolvedReminderIntent.shouldClearPendingDraft) {
      clearPendingReminderDraft()
    }

    if (parsedReminderIntent) {
      try {
        await runLocalReminderAction({
          intent: parsedReminderIntent,
          content,
          fromVoice,
          traceLabel,
          shouldResumeContinuousVoice,
        })
        return true
      } catch (localIntentError) {
        const errorMessage = localIntentError instanceof Error ? localIntentError.message : '本地任务处理失败'
        appendSystemMessage(errorMessage, 'error')
        setError(errorMessage)
        ctx.appendDebugConsoleEvent({
          source: 'reminder',
          title: 'Local reminder handling failed',
          detail: errorMessage,
          tone: 'error',
        })
        ctx.updatePetStatus(errorMessage, 3_200)
        if (fromVoice) {
          ctx.updateVoicePipeline('reply_failed', `本地任务处理失败：${shorten(errorMessage, 36)}`, content)
          ctx.appendVoiceTrace('本地任务失败', `#${traceLabel} ${shorten(errorMessage, 40)}`, 'error')
        }
        return false
      }
    }

    return executeAssistantTurn(
      {
        ctx,
        setBusy,
        setError,
        busyRef,
        activeTurnIdRef,
        activeStreamAbortRef,
        runAssistantReplyTurn,
        flushDeferredCompanionNotices,
      },
      {
        currentSettings,
        nextMessages,
        nextMemories,
        nextDailyMemories,
        content,
        source,
        fromVoice,
        traceId,
        traceLabel,
        shouldResumeContinuousVoice,
      },
    )
  }

  const sendMessageRef = useRef(sendMessage)
  useEffect(() => {
    sendMessageRef.current = sendMessage
  })

  // Stable reference — delegates to the ref so downstream hooks / memos don't churn
  const stableSendMessage = useCallback(
    (...args: Parameters<typeof sendMessage>) => sendMessageRef.current(...args),
    [],
  )

  return {
    messages,
    sessionStartAt: sessionStartAtRef.current,
    archivedMessageIds: archivedMessageIdsRef.current,
    currentSessionId: currentSessionIdRef.current,
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
    setInput,
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
    hidePetDialogBubble,
    sendMessage: stableSendMessage,
  }
}
