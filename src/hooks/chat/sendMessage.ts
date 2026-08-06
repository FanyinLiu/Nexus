import type { Dispatch, SetStateAction } from 'react'
import {
  classifyCrisisSecondPass,
  detectCrisisSignal,
  presentCrisis,
  shouldPresentCrisisPanel,
} from '../../features/safety/index.ts'
import { noteUserMessageAndCheckReminder } from '../../features/safety/disclosureState.ts'
import {
  createDailyMemoryEntry,
  extractMemoriesFromMessage,
  mergeMemories,
} from '../../features/memory/index.ts'
import { formatTraceLabel, logVoiceEvent } from '../../features/voice/index.ts'
import { createId, shorten } from '../../lib/index.ts'
import type { Translator } from '../../types/i18n.ts'
import type {
  ChatMessage,
  ChatMessageTone,
  DailyMemoryEntry,
} from '../../types/index.ts'
import type { AssistantReplyRunnerOptions } from './assistantReply.ts'
import type { LocalReminderActionOptions } from './reminders.ts'
import { resolveReminderIntentWithPendingDraft } from './reminders.ts'
import { handleSlashCommand } from './slashCommands.ts'
import {
  releaseChatSubmission,
  shouldClearSubmittedInput,
  tryAcquireChatSubmission,
} from './submissionGuard.ts'
import { executeAssistantTurn } from './turnExecution.ts'
import type { PendingReminderDraft, UseChatContext } from './types.ts'

type SendMessageOptions = {
  source?: 'text' | 'voice' | 'telegram' | 'discord' | 'notification'
  traceId?: string
}

type SendMessageDependencies = {
  ctx: UseChatContext
  t: Translator
  messagesRef: { current: ChatMessage[] }
  inputRef: { current: string }
  pendingImageRef: { current: string | null }
  busyRef: { current: boolean }
  submissionLockRef: { current: boolean }
  activeTurnIdRef: { current: number }
  activeStreamAbortRef: { current: (() => Promise<void>) | null }
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
  setBusy: (value: boolean) => void
  setError: (value: string | null) => void
  setInputValue: (value: string) => void
  setPendingImageState: (value: string | null) => void
  hidePetDialogBubble: () => void
  appendSystemMessage: (content: string, tone?: ChatMessageTone) => void
  getPendingReminderDraft: () => PendingReminderDraft | null
  clearPendingReminderDraft: () => void
  runLocalReminderAction: (options: LocalReminderActionOptions) => Promise<boolean>
  runAssistantReplyTurn: (options: AssistantReplyRunnerOptions) => Promise<boolean>
  flushDeferredCompanionNotices: () => Promise<void>
}

/**
 * Builds the per-render sendMessage closure. The factory is invoked on every
 * render (the result feeds sendMessageRef via effect), so the returned async
 * function closes over the current render's t / callbacks exactly like the
 * inline function it replaced.
 */
export function createSendMessageHandler(dependencies: SendMessageDependencies) {
  const {
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
  } = dependencies

  return async function sendMessage(
    rawContent?: string,
    options?: SendMessageOptions,
  ) {
    const currentSettings = ctx.settingsRef.current
    const source = options?.source ?? 'text'
    const fromVoice = source === 'voice'
    const traceId = fromVoice ? (options?.traceId ?? createId('voice')) : ''
    const traceLabel = traceId ? formatTraceLabel(traceId) : ''
    const composerSnapshot = !rawContent ? inputRef.current : null
    const content = (rawContent ?? inputRef.current).trim()
    // Capture the pending image once at the top — we don't want it to disappear
    // mid-flight if the user clears it during send. Voice turns ignore images
    // (they go through the STT pipeline with no composer attachment).
    const attachedImage = !fromVoice && !rawContent ? pendingImageRef.current : null

    if (!content && !attachedImage) {
      if (fromVoice) {
        logVoiceEvent('voice transcript was empty, nothing was sent')
        ctx.updateVoicePipeline('idle', t('chat.voice.empty_pipeline_detail'))
        ctx.appendVoiceTrace(t('chat.voice.empty_label'), t('chat.voice.empty_trace', { label: traceLabel }), 'error')
      }
      return false
    }

    const rejectBusySubmission = () => {
      if (fromVoice) {
        logVoiceEvent('assistant is busy, voice transcript was not sent', { contentLength: content.length })
        ctx.fillComposerWithVoiceTranscript(content)
        ctx.updateVoicePipeline('blocked_busy', t('chat.voice.blocked_detail'), content)
        ctx.appendVoiceTrace(t('chat.voice.blocked_label'), t('chat.voice.blocked_trace', { label: traceLabel }), 'error')
        setError(t('chat.voice.blocked_error'))
        ctx.updatePetStatus(t('chat.voice.blocked_pet_status'), 2_600)
      }
      return false
    }

    // Acquire synchronously before slash parsing or crisis classification so
    // a second submit cannot enter while the safety pass is awaiting a reply.
    if (!tryAcquireChatSubmission(submissionLockRef)) {
      return rejectBusySubmission()
    }

    try {
      const slashResult = await handleSlashCommand(content)
      if (slashResult.handled) {
        if (slashResult.messages) {
          setMessages((prev) => [...prev, ...slashResult.messages!])
        }
        if (composerSnapshot !== null && shouldClearSubmittedInput(inputRef.current, composerSnapshot)) {
          setInputValue('')
        }
        return true
      }

      if (busyRef.current) {
        return rejectBusySubmission()
      }

      // Resume the voice loop after TTS for ALL voice-originated turns. Even
      // in wake-word mode, this gives the user a brief VAD window to speak
      // again immediately after the companion replies, without re-waking.
      // If they don't speak, the noSpeechTimer (3 s, see constants.ts)
      // closes the session and the wake word listener takes over normally.
      const shouldResumeContinuousVoice = fromVoice

      if (ctx.voiceStateRef.current === 'speaking') {
        if (!ctx.canInterruptSpeech()) {
          setError(t('chat.voice.no_interrupt_error'))
          ctx.updatePetStatus(t('chat.voice.no_interrupt_pet_status'), 3_000)
          return false
        }

        ctx.stopActiveSpeechOutput()
        ctx.setVoiceState('idle')
        ctx.setMood('happy')
      }

      hidePetDialogBubble()
      ctx.markPresenceActivity()
      if (fromVoice) {
        ctx.appendVoiceTrace(t('chat.voice.sent_label'), t('chat.voice.sent_trace', { label: traceLabel }))
      }

      // Surface the non-persona hotline panel only for medium/high crisis
      // signals. Low signals still soften the persona reply in the reply path
      // without interrupting the conversation with a hotline panel.
      const patternCrisisSignal = detectCrisisSignal(content, currentSettings.uiLanguage)
      const crisisSignal = await classifyCrisisSecondPass({
        locale: currentSettings.uiLanguage,
        text: content,
        patternSignal: patternCrisisSignal,
        runner: patternCrisisSignal
          ? async ({ system, user }) => {
            const response = await window.desktopPet?.completeChat?.({
              providerId: currentSettings.apiProviderId,
              baseUrl: currentSettings.apiBaseUrl,
              apiKey: currentSettings.apiKey,
              model: currentSettings.model,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
              ],
              temperature: 0,
              maxTokens: 120,
            })
            return response?.content ?? null
          }
          : undefined,
      })
      if (shouldPresentCrisisPanel(crisisSignal)) {
        presentCrisis(crisisSignal)
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
      const nextMemories = mergeMemories(ctx.memoriesRef.current, extractMemoriesFromMessage(userMessage, ctx.getEmotionSnapshot?.()))
      const nextDailyMemories = ctx.appendDailyMemoryEntries(
        [createDailyMemoryEntry(userMessage, fromVoice ? 'voice' : 'chat')].filter(
          (entry): entry is DailyMemoryEntry => Boolean(entry),
        ),
      )

      messagesRef.current = nextMessages
      ctx.memoriesRef.current = nextMemories
      ctx.setMemories(nextMemories)
      setMessages(nextMessages)

      // Periodic AI-disclosure reminder (Tier 1.1 chunk E). Fires every
      // 30 user messages AND every 3 hours of wall-clock since the last
      // reminder, whichever comes second. The check is gated on having
      // ack'd the onboarding disclosure step.
      if (noteUserMessageAndCheckReminder()) {
        appendSystemMessage(t('safety.disclosure.periodic_reminder'))
      }

      if (composerSnapshot !== null && shouldClearSubmittedInput(inputRef.current, composerSnapshot)) {
        setInputValue('')
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
          const errorMessage = localIntentError instanceof Error ? localIntentError.message : t('chat.local_intent.failed')
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
            ctx.updateVoicePipeline('reply_failed', t('chat.local_intent.voice_detail', { preview: shorten(errorMessage, 36) }), content)
            ctx.appendVoiceTrace(t('chat.local_intent.voice_label'), t('chat.local_intent.voice_trace', { label: traceLabel, preview: shorten(errorMessage, 40) }), 'error')
          }
          return false
        }
      }

      // The lock only protects slash handling and preflight classification. The
      // turn runtime synchronously marks busyRef on entry, so release before it
      // starts; the finally below remains an idempotent safety release.
      releaseChatSubmission(submissionLockRef)
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
    } finally {
      releaseChatSubmission(submissionLockRef)
    }
  }
}
