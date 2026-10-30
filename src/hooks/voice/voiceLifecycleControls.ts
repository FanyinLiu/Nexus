// Factory that produces the high-level voice lifecycle controls — request a
// restart through VoiceBus, speak the assistant reply (one-shot or streaming),
// and toggle/start/stop the user-facing voice conversation.
//
// External cycles (bindings.startSpeechInterruptMonitor calls back into
// scheduleVoiceRestart) are resolved at the bag level via lifecycleHolder.

import {
  startVoiceConversationEntrypoint,
  stopVoiceConversationEntrypoint,
} from './conversationEntrypoints.ts'
import { speakAssistantReplyRuntime, beginStreamingSpeechReplyRuntime } from './speechReply.ts'
import { createSegmentStyleResolver, type SegmentStyleResolver } from '../../features/voice/voiceEmotion.ts'
import { announceQwen3TtsFallback } from './providerFallbacks.ts'
import type { InterruptMicTurnSource } from '../../features/voice/autoRestartPolicy.ts'
import { humanizeVoiceError } from '../../lib/humanizeError.ts'
import { requestModelSetupForVoiceUse } from '../../lib/modelSetupBridge.ts'
import { voiceDownloadGuidance } from '../../features/setup/voiceDownloadGuidance.ts'
import type { VoiceEmotionCue } from '../../types'
import type { StreamingSpeechOutputController } from './types.ts'
import type { VoiceConversationOptions } from './types.ts'
import { expectHolderValue, type VoiceLifecycle, type VoiceRuntimeBag } from './voiceRuntimeBag.ts'

export function createVoiceLifecycleControls(bag: VoiceRuntimeBag): VoiceLifecycle {
  const {
    ctx,
    refs,
    setters,
    hookCallbacks,
    hearingRuntime,
    bindingsHolder,
    enginesHolder,
  } = bag
  const { ti } = hookCallbacks
  // Handed to the single start that follows a user toggle, then cleared so
  // a later automatic restart does not treat the reminder as still in flight.
  const modelSetupOutcomeRef: { current: Promise<{ remind: boolean }> | undefined } = {
    current: undefined,
  }

  const bindings = expectHolderValue(
    bindingsHolder,
    'createVoiceLifecycleControls: bindings must be built first',
  )
  const engines = expectHolderValue(
    enginesHolder,
    'createVoiceLifecycleControls: engines must be built first',
  )

  // Her live emotion → each sentence's voice. The resolver is called once per
  // queued sentence, so the tone follows that sentence's own cues/heuristics
  // and the snapshot AT THAT MOMENT instead of a value sampled at stream start.
  // The user's base instructions stay in settings untouched; the main process
  // joins them with the per-sentence clause.
  function createVoiceStyleResolver(): SegmentStyleResolver {
    return createSegmentStyleResolver({
      providerId: ctx.settingsRef.current.speechOutputProviderId,
      getEmotion: () => ctx.getEmotionSnapshot?.(),
      getSpeechStyle: () => ctx.getSpeechStyle?.(),
    })
  }

  // ── scheduleVoiceRestart (VoiceBus request facade) ─────────────────────
  function scheduleVoiceRestart(
    statusText = ti('voice.status.resume_listening'),
    delay = 520,
    force?: boolean,
  ) {
    hookCallbacks.busEmit({
      type: 'voice:restart_requested',
      restartReason: force ? 'forced_restart' : 'continuous_restart',
      force: force ?? false,
      delayMs: delay,
      statusText,
    })
  }

  // ── speakAssistantReply ─────────────────────────────────────────────────
  async function speakAssistantReply(
    text: string,
    shouldResumeContinuousVoice: boolean,
    source?: InterruptMicTurnSource,
    cue?: VoiceEmotionCue,
  ) {
    await speakAssistantReplyRuntime({
      text,
      speechGeneration: ++refs.assistantSpeechGenerationRef.current,
      shouldResumeContinuousVoice,
      source,
      currentSettings: ctx.settingsRef.current,
      resolveSegmentVoiceStyle: createVoiceStyleResolver(),
      initialCue: cue ?? null,
      startSpeechOutput: bindings.startSpeechOutput,
      setMood: ctx.setMood,
      setError: ctx.setError,
      busEmit: hookCallbacks.busEmit,
      startSpeechInterruptMonitor: bindings.startSpeechInterruptMonitor,
      stopSpeechInterruptMonitor: bindings.stopSpeechInterruptMonitor,
      isSpeechInterrupted: bindings.isSpeechInterrupted,
      clearSpeechInterruptedFlag: bindings.clearSpeechInterruptedFlag,
      resetSpeechLevel: bindings.resetSpeechLevel,
    })
  }

  // ── beginStreamingSpeechReply ───────────────────────────────────────────
  /**
   * Creates a streaming TTS controller for use during AI streaming responses.
   * The caller feeds text deltas as they arrive; every sentence the stream
   * completes is queued for synthesis immediately, so playback starts while
   * the model is still generating the rest of the reply. `finish()` only
   * closes the stream (and flushes a final short fragment).
   */
  function beginStreamingSpeechReply(
    shouldResumeContinuousVoice: boolean,
    source?: InterruptMicTurnSource,
  ) {
    return beginStreamingSpeechReplyRuntime({
      speechGeneration: ++refs.assistantSpeechGenerationRef.current,
      shouldResumeContinuousVoice,
      source,
      currentSettings: ctx.settingsRef.current,
      resolveSegmentVoiceStyle: createVoiceStyleResolver(),
      setMood: ctx.setMood,
      setError: ctx.setError,
      busEmit: hookCallbacks.busEmit,
      startSpeechInterruptMonitor: bindings.startSpeechInterruptMonitor,
      stopSpeechInterruptMonitor: bindings.stopSpeechInterruptMonitor,
      isSpeechInterrupted: bindings.isSpeechInterrupted,
      clearSpeechInterruptedFlag: bindings.clearSpeechInterruptedFlag,
      resetSpeechLevel: bindings.resetSpeechLevel,
      notifySpeechFallback: () => {
        announceQwen3TtsFallback(hookCallbacks.showPetStatus, ti)
      },
      streamingRuntime: {
        getPlayer: bindings.getStreamAudioPlayer,
        setActiveController: (nextController: StreamingSpeechOutputController | null) => {
          refs.activeStreamingSpeechOutputRef.current = nextController
        },
        resetPlayer: () => {
          refs.streamAudioPlayerRef.current = null
        },
      },
    })
  }

  // ── toggleVoiceConversation ─────────────────────────────────────────────
  function toggleVoiceConversation() {
    ctx.markPresenceActivity()

    if (refs.continuousVoiceActiveRef.current || refs.voiceStateRef.current === 'listening') {
      stopVoiceConversation()
      return
    }

    if (refs.voiceStateRef.current === 'speaking') {
      if (!bindings.canInterruptSpeech()) {
        hookCallbacks.showPetStatus(ti('voice.interruption_disabled'), 2_800, 3_200)
        return
      }

      if (!bindings.interruptSpeakingForVoiceInput()) {
        return
      }
      ctx.setMood('happy')
      hookCallbacks.showPetStatus(ti('voice.pause_before_continue'), 2_400, 3_200)
    }

    // Only user-initiated starts reach here; automatic restarts and
    // wake-word sessions call startVoiceConversation directly.
    // The promise is shared with the entrypoint so a missing-model error
    // waits for this answer and stays quiet when the reminder replaces it.
    const modelSetupOutcome = requestModelSetupForVoiceUse(ctx.view)
    modelSetupOutcomeRef.current = modelSetupOutcome
    void modelSetupOutcome.then((outcome) => {
      // The user refused the installer earlier. The refusal owes them one
      // reminder, and this is the voice action that spends it. The line
      // replaces the missing-model error instead of stacking under it.
      if (!outcome.remind) return
      hookCallbacks.presentCompanionNotice?.(voiceDownloadGuidance(ti, 'model_setup.deferred_reminder'), {
        replacesSurfaceError: true,
      })
    })
    startVoiceConversation()
  }

  // ── startVoiceConversation ──────────────────────────────────────────────
  function startVoiceConversation(options?: VoiceConversationOptions) {
    const modelSetupOutcome = modelSetupOutcomeRef.current
    modelSetupOutcomeRef.current = undefined
    try {
      startVoiceConversationEntrypoint({
        options,
        modelSetupOutcome,
        settingsRef: ctx.settingsRef,
        busyRef: ctx.busyRef,
        activeVoiceConversationOptionsRef: refs.activeVoiceConversationOptionsRef,
        voiceStateRef: refs.voiceStateRef,
        suppressVoiceReplyRef: refs.suppressVoiceReplyRef,
        recognitionRef: refs.recognitionRef,
        vadSessionRef: refs.vadSessionRef,
        paraformerSessionRef: refs.paraformerSessionRef,
        sensevoiceSessionRef: refs.sensevoiceSessionRef,
        tencentAsrSessionRef: refs.tencentAsrSessionRef,
        paraformerStartingRef: refs.paraformerStartingRef,
        sensevoiceStartingRef: refs.sensevoiceStartingRef,
        clearPendingVoiceRestart: hookCallbacks.clearPendingVoiceRestart,
        canInterruptSpeech: bindings.canInterruptSpeech,
        interruptSpeakingForVoiceInput: bindings.interruptSpeakingForVoiceInput,
        setContinuousVoiceSession: bindings.setContinuousVoiceSession,
        shouldKeepContinuousVoiceSession: bindings.shouldKeepContinuousVoiceSession,
        resetNoSpeechRestartCount: bindings.resetNoSpeechRestartCount,
        beginVoiceListeningSession: bindings.beginVoiceListeningSession,
        dispatchVoiceSessionAndSync: bindings.dispatchVoiceSessionAndSync,
        setMood: ctx.setMood,
        setError: ctx.setError,
        setLiveTranscript: setters.setLiveTranscript,
        updateVoicePipeline: hookCallbacks.updateVoicePipeline,
        showPetStatus: hookCallbacks.showPetStatus,
        presentCompanionNotice: hookCallbacks.presentCompanionNotice,
        handleRecognizedVoiceTranscript: bindings.handleRecognizedVoiceTranscript,
        handleVoiceListeningFailure: bindings.handleVoiceListeningFailure,
        shouldAutoRestartVoice: bindings.shouldAutoRestartVoice,
        scheduleVoiceRestart,
        ensureSupportedSpeechInputSettings: hookCallbacks.ensureSupportedSpeechInputSettings,
        startParaformerConversation: engines.startParaformerVoiceConversation,
        startSenseVoiceConversation: engines.startSenseVoiceConversation,
        startTencentAsrConversation: engines.startTencentAsrConversation,
        startVadVoiceConversation: engines.startVadVoiceConversation,
        startApiVoiceConversation: engines.startApiVoiceConversation,
        ti,
      })
    } catch (err) {
      console.error('[Voice] startVoiceConversation failed:', err)
      ctx.setError(humanizeVoiceError(err, { ti }))
      setters.setVoiceState('idle')
      bindings.resetSpeechLevel()
    }
  }

  // ── stopVoiceConversation ───────────────────────────────────────────────
  function stopVoiceConversation() {
    hearingRuntime.clearEngine()
    stopVoiceConversationEntrypoint({
      continuousVoiceActiveRef: refs.continuousVoiceActiveRef,
      suppressVoiceReplyRef: refs.suppressVoiceReplyRef,
      recognitionRef: refs.recognitionRef,
      paraformerSessionRef: refs.paraformerSessionRef,
      sensevoiceSessionRef: refs.sensevoiceSessionRef,
      tencentAsrSessionRef: refs.tencentAsrSessionRef,
      clearPendingVoiceRestart: hookCallbacks.clearPendingVoiceRestart,
      setContinuousVoiceSession: bindings.setContinuousVoiceSession,
      resetNoSpeechRestartCount: bindings.resetNoSpeechRestartCount,
      resetSpeechLevel: bindings.resetSpeechLevel,
      clearParaformerConversationState: bindings.clearParaformerConversationState,
      clearSenseVoiceConversationState: bindings.clearSenseVoiceConversationState,
      clearTencentConversationState: bindings.clearTencentConversationState,
      stopApiRecording: bindings.stopApiRecording,
      stopVadListening: bindings.stopVadListening,
      stopActiveSpeechOutput: bindings.stopActiveSpeechOutput,
      dispatchVoiceSessionAndSync: bindings.dispatchVoiceSessionAndSync,
      setLiveTranscript: setters.setLiveTranscript,
      setMood: ctx.setMood,
      updateVoicePipeline: hookCallbacks.updateVoicePipeline,
      showPetStatus: hookCallbacks.showPetStatus,
      ti,
    })
  }

  return {
    scheduleVoiceRestart,
    speakAssistantReply,
    beginStreamingSpeechReply,
    toggleVoiceConversation,
    startVoiceConversation,
    stopVoiceConversation,
  }
}
