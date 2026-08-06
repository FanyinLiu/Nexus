import { applyChatOutputTransforms } from '../../../features/chat/chatOutputTransforms.ts'
import type { requestAssistantReplyStreaming } from '../../../features/chat/runtime.ts'
import { recordUsage } from '../../../features/metering/contextMeter.ts'
import {
  createDailyMemoryEntry,
} from '../../../features/memory/memory.ts'
import { buildChatMemoryTrace } from '../../../features/memory/recallTrace.ts'
import { shouldGenerateSkill, generateAndSaveSkill } from '../../../features/skills/autoSkillGenerator.ts'
import { captureUserAffectSample } from '../../../features/autonomy/userAffectTimeline.ts'
import { userMoodReadToEmotionSignal, userMoodReadToVAD } from '../../../features/autonomy/emotionModel.ts'
import { recordFirstConversationTelemetry } from '../../../features/onboarding/firstConversationTelemetry.ts'
import { PUBLIC_GESTURE_NAMES } from '../../../features/pet/models.ts'
import {
  extractPerformanceTags,
  parseAssistantPerformanceContent,
} from '../../../features/pet/performance.ts'
import {
  consumeCallback,
} from '../../../features/memory/callbackStore.ts'
import { logVoiceEvent } from '../../../features/voice/shared.ts'
import { shorten } from '../../../lib/common.ts'
import { humanizeError } from '../../../lib/humanizeError.ts'
import { createId } from '../../../lib/index.ts'
import { t } from '../../../i18n/runtime.ts'
import type {
  AppSettings,
  ChatMessage,
} from '../../../types/index.ts'
import { getSpeechOutputErrorMessage } from '../support.ts'
import type { AssembledAssistantPrompt } from './promptAssembly.ts'
import type {
  AssistantReplyRunnerDependencies,
  AssistantReplyRunnerOptions,
  AssistantTurnState,
} from './types.ts'

type AssistantReplyStreamResponse = Awaited<ReturnType<typeof requestAssistantReplyStreaming>>

function isSpeechAuthFailure(error: unknown): boolean {
  const message = getSpeechOutputErrorMessage(error)
  return /(api\s*key|api\s*secret|authorization|bearer|credential|unauthori[sz]ed|\b401\b|\b403\b|鉴权|认证|授权|登录|login)/i
    .test(message)
}

/**
 * Stage 3 of the assistant turn: transform the raw model output into the
 * committed assistant message (output transforms → performance tags → display
 * vs spoken split), run the side-effect fan-out (memories, telemetry, cues,
 * skills), then settle speech playback — streaming TTS, direct-speech
 * fallback, or a plain bus completion.
 */
export async function postProcessAssistantReply(
  dependencies: AssistantReplyRunnerDependencies,
  options: AssistantReplyRunnerOptions,
  turnState: AssistantTurnState,
  assembled: AssembledAssistantPrompt,
  response: AssistantReplyStreamResponse,
): Promise<boolean> {
  const {
    currentSettings,
    nextMessages,
    content,
    source,
    fromVoice,
    traceId,
    traceLabel,
    shouldResumeContinuousVoice,
    turnId,
    isLatestTurn,
  } = options
  const { memoryContext, mcpTools } = assembled
  const memoryPaused = turnState.memoryPaused
  const chatToolResult = turnState.chatToolResult
  const builtInToolCallNames = turnState.builtInToolCallNames
  const streamingTtsController = turnState.streamingTtsControllerHolder

  if (response.usedFallback && response.settingsPatch) {
    const applyFallbackPatch = dependencies.ctx.applySettingsUpdate
      ?? ((update: (current: AppSettings) => AppSettings) => {
        const patchedSettings = update(dependencies.ctx.settingsRef.current)
        dependencies.ctx.settingsRef.current = patchedSettings
        dependencies.ctx.setSettings(patchedSettings)
        return patchedSettings
      })

    await applyFallbackPatch((current: AppSettings) => ({
      ...current,
      ...response.settingsPatch,
    }))
    dependencies.ctx.appendDebugConsoleEvent({
      source: 'system',
      title: 'Chat model auto-failover applied',
      detail: `${currentSettings.apiProviderId} -> ${response.providerId}`,
      tone: 'warning',
    })
  }

  logVoiceEvent('assistant reply received', {
    source,
    responseLength: response.response.content.length,
  })

  // Pass full message history (joined) as input text so contextMeter token
  // counts reflect the actual context window, not just the last user turn.
  const allInputText = nextMessages.map((m) => m.content).join('\n')
  recordUsage('chat', allInputText, response.response.content, { modelId: currentSettings.model })
  // User-configured regex transforms (Settings → chatOutputTransforms). Run
  // BEFORE parseAssistantPerformanceContent so rules that target raw LLM
  // output (strip <thinking>, drop *actions*, normalise quirks) take
  // effect before the perf parser pulls displayContent vs spokenContent
  // apart. An empty / missing rule list is a no-op.
  const transformedAssistantText = applyChatOutputTransforms(
    response.response.content,
    currentSettings.chatOutputTransforms,
  )
  // Inline [expr|motion|tts:name] overrides — ephemeral per-reply cues.
  // Tags are stripped here so they never leak into displayContent /
  // spokenContent, and the collected cues get queued alongside whatever
  // the stage-direction parser emits (see queuePetPerformanceCue below).
  // tts cues are parsed but discarded until an emotion-aware TTS adapter
  // lands.
  const {
    content: rawAssistantText,
    exprCues: inlineExpressionOverrideCues,
    motionCues: inlineMotionCues,
    recallCues: inlineRecallCues,
    moodCues: inlineMoodCues,
  } = extractPerformanceTags(transformedAssistantText)
  const GESTURE_CUE_DURATION_MS = 1_600
  const PUBLIC_GESTURE_SET = new Set<string>(PUBLIC_GESTURE_NAMES)
  const inlineGestureCues = inlineMotionCues
    .filter((motion) => PUBLIC_GESTURE_SET.has(motion.gestureName))
    .map((motion) => ({
      gestureName: motion.gestureName,
      durationMs: GESTURE_CUE_DURATION_MS,
      stageDirection: motion.stageDirection,
    }))
  // The LLM used [recall:<id>] — drop those memories from the callback
  // queue so the next dream cycle doesn't re-suggest them, and bump
  // their lastRecalledAt so the recency cooldown applies.
  if (inlineRecallCues.length) {
    const recalledIds = new Set<string>()
    for (const cue of inlineRecallCues) {
      consumeCallback(cue.memoryId)
      recalledIds.add(cue.memoryId)
    }
    if (!memoryPaused && recalledIds.size && dependencies.onMemoryRecalled) {
      dependencies.onMemoryRecalled([...recalledIds])
    }
  }
  // The model's invisible [mood:...] read of the user — the deep-emotion
  // channel. One read per reply: a VAD sample for the user-affect
  // timeline (confidence 0.8: full-context inference beats regex), plus
  // a companion empathy signal for clear reads. Best-effort: an emotion
  // bookkeeping failure must never affect the reply.
  if (inlineMoodCues.length) {
    try {
      const moodRead = inlineMoodCues[0]
      captureUserAffectSample({
        ...userMoodReadToVAD(moodRead.mood, moodRead.intensity),
        source: 'llm_read',
        confidence: 0.8,
      })
      const moodSignal = userMoodReadToEmotionSignal(moodRead.mood, moodRead.intensity)
      if (moodSignal) dependencies.ctx.onUserMoodSignal?.(moodSignal)
    } catch (moodError) {
      console.warn('[chat] mood-read bookkeeping failed:', moodError)
    }
  }
  const assistantPerformance = parseAssistantPerformanceContent(rawAssistantText)
  const assistantMessageContent = assistantPerformance.displayContent
    || (assistantPerformance.stageDirections.length ? t('chat.assistant.stage_direction_fallback') : t('chat.assistant.empty_speech_fallback'))
  const assistantReplyForStatus = assistantPerformance.spokenContent
    || assistantMessageContent
    || t('chat.assistant.stage_status_fallback')

  if (!isLatestTurn()) {
    logVoiceEvent('assistant reply ignored because a newer turn is active', {
      source,
      turnPresent: Boolean(turnId),
    })
    return false
  }
  const assistantSpeechOutput = assistantPerformance.spokenContent || assistantMessageContent

  if (assistantMessageContent || chatToolResult) {
    dependencies.presentPetDialogBubble(
      {
        content: assistantMessageContent,
        toolResult: chatToolResult,
        streaming: false,
      },
      { autoHideMs: chatToolResult ? 14_000 : 9_000 },
    )
  }

  const assistantMessage: ChatMessage = {
    id: createId('msg'),
    role: 'assistant',
    content: assistantMessageContent,
    createdAt: new Date().toISOString(),
    memoryTrace: buildChatMemoryTrace({ memoryContext, memoryPaused }),
    ...(response.response.reasoning_content
      ? { reasoning_content: response.response.reasoning_content }
      : {}),
  }

  dependencies.appendChatMessage(assistantMessage)
  if (source === 'text' || source === 'voice') {
    const firstConversationTelemetry = recordFirstConversationTelemetry(new Date(assistantMessage.createdAt))
    if (firstConversationTelemetry) {
      const elapsedSeconds = Math.round(firstConversationTelemetry.elapsedMs / 1000)
      dependencies.ctx.appendDebugConsoleEvent({
        source: 'system',
        title: firstConversationTelemetry.withinTarget
          ? 'First conversation target met'
          : 'First conversation target missed',
        detail: `First assistant reply arrived after ${elapsedSeconds}s; target is ${firstConversationTelemetry.targetMinutes}min.`,
        tone: firstConversationTelemetry.withinTarget ? 'success' : 'warning',
      })
    }
  }
  try {
    // Bridge listeners (Telegram/Discord auto-reply) hang off this; their
    // failures must never break the chat turn itself.
    dependencies.ctx.onAssistantReplyDelivered?.({
      source,
      displayText: assistantMessageContent,
      spokenText: assistantSpeechOutput,
    })
  } catch (listenerError) {
    console.warn('[chat] onAssistantReplyDelivered listener failed:', listenerError)
  }
  if (!memoryPaused) {
    dependencies.ctx.appendDailyMemoryEntries(
      [createDailyMemoryEntry(assistantMessage, fromVoice ? 'voice' : 'chat')].filter(
        (entry): entry is NonNullable<ReturnType<typeof createDailyMemoryEntry>> => Boolean(entry),
      ),
    )
  }
  dependencies.ctx.queuePetPerformanceCue([
    ...assistantPerformance.cues,
    ...inlineExpressionOverrideCues,
    ...inlineGestureCues,
  ])
  dependencies.ctx.setMood('happy')

  // Auto-generate skill document if the response was complex enough
  const toolCallNames = [
    ...builtInToolCallNames,
    ...(mcpTools ?? []).filter((t) => response.response.tool_calls?.some((tc) => tc.function.name === t.name)).map((t) => t.name),
  ]
  if (shouldGenerateSkill({ userQuery: content, assistantReply: response.response.content, toolCallNames, settings: currentSettings })) {
    void generateAndSaveSkill({ userQuery: content, assistantReply: response.response.content, toolCallNames, settings: currentSettings })
  }

  if (fromVoice) {
    dependencies.ctx.updateVoicePipeline('reply_received', t('chat.assistant.voice_reply_received', { preview: shorten(assistantReplyForStatus, 36) }), content)
    dependencies.ctx.appendVoiceTrace(t('chat.assistant.voice_reply_label'), `#${traceLabel} ${shorten(assistantReplyForStatus, 32)}`, 'success')
  }

  if (!assistantMessageContent && !chatToolResult && assistantReplyForStatus) {
    dependencies.ctx.updatePetStatus(shorten(assistantReplyForStatus, 24), 2_400)
  }

  const activeStreamingTtsController = streamingTtsController && assistantSpeechOutput
    ? streamingTtsController
    : null
  // Finish and abandon leaked controller that will never be awaited
  if (streamingTtsController && !activeStreamingTtsController) {
    streamingTtsController.finish()
  }
  const handledByStreamingTts = Boolean(activeStreamingTtsController)
  let shouldFallbackToDirectSpeech = false
  let ttsWaitTimedOut = false

  if (handledByStreamingTts) {
    const streamingSpeechController = activeStreamingTtsController!
    // Don't block the chat turn on TTS completion — let voice play in background.
    // This prevents the "回复中..." hang when TTS streams get stuck.
    const TTS_WAIT_TIMEOUT_MS = 12_000
    let ttsWaitTimeoutId: number | null = null
    try {
      await Promise.race([
        streamingSpeechController.waitForCompletion(),
        new Promise<void>((resolve) => {
          ttsWaitTimeoutId = window.setTimeout(() => {
            ttsWaitTimedOut = true
            // info, not warn — by design we unblock the chat turn after
            // 12s and let voice continue in the background. This is the
            // normal long-TTS path, not a failure.
            console.info('[Chat] TTS wait timeout (expected) — unblocking chat turn, voice continues in background')
            resolve()
          }, TTS_WAIT_TIMEOUT_MS)
        }),
      ])
      // Only fallback if TTS genuinely didn't start AND didn't time out
      // (timeout means it's still trying — don't double-play)
      if (!ttsWaitTimedOut && !streamingSpeechController.hasStarted()) {
        shouldFallbackToDirectSpeech = true
        logVoiceEvent('streaming speech finished without playback, falling back to direct speech', {
          source,
          speechLength: assistantSpeechOutput.length,
        })
      }
    } catch (speechError) {
      if (!streamingSpeechController.hasStarted()) {
        if (isSpeechAuthFailure(speechError)) {
          dependencies.handleSpeechPlaybackFailure(speechError, {
            traceId,
            traceLabel,
            source,
            fromVoice,
            shouldResumeContinuousVoice,
          })
        } else {
          shouldFallbackToDirectSpeech = true
          logVoiceEvent('streaming speech failed before playback, falling back to direct speech', {
            source,
            errorPresent: Boolean(getSpeechOutputErrorMessage(speechError)),
          })
        }
      } else {
        dependencies.handleSpeechPlaybackFailure(speechError, {
          traceId,
          traceLabel,
          source,
          fromVoice,
          shouldResumeContinuousVoice,
        })
      }
    } finally {
      if (ttsWaitTimeoutId !== null) {
        window.clearTimeout(ttsWaitTimeoutId)
      }
    }
  }

  if (
    shouldFallbackToDirectSpeech
    && currentSettings.speechOutputEnabled
    && assistantSpeechOutput
    && !(fromVoice && dependencies.ctx.suppressVoiceReplyRef.current)
  ) {
    try {
      await dependencies.ctx.speakAssistantReply(assistantSpeechOutput, shouldResumeContinuousVoice)
    } catch (speechError) {
      dependencies.handleSpeechPlaybackFailure(speechError, {
        traceId,
        traceLabel,
        source,
        fromVoice,
        shouldResumeContinuousVoice,
      })
    }
  } else if (handledByStreamingTts) {
    // Streaming TTS handles playback via its own onEnd callback.
    // But if we timed out waiting, the callback may not have fired yet —
    // ensure voice state recovers so the user can keep talking.
    if (ttsWaitTimedOut && shouldResumeContinuousVoice) {
      // Bus drives voiceState → 'idle' + restart_voice effect
      dependencies.ctx.busEmit({
        type: 'tts:completed',
        speechGeneration: 0,
        shouldResumeContinuousVoice: true,
      })
    }
  } else if (
    currentSettings.speechOutputEnabled
    && assistantSpeechOutput
    && !(fromVoice && dependencies.ctx.suppressVoiceReplyRef.current)
  ) {
    try {
      await dependencies.ctx.speakAssistantReply(assistantSpeechOutput, shouldResumeContinuousVoice)
    } catch (speechError) {
      dependencies.handleSpeechPlaybackFailure(speechError, {
        traceId,
        traceLabel,
        source,
        fromVoice,
        shouldResumeContinuousVoice,
      })
    }
  } else {
    // No TTS playback — emit session:completed for bus phase → idle,
    // plus restart_voice if the turn originated from voice input.
    if (shouldResumeContinuousVoice) {
      dependencies.ctx.busEmit({
        type: 'tts:completed',
        speechGeneration: 0,
        shouldResumeContinuousVoice: true,
      })
    } else {
      dependencies.ctx.busEmit({ type: 'session:completed' })
    }
  }

  return true
}

/**
 * Failure path of the assistant turn (the original runner's catch block).
 * Stale-turn errors are swallowed silently; current-turn errors surface a
 * humanized message on every user-facing surface while the raw provider text
 * stays on diagnostic surfaces.
 */
export function handleAssistantTurnFailure(
  dependencies: AssistantReplyRunnerDependencies,
  options: AssistantReplyRunnerOptions,
  turnState: AssistantTurnState,
  caught: unknown,
): boolean {
  const {
    content,
    source,
    fromVoice,
    traceLabel,
    shouldResumeContinuousVoice,
    isLatestTurn,
  } = options
  const streamingTtsControllerHolder = turnState.streamingTtsControllerHolder

  if (!isLatestTurn()) {
    // A user cancellation invalidates the turn before aborting transport.
    // Stop any already-created TTS controller too, but never surface the
    // transport error or append an assistant failure message for a stale turn.
    if (streamingTtsControllerHolder) {
      void streamingTtsControllerHolder.waitForCompletion().catch(() => undefined)
      try { streamingTtsControllerHolder.abort() } catch (abortError) {
        console.warn('[assistantReply] stale streaming TTS abort failed', abortError)
      }
    }
    return false
  }

  // errorMessage = raw provider/runtime text, kept for diagnostic surfaces
  // (logs, voice trace, bus abort reason). friendlyMessage = the same error
  // mapped to localized, actionable companion copy with secrets redacted —
  // used for everything the end user actually reads. Mid-chat 404/429/5xx/
  // ECONNREFUSED previously surfaced the raw provider string here.
  const errorMessage = caught instanceof Error ? caught.message : t('chat.assistant.send_failed_fallback')
  try {
    // She noticed something went wrong — error_occurred emotion signal.
    dependencies.ctx.onAssistantReplyFailed?.()
  } catch {
    // never mask the original failure
  }
  const friendlyMessage = humanizeError(caught, 'chat')
  logVoiceEvent('assistant reply failed', {
    source,
    errorPresent: Boolean(errorMessage),
  })
  // Streaming controller would otherwise sit in `finishRequested=false`
  // forever — its onEnd never fires, the upstream voiceSessionMachine
  // never sees `tts:completed`, and SPEAKING wedges. Calling finish()
  // here triggers the early-return settle path with onEnd(), which
  // emits tts:completed and unwedges voiceState.
  if (streamingTtsControllerHolder) {
    try { streamingTtsControllerHolder.finish() } catch (finishErr) {
      console.warn('[assistantReply] streaming TTS finish() during error handler failed', finishErr)
    }
  }
  dependencies.ctx.setMood('confused')
  dependencies.presentPetDialogBubble(
    {
      content: t('chat.assistant.failure_bubble', { error: friendlyMessage }),
      streaming: false,
    },
    { autoHideMs: 9_000 },
  )

  if (fromVoice) {
    dependencies.ctx.updateVoicePipeline('reply_failed', t('chat.assistant.voice_send_failed_status', { preview: shorten(friendlyMessage, 40) }), content)
    dependencies.ctx.appendVoiceTrace(t('chat.assistant.voice_request_failed_label'), `#${traceLabel} ${shorten(errorMessage, 48)}`, 'error')
    dependencies.appendSystemMessage(
      t('chat.assistant.voice_send_failed_system', { error: friendlyMessage }),
      'error',
    )
  }

  dependencies.setError(fromVoice ? t('chat.assistant.voice_send_failed_summary', { error: friendlyMessage }) : friendlyMessage)
  // Bus drives voiceState → 'idle'
  dependencies.ctx.busEmit({
    type: 'session:aborted',
    reason: 'session_aborted',
    abortReason: errorMessage,
  })
  if (shouldResumeContinuousVoice) {
    dependencies.ctx.clearPendingVoiceRestart()
    dependencies.ctx.resetNoSpeechRestartCount()
    dependencies.ctx.updatePetStatus(t('chat.assistant.voice_paused_pet_status'), 3200)
    // Longer delay so the user has time to read the error bubble before
    // the mic re-opens — otherwise the no-speech toast stacks on top of
    // the error and it looks like the UI is thrashing.
    dependencies.ctx.busEmit({
      type: 'voice:restart_requested',
      restartReason: 'error_recovery',
      force: true,
      delayMs: 3200,
    })
  } else if (fromVoice) {
    dependencies.ctx.updatePetStatus(t('chat.assistant.voice_retry_pet_status'), 3200)
  }
  window.setTimeout(() => dependencies.ctx.setMood('idle'), 2600)
  return false
}
