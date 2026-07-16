// Factory that produces the high-level voice lifecycle controls — request a
// restart through VoiceBus, speak the assistant reply (one-shot or streaming),
// and toggle/start/stop the user-facing voice conversation.
//
// External cycles (bindings.startSpeechInterruptMonitor calls back into
// scheduleVoiceRestart) are resolved at the bag level via lifecycleHolder.

import {
  startVoiceConversationEntrypoint,
  stopVoiceConversationEntrypoint,
} from './conversationEntrypoints'
import { speakAssistantReplyRuntime, beginStreamingSpeechReplyRuntime } from './speechReply'
import { combineVoiceInstructions, emotionToVoiceRate, emotionToVoiceStyle } from '../../features/autonomy/emotionModel.ts'
import type { AppSettings } from '../../types'
import type { StreamingSpeechOutputController } from './types'
import type { VoiceConversationOptions } from './types'
import { expectHolderValue, type VoiceLifecycle, type VoiceRuntimeBag } from './voiceRuntimeBag'

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

  const bindings = expectHolderValue(
    bindingsHolder,
    'createVoiceLifecycleControls: bindings must be built first',
  )
  const engines = expectHolderValue(
    enginesHolder,
    'createVoiceLifecycleControls: engines must be built first',
  )

  // Her live emotion → her voice, folded into the settings the speak runtimes
  // consume: a style instruction (instruction-aware providers) AND a pace
  // nudge (universal — every provider honours rate). Same mood source as the
  // avatar, so voice and expression agree.
  function settingsWithEmotionVoice(): AppSettings {
    const base = ctx.settingsRef.current
    const snapshot = ctx.getEmotionSnapshot?.()
    if (!snapshot) return base
    const emotionStyle = emotionToVoiceStyle(snapshot)
    const emotionRate = emotionToVoiceRate(snapshot, base.speechRate)
    if (!emotionStyle && emotionRate === base.speechRate) return base
    return {
      ...base,
      speechOutputInstructions: combineVoiceInstructions(base.speechOutputInstructions, emotionStyle),
      speechRate: emotionRate,
    }
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
  async function speakAssistantReply(text: string, shouldResumeContinuousVoice: boolean) {
    await speakAssistantReplyRuntime({
      text,
      speechGeneration: ++refs.assistantSpeechGenerationRef.current,
      shouldResumeContinuousVoice,
      currentSettings: settingsWithEmotionVoice(),
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
   * Returns an object with pushDelta/finish/waitForCompletion methods.
   * The caller feeds text deltas as they arrive from the AI, and audio starts
   * playing as soon as the first sentence completes — no waiting for the full
   * response.
   */
  function beginStreamingSpeechReply(shouldResumeContinuousVoice: boolean) {
    return beginStreamingSpeechReplyRuntime({
      speechGeneration: ++refs.assistantSpeechGenerationRef.current,
      shouldResumeContinuousVoice,
      currentSettings: settingsWithEmotionVoice(),
      setMood: ctx.setMood,
      setError: ctx.setError,
      busEmit: hookCallbacks.busEmit,
      startSpeechInterruptMonitor: bindings.startSpeechInterruptMonitor,
      stopSpeechInterruptMonitor: bindings.stopSpeechInterruptMonitor,
      isSpeechInterrupted: bindings.isSpeechInterrupted,
      clearSpeechInterruptedFlag: bindings.clearSpeechInterruptedFlag,
      resetSpeechLevel: bindings.resetSpeechLevel,
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

    startVoiceConversation()
  }

  // ── startVoiceConversation ──────────────────────────────────────────────
  function startVoiceConversation(options?: VoiceConversationOptions) {
    try {
      startVoiceConversationEntrypoint({
        options,
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
        handleRecognizedVoiceTranscript: bindings.handleRecognizedVoiceTranscript,
        handleVoiceListeningFailure: bindings.handleVoiceListeningFailure,
        shouldAutoRestartVoice: bindings.shouldAutoRestartVoice,
        scheduleVoiceRestart,
        ensureSupportedSpeechInputSettings: hookCallbacks.ensureSupportedSpeechInputSettings,
        startParaformerConversation: engines.startParaformerVoiceConversation,
        startSenseVoiceConversation: engines.startSenseVoiceVoiceConversation,
        startTencentAsrConversation: engines.startTencentAsrConversation,
        startVadVoiceConversation: engines.startVadVoiceConversation,
        startApiVoiceConversation: engines.startApiVoiceConversation,
        ti,
      })
    } catch (err) {
      console.error('[Voice] startVoiceConversation failed:', err)
      ctx.setError(err instanceof Error ? err.message : ti('voice.start_failed'))
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
