import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createId,
  loadChatMessages,
  openTextFileWithFallback,
  saveChatMessages,
  saveTextFileWithFallback,
  shorten,
} from '../lib'
import { parseChatHistoryArchive, serializeChatHistoryArchive } from '../features/chat'
import {
  createDailyMemoryEntry,
  extractMemoriesFromMessage,
  markRecalled,
  mergeMemories,
} from '../features/memory'
import { planToolIntent, type ToolPlannerContext } from '../features/tools'
import { formatTraceLabel, logVoiceEvent } from '../features/voice'
import {
  createAssistantReplyRunner,
  createBackgroundWebSearchRunner,
  createLocalReminderActionRunner,
  createPendingReminderDraft,
  createToolIntentHandler,
  getFreshPendingReminderDraft,
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
} from '../types'

export type { UseChatContext } from './chat'

export function useChat(ctx: UseChatContext) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => sanitizeLoadedMessages(loadChatMessages()))
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
  const [assistantActivity, setAssistantActivity] = useState<AssistantRuntimeActivity>('idle')

  const messagesRef = useRef<ChatMessage[]>(messages)
  const inputRef = useRef('')
  const busyRef = useRef(false)
  const backgroundSearchCountRef = useRef(0)
  const activeTurnIdRef = useRef(0)
  const activeStreamAbortRef = useRef<(() => Promise<void>) | null>(null)
  const pendingReminderDraftRef = useRef<PendingReminderDraft | null>(null)
  const toolPlannerContextRef = useRef<ToolPlannerContext | null>(null)
  const petDialogHideTimerRef = useRef<number | null>(null)
  const deferredCompanionNoticesRef = useRef<CompanionNoticePayload[]>([])
  const flushingDeferredCompanionNoticesRef = useRef(false)
  const messagesSaveSkipRef = useRef(true)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    inputRef.current = input
  }, [input])

  useEffect(() => {
    busyRef.current = busy
    if (backgroundSearchCountRef.current > 0) {
      setAssistantActivity('searching')
    } else {
      setAssistantActivity(busy ? 'thinking' : 'idle')
    }
  }, [busy])

  useEffect(() => {
    if (messagesSaveSkipRef.current) {
      messagesSaveSkipRef.current = false
      return
    }
    saveChatMessages(messages)
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

  useEffect(() => () => {
    if (errorTimerRef.current) {
      window.clearTimeout(errorTimerRef.current)
    }
  }, [])

  const appendChatMessage = useCallback((message: ChatMessage) => {
    setMessages((current) => {
      const updatedMessages = [...current, message]
      messagesRef.current = updatedMessages
      return updatedMessages
    })
  }, [])

  const appendSystemMessage = useCallback((content: string, tone: ChatMessageTone = 'neutral') => {
    appendChatMessage({
      id: createId('msg'),
      role: 'system',
      content,
      tone,
      createdAt: new Date().toISOString(),
    })
  }, [appendChatMessage])

  const pushCompanionNotice = useCallback(async (options: CompanionNoticePayload) => {
    const chatContent = options.chatContent.trim()
    const bubbleContent = (options.bubbleContent ?? chatContent).trim()
    const speechContent = options.speechContent?.trim() ?? ''
    const createdAt = new Date().toISOString()

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

  const enqueueDeferredCompanionNotice = useCallback((notice: CompanionNoticePayload) => {
    deferredCompanionNoticesRef.current.push(notice)
    void flushDeferredCompanionNotices()
  }, [flushDeferredCompanionNotices])

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

  const beginBackgroundSearchActivity = useCallback(() => {
    backgroundSearchCountRef.current += 1
    setAssistantActivity('searching')
  }, [])

  const endBackgroundSearchActivity = useCallback(() => {
    backgroundSearchCountRef.current = Math.max(0, backgroundSearchCountRef.current - 1)
    if (backgroundSearchCountRef.current > 0) {
      setAssistantActivity('searching')
    } else {
      setAssistantActivity(busyRef.current ? 'thinking' : 'idle')
    }
  }, [])

  const handleSpeechPlaybackFailure = useCallback((speechError: unknown, options: {
    traceId?: string
    traceLabel?: string
    source: 'text' | 'voice'
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
    if (backgroundSearchCountRef.current > 0) {
      setAssistantActivity('searching')
    } else {
      setAssistantActivity(busyRef.current ? 'thinking' : 'idle')
    }
  }, [])

  const runBackgroundWebSearch = useMemo(() => createBackgroundWebSearchRunner({
      ctx,
      beginBackgroundSearchActivity,
      endBackgroundSearchActivity,
      enqueueDeferredCompanionNotice,
      setAssistantActivity,
    }), [beginBackgroundSearchActivity, ctx, endBackgroundSearchActivity, enqueueDeferredCompanionNotice])

  const runLocalReminderAction = useMemo(() => createLocalReminderActionRunner({
      ctx,
      clearPendingReminderDraft,
      pushCompanionNotice,
      resetToolPlannerContext: () => {
        toolPlannerContextRef.current = null
      },
      setAssistantActivity,
      setPendingReminderDraft,
      syncAssistantActivity,
    }), [clearPendingReminderDraft, ctx, pushCompanionNotice, setPendingReminderDraft, syncAssistantActivity])

  const handleToolIntent = useMemo(() => createToolIntentHandler({
      ctx,
      pushCompanionNotice,
      runBackgroundWebSearch,
      flushDeferredCompanionNotices,
    }), [ctx, flushDeferredCompanionNotices, pushCompanionNotice, runBackgroundWebSearch])

  const runAssistantReplyTurn = useMemo(() => createAssistantReplyRunner({
      ctx,
      appendChatMessage,
      appendSystemMessage,
      presentPetDialogBubble,
      handleSpeechPlaybackFailure,
      setError,
      setActiveStreamAbort: (abort) => {
        activeStreamAbortRef.current = abort
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
      source?: 'text' | 'voice'
      traceId?: string
    },
  ) {
    const currentSettings = ctx.settingsRef.current
    const source = options?.source ?? 'text'
    const fromVoice = source === 'voice'
    const traceId = fromVoice ? (options?.traceId ?? createId('voice')) : ''
    const traceLabel = traceId ? formatTraceLabel(traceId) : ''
    const content = (rawContent ?? inputRef.current).trim()

    if (!content) {
      if (fromVoice) {
        logVoiceEvent('voice transcript was empty, nothing was sent', { traceId })
        ctx.updateVoicePipeline('idle', '没有可发送的语音文本')
        ctx.appendVoiceTrace('发送取消', `#${traceLabel} 识别文本为空`, 'error')
      }
      return false
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
          title: '本地提醒处理失败',
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

    const toolIntentPlan = planToolIntent(content, toolPlannerContextRef.current, currentSettings)
    toolPlannerContextRef.current = toolIntentPlan.nextContext

    if (await handleToolIntent({
      toolIntentPlan,
      currentSettings,
      content,
      fromVoice,
      traceLabel,
      shouldResumeContinuousVoice,
    })) {
      return true
    }

    busyRef.current = true
    setBusy(true)
    ctx.clearPetPerformanceCue()
    ctx.setMood('thinking')
    ctx.setVoiceState('processing')
    ctx.busEmit({ type: 'chat:busy_changed', busy: true })
    setError(null)
    ctx.setLiveTranscript('')
    const turnId = ++activeTurnIdRef.current
    void activeStreamAbortRef.current?.().catch(() => undefined)
    activeStreamAbortRef.current = null

    if (fromVoice) {
      ctx.updateVoicePipeline('sending', '识别文本已进入聊天，正在请求大模型。', content)
      ctx.appendVoiceTrace('请求大模型', `#${traceLabel} 已调用聊天接口，等待模型返回`)
    }

    ctx.updatePetStatus(
      fromVoice ? '我收到了，正在整理这句话的重点。' : '我在整理这条消息，马上回你。',
    )

    let sendSucceeded = false
    const TURN_HARD_TIMEOUT_MS = 90_000
    let hardTimeoutTimer: number | null = null
    try {
      sendSucceeded = await Promise.race([
        runAssistantReplyTurn({
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
          toolIntentPlan,
          turnId,
          isLatestTurn: () => activeTurnIdRef.current === turnId,
        }),
        new Promise<boolean>((resolve) => {
          hardTimeoutTimer = window.setTimeout(() => {
            hardTimeoutTimer = null
            console.warn('[Chat] Turn hard timeout — forcing busy=false')
            void activeStreamAbortRef.current?.().catch(() => undefined)
            activeStreamAbortRef.current = null
            resolve(false)
          }, TURN_HARD_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (hardTimeoutTimer != null) {
        window.clearTimeout(hardTimeoutTimer)
        hardTimeoutTimer = null
      }
      busyRef.current = false
      setBusy(false)
      activeStreamAbortRef.current = null
      void flushDeferredCompanionNotices()
    }

    return sendSucceeded
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
    input,
    busy,
    error,
    assistantActivity,
    petDialogBubble,
    messagesRef,
    inputRef,
    busyRef,
    sendMessageRef,
    setMessages,
    setInput,
    setBusy,
    setError,
    appendChatMessage,
    appendSystemMessage,
    pushCompanionNotice,
    replaceChatHistory,
    exportChatHistory,
    importChatHistory,
    clearChatHistory,
    hidePetDialogBubble,
    sendMessage: stableSendMessage,
  }
}
