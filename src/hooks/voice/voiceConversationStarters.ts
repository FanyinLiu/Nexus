// Factory that produces the 5 ASR engine conversation starters used by
// useVoice — VAD, Paraformer, SenseVoice, Tencent ASR, and the API-recording
// fallback.  Each starter is just a thin wrapper that calls
// `hearingRuntime.activateEngine(...)` then forwards a large bag of refs and
// callbacks to the corresponding `start*Conversation` runtime helper.

import { startApiRecordingConversation } from './recordingConversations'
import { startParaformerConversation } from './paraformerConversation'
import { startSenseVoiceConversation } from './sensevoiceConversation'
import { startTencentConversation } from './tencentConversation'
import { startVadConversation } from './vadConversation'
import { expectHolderValue, type VoiceEngines, type VoiceRuntimeBag } from './voiceRuntimeBag'
import type { VoiceConversationOptions } from './types'

export function createVoiceConversationStarters(bag: VoiceRuntimeBag): VoiceEngines {
  const { ctx, refs, setters, hearingRuntime, hookCallbacks, bindingsHolder, voiceBus } = bag

  // The bag's bindingsHolder is populated _before_ this factory runs, so we
  // can safely cache the bindings reference at construction time.
  const bindings = expectHolderValue(
    bindingsHolder,
    'createVoiceConversationStarters: bindings must be built first',
  )

  // ── VAD conversation ────────────────────────────────────────────────────
  async function startVadVoiceConversation(
    transcribeMode: 'api' | 'local',
    options?: VoiceConversationOptions,
  ) {
    hearingRuntime.activateEngine('vad')
    await startVadConversation({
      transcribeMode,
      options,
      currentSettings: ctx.settingsRef.current,
      vadSessionRef: refs.vadSessionRef,
      wakewordRuntimeRef: refs.wakewordRuntimeRef,
      voiceEchoCooldownUntilRef: refs.voiceEchoCooldownUntilRef,
      voiceStateRef: refs.voiceStateRef,
      suppressVoiceReplyRef: refs.suppressVoiceReplyRef,
      clearPendingVoiceRestart: hookCallbacks.clearPendingVoiceRestart,
      canInterruptSpeech: bindings.canInterruptSpeech,
      interruptSpeakingForVoiceInput: bindings.interruptSpeakingForVoiceInput,
      setContinuousVoiceSession: bindings.setContinuousVoiceSession,
      shouldKeepContinuousVoiceSession: bindings.shouldKeepContinuousVoiceSession,
      resetNoSpeechRestartCount: bindings.resetNoSpeechRestartCount,
      beginVoiceListeningSession: bindings.beginVoiceListeningSession,
      dispatchVoiceSession: bindings.dispatchVoiceSession,
      dispatchVoiceSessionAndSync: bindings.dispatchVoiceSessionAndSync,
      setVoiceState: setters.setVoiceState,
      setMood: ctx.setMood,
      setError: ctx.setError,
      setLiveTranscript: setters.setLiveTranscript,
      updateVoicePipeline: hookCallbacks.updateVoicePipeline,
      appendVoiceTrace: hookCallbacks.appendVoiceTrace,
      showPetStatus: hookCallbacks.showPetStatus,
      setSpeechLevelValue: bindings.setSpeechLevelValue,
      destroyVadSession: bindings.destroyVadSession,
      handleRecognizedVoiceTranscript: bindings.handleRecognizedVoiceTranscript,
      handleVoiceListeningFailure: bindings.handleVoiceListeningFailure,
      startFallbackConversation: startApiVoiceConversation,
      shouldAutoRestartVoice: bindings.shouldAutoRestartVoice,
      busEmit: (event) => voiceBus.emit(event),
      ti: hookCallbacks.ti,
    })
  }

  // ── Paraformer streaming conversation ───────────────────────────────────
  async function startParaformerVoiceConversation(options?: VoiceConversationOptions) {
    hearingRuntime.activateEngine('paraformer')
    await startParaformerConversation({
      options,
      currentSettings: ctx.settingsRef.current,
      voiceStateRef: refs.voiceStateRef,
      suppressVoiceReplyRef: refs.suppressVoiceReplyRef,
      paraformerSessionRef: refs.paraformerSessionRef,
      paraformerConversationRef: refs.paraformerConversationRef,
      clearPendingVoiceRestart: hookCallbacks.clearPendingVoiceRestart,
      canInterruptSpeech: bindings.canInterruptSpeech,
      interruptSpeakingForVoiceInput: bindings.interruptSpeakingForVoiceInput,
      setContinuousVoiceSession: bindings.setContinuousVoiceSession,
      shouldKeepContinuousVoiceSession: bindings.shouldKeepContinuousVoiceSession,
      resetNoSpeechRestartCount: bindings.resetNoSpeechRestartCount,
      clearParaformerConversationState: bindings.clearParaformerConversationState,
      beginVoiceListeningSession: bindings.beginVoiceListeningSession,
      dispatchVoiceSession: bindings.dispatchVoiceSession,
      dispatchVoiceSessionAndSync: bindings.dispatchVoiceSessionAndSync,
      setVoiceState: setters.setVoiceState,
      setMood: ctx.setMood,
      setError: ctx.setError,
      setLiveTranscript: setters.setLiveTranscript,
      updateVoicePipeline: hookCallbacks.updateVoicePipeline,
      appendVoiceTrace: hookCallbacks.appendVoiceTrace,
      showPetStatus: hookCallbacks.showPetStatus,
      setSpeechLevelValue: bindings.setSpeechLevelValue,
      handleRecognizedVoiceTranscript: bindings.handleRecognizedVoiceTranscript,
      handleVoiceListeningFailure: bindings.handleVoiceListeningFailure,
      shouldAutoRestartVoice: bindings.shouldAutoRestartVoice,
      ti: hookCallbacks.ti,
    })
  }

  // ── SenseVoice offline conversation ─────────────────────────────────────
  async function startSenseVoiceVoiceConversation(options?: VoiceConversationOptions) {
    hearingRuntime.activateEngine('sensevoice')
    await startSenseVoiceConversation({
      options,
      currentSettings: ctx.settingsRef.current,
      voiceStateRef: refs.voiceStateRef,
      suppressVoiceReplyRef: refs.suppressVoiceReplyRef,
      sensevoiceSessionRef: refs.sensevoiceSessionRef,
      sensevoiceConversationRef: refs.sensevoiceConversationRef,
      clearPendingVoiceRestart: hookCallbacks.clearPendingVoiceRestart,
      canInterruptSpeech: bindings.canInterruptSpeech,
      interruptSpeakingForVoiceInput: bindings.interruptSpeakingForVoiceInput,
      setContinuousVoiceSession: bindings.setContinuousVoiceSession,
      shouldKeepContinuousVoiceSession: bindings.shouldKeepContinuousVoiceSession,
      resetNoSpeechRestartCount: bindings.resetNoSpeechRestartCount,
      clearSenseVoiceConversationState: bindings.clearSenseVoiceConversationState,
      beginVoiceListeningSession: bindings.beginVoiceListeningSession,
      dispatchVoiceSession: bindings.dispatchVoiceSession,
      dispatchVoiceSessionAndSync: bindings.dispatchVoiceSessionAndSync,
      setVoiceState: setters.setVoiceState,
      setMood: ctx.setMood,
      setError: ctx.setError,
      setLiveTranscript: setters.setLiveTranscript,
      updateVoicePipeline: hookCallbacks.updateVoicePipeline,
      appendVoiceTrace: hookCallbacks.appendVoiceTrace,
      showPetStatus: hookCallbacks.showPetStatus,
      setSpeechLevelValue: bindings.setSpeechLevelValue,
      handleRecognizedVoiceTranscript: bindings.handleRecognizedVoiceTranscript,
      handleVoiceListeningFailure: bindings.handleVoiceListeningFailure,
      shouldAutoRestartVoice: bindings.shouldAutoRestartVoice,
      applyVoiceEmotion: ctx.applyVoiceEmotion,
      ti: hookCallbacks.ti,
    })
  }

  // ── Tencent Cloud ASR streaming conversation ───────────────────────────
  async function startTencentAsrConversation(options?: VoiceConversationOptions) {
    hearingRuntime.activateEngine('tencent-asr')
    await startTencentConversation({
      options,
      currentSettings: ctx.settingsRef.current,
      voiceStateRef: refs.voiceStateRef,
      suppressVoiceReplyRef: refs.suppressVoiceReplyRef,
      tencentAsrSessionRef: refs.tencentAsrSessionRef,
      tencentConversationRef: refs.tencentConversationRef,
      clearPendingVoiceRestart: hookCallbacks.clearPendingVoiceRestart,
      canInterruptSpeech: bindings.canInterruptSpeech,
      interruptSpeakingForVoiceInput: bindings.interruptSpeakingForVoiceInput,
      setContinuousVoiceSession: bindings.setContinuousVoiceSession,
      shouldKeepContinuousVoiceSession: bindings.shouldKeepContinuousVoiceSession,
      resetNoSpeechRestartCount: bindings.resetNoSpeechRestartCount,
      clearTencentConversationState: bindings.clearTencentConversationState,
      beginVoiceListeningSession: bindings.beginVoiceListeningSession,
      dispatchVoiceSession: bindings.dispatchVoiceSession,
      dispatchVoiceSessionAndSync: bindings.dispatchVoiceSessionAndSync,
      setVoiceState: setters.setVoiceState,
      setMood: ctx.setMood,
      setError: ctx.setError,
      setLiveTranscript: setters.setLiveTranscript,
      updateVoicePipeline: hookCallbacks.updateVoicePipeline,
      appendVoiceTrace: hookCallbacks.appendVoiceTrace,
      showPetStatus: hookCallbacks.showPetStatus,
      setSpeechLevelValue: bindings.setSpeechLevelValue,
      handleRecognizedVoiceTranscript: bindings.handleRecognizedVoiceTranscript,
      handleVoiceListeningFailure: bindings.handleVoiceListeningFailure,
      shouldAutoRestartVoice: bindings.shouldAutoRestartVoice,
      ti: hookCallbacks.ti,
    })
  }

  // ── API recording conversation (fallback target for VAD) ───────────────
  async function startApiVoiceConversation(options?: VoiceConversationOptions) {
    hearingRuntime.activateEngine('api-recording')
    await startApiRecordingConversation({
      options,
      currentSettings: ctx.settingsRef.current,
      apiRecordingRef: refs.apiRecordingRef,
      voiceStateRef: refs.voiceStateRef,
      suppressVoiceReplyRef: refs.suppressVoiceReplyRef,
      clearPendingVoiceRestart: hookCallbacks.clearPendingVoiceRestart,
      canInterruptSpeech: bindings.canInterruptSpeech,
      interruptSpeakingForVoiceInput: bindings.interruptSpeakingForVoiceInput,
      setContinuousVoiceSession: bindings.setContinuousVoiceSession,
      shouldKeepContinuousVoiceSession: bindings.shouldKeepContinuousVoiceSession,
      resetNoSpeechRestartCount: bindings.resetNoSpeechRestartCount,
      stopApiRecording: bindings.stopApiRecording,
      beginVoiceListeningSession: bindings.beginVoiceListeningSession,
      dispatchVoiceSessionAndSync: bindings.dispatchVoiceSessionAndSync,
      setVoiceState: setters.setVoiceState,
      setMood: ctx.setMood,
      setError: ctx.setError,
      setLiveTranscript: setters.setLiveTranscript,
      updateVoicePipeline: hookCallbacks.updateVoicePipeline,
      appendVoiceTrace: hookCallbacks.appendVoiceTrace,
      showPetStatus: hookCallbacks.showPetStatus,
      handleRecognizedVoiceTranscript: bindings.handleRecognizedVoiceTranscript,
      handleVoiceListeningFailure: bindings.handleVoiceListeningFailure,
      shouldAutoRestartVoice: bindings.shouldAutoRestartVoice,
      ti: hookCallbacks.ti,
    })
  }

  return {
    startVadVoiceConversation,
    startParaformerVoiceConversation,
    startSenseVoiceVoiceConversation,
    startTencentAsrConversation,
    startApiVoiceConversation,
  }
}
