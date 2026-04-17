// Factory that produces the high-level voice lifecycle controls — schedule
// restart, speak the assistant reply (one-shot or streaming), toggle/start/
// stop the user-facing voice conversation.  These functions form a small
// internal cycle (scheduleVoiceRestart ↔ startVoiceConversation) which is
// resolved by JS function-declaration hoisting inside this factory.
//
// External cycles (bindings.startSpeechInterruptMonitor calls back into
// scheduleVoiceRestart) are resolved at the bag level via lifecycleHolder.

import {
  startVoiceConversationEntrypoint,
  stopVoiceConversationEntrypoint,
} from './conversationEntrypoints'
import { scheduleVoiceRestart as scheduleContinuousVoiceRestart } from './continuousVoice'
import { speakAssistantReplyRuntime, beginStreamingSpeechReplyRuntime } from './speechReply'
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

  const bindings = expectHolderValue(
    bindingsHolder,
    'createVoiceLifecycleControls: bindings must be built first',
  )
  const engines = expectHolderValue(
    enginesHolder,
    'createVoiceLifecycleControls: engines must be built first',
  )

  // ── scheduleVoiceRestart (calls startVoiceConversation, hoisted below) ──
  function scheduleVoiceRestart(
    statusText = '我继续收音，你可以接着说。',
    delay = 520,
    force?: boolean,
  ) {
    scheduleContinuousVoiceRestart({
      restartVoiceTimerRef: refs.restartVoiceTimerRef,
      recognitionRef: refs.recognitionRef,
      vadSessionRef: refs.vadSessionRef,
      busyRef: ctx.busyRef,
      voiceStateRef: refs.voiceStateRef,
      shouldAutoRestartVoice: bindings.shouldAutoRestartVoice,
      showPetStatus: hookCallbacks.showPetStatus,
      startVoiceConversation,
      statusText,
      delay,
      force,
    })
  }

  // ── speakAssistantReply ─────────────────────────────────────────────────
  async function speakAssistantReply(text: string, shouldResumeContinuousVoice: boolean) {
    await speakAssistantReplyRuntime({
      text,
      speechGeneration: ++refs.assistantSpeechGenerationRef.current,
      shouldResumeContinuousVoice,
      currentSettings: ctx.settingsRef.current,
      startSpeechOutput: bindings.startSpeechOutput,
      setMood: ctx.setMood,
      setError: ctx.setError,
      busEmit: hookCallbacks.busEmit,
      startSpeechInterruptMonitor: bindings.startSpeechInterruptMonitor,
      stopSpeechInterruptMonitor: bindings.stopSpeechInterruptMonitor,
      isSpeechInterrupted: bindings.isSpeechInterrupted,
      clearSpeechInterruptedFlag: bindings.clearSpeechInterruptedFlag,
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
      currentSettings: ctx.settingsRef.current,
      setMood: ctx.setMood,
      setError: ctx.setError,
      busEmit: hookCallbacks.busEmit,
      startSpeechInterruptMonitor: bindings.startSpeechInterruptMonitor,
      stopSpeechInterruptMonitor: bindings.stopSpeechInterruptMonitor,
      isSpeechInterrupted: bindings.isSpeechInterrupted,
      clearSpeechInterruptedFlag: bindings.clearSpeechInterruptedFlag,
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
        hookCallbacks.showPetStatus('当前关闭了语音打断，请等我说完。', 2_800, 3_200)
        return
      }

      if (!bindings.interruptSpeakingForVoiceInput()) {
        return
      }
      ctx.setMood('happy')
      hookCallbacks.showPetStatus('先停下播报，你继续说。', 2_400, 3_200)
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
      })
    } catch (err) {
      console.error('[Voice] startVoiceConversation failed:', err)
      ctx.setError(err instanceof Error ? err.message : '语音启动失败，请重试。')
      setters.setVoiceState('idle')
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
