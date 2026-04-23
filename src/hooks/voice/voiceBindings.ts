// Factory that produces the bound "wrapper" callbacks for useVoice.
//
// Each binding is a thin function that closes over a few stable refs/setters
// from the runtime bag and forwards to a corresponding `*Runtime` helper.
// Pulled out of useVoice.ts so the hook body can stay focused on React state,
// effects, and the public API surface.

import {
  logVoiceEvent,
  normalizeVoiceDedupText,
  type VoiceSessionEvent,
  type VoiceSessionTransport,
} from '../../features/voice'
import { hearingConfigFromSettings } from '../../features/hearing'
import type { AppSettings } from '../../types'
import {
  canInterruptSpeech as canInterruptSpeechForSettings,
  clearSpeechInterruptedFlag as clearSpeechInterruptedFlagForGeneration,
  getNoSpeechRestartDelay as getNoSpeechRestartDelayForCount,
  isSpeechInterrupted as isSpeechInterruptedForGeneration,
  pauseContinuousVoice as pauseContinuousVoiceSession,
  resetNoSpeechRestartCount as resetNoSpeechRestartCounter,
  shouldAutoRestartVoice as shouldAutoRestartVoiceForSettings,
  shouldKeepContinuousVoiceSession as shouldKeepContinuousVoiceSessionForSettings,
  startSpeechInterruptMonitor as startSpeechInterruptMonitorRuntime,
  stopSpeechInterruptMonitor as stopSpeechInterruptMonitorSession,
} from './continuousVoice'
import { testSpeechInputReadinessRuntime } from './diagnostics'
import {
  applySpeechOutputProviderFallbackRuntime,
  buildSpeechOutputFailoverCandidatesRuntime,
} from './providerFallbacks'
import { startSpeechOutputRuntime } from './speechOutputRuntime'
import {
  handleRecognizedVoiceTranscriptRuntime,
  handleVoiceListeningFailureRuntime,
} from './transcriptHandling'
import {
  clearParaformerConversationStateRuntime,
  clearSenseVoiceConversationStateRuntime,
  clearTencentConversationStateRuntime,
  destroyVadSessionRuntime,
  dispatchVoiceSessionAndSyncRuntime,
  dispatchVoiceSessionRuntime,
  beginVoiceListeningSessionRuntime,
  getAudioPlaybackQueueRuntime,
  getSpeechLevelControllerRuntime,
  getStreamAudioPlayerRuntime,
  interruptSpeakingForVoiceInputRuntime,
  setContinuousVoiceSessionRuntime,
  setSpeechLevelValueRuntime,
  stopActiveSpeechOutputRuntime,
  stopApiRecordingRuntime,
  stopSpeechTrackingRuntime,
  stopVadListeningRuntime,
} from './'
import type { VadConversationSession } from './types'
import type { VoiceBindings, VoiceRuntimeBag } from './voiceRuntimeBag'

export function createVoiceBindings(bag: VoiceRuntimeBag): VoiceBindings {
  const { ctx, refs, setters, hookCallbacks, lifecycleHolder, tunables, voiceBus } = bag
  const { showPetStatus, clearPendingVoiceRestart, appendVoiceTrace, ti } = hookCallbacks

  // ── Session dispatch ────────────────────────────────────────────────────
  function dispatchVoiceSession(event: VoiceSessionEvent) {
    return dispatchVoiceSessionRuntime({
      voiceSessionRef: refs.voiceSessionRef,
      event,
    })
  }

  function dispatchVoiceSessionAndSync(event: VoiceSessionEvent) {
    return dispatchVoiceSessionAndSyncRuntime({
      voiceSessionRef: refs.voiceSessionRef,
      voiceStateRef: refs.voiceStateRef,
      setVoiceState: setters.setVoiceState,
      busEmit: hookCallbacks.busEmit,
      event,
    })
  }

  function beginVoiceListeningSession(transport: VoiceSessionTransport) {
    return beginVoiceListeningSessionRuntime({
      voiceSessionRef: refs.voiceSessionRef,
      voiceStateRef: refs.voiceStateRef,
      setVoiceState: setters.setVoiceState,
      busEmit: hookCallbacks.busEmit,
      transport,
    })
  }

  // ── Speech level / tracking ─────────────────────────────────────────────
  function setSpeechLevelValue(nextLevel: number) {
    setSpeechLevelValueRuntime({
      nextLevel,
      speechLevelValueRef: refs.speechLevelValueRef,
      setSpeechLevel: setters.setSpeechLevel,
    })
  }

  function getSpeechLevelController() {
    return getSpeechLevelControllerRuntime({
      speechLevelControllerRef: refs.speechLevelControllerRef,
      onLevelChange: setSpeechLevelValue,
      simulationIntervalMs: tunables.browserTtsLipsyncIntervalMs,
      analyserFftSize: tunables.audioTtsAnalyserFftSize,
    })
  }

  function stopSpeechTracking() {
    stopSpeechTrackingRuntime({
      getSpeechLevelController,
    })
  }

  // ── Continuous voice toggle ─────────────────────────────────────────────
  function setContinuousVoiceSession(active: boolean) {
    setContinuousVoiceSessionRuntime({
      active,
      continuousVoiceActiveRef: refs.continuousVoiceActiveRef,
      setContinuousVoiceActive: setters.setContinuousVoiceActive,
    })
  }

  // ── Interruption / monitor ──────────────────────────────────────────────
  function interruptSpeakingForVoiceInput() {
    return interruptSpeakingForVoiceInputRuntime({
      voiceStateRef: refs.voiceStateRef,
      canInterruptSpeech,
      showPetStatus,
      stopActiveSpeechOutput,
      dispatchVoiceSessionAndSync,
      voiceEchoCooldownUntilRef: refs.voiceEchoCooldownUntilRef,
      ti,
    })
  }

  function stopSpeechInterruptMonitor() {
    stopSpeechInterruptMonitorSession(refs.speechInterruptMonitorRef)
  }

  // ── Recording / VAD teardown ────────────────────────────────────────────
  function stopApiRecording(cancel = false) {
    stopApiRecordingRuntime({
      apiRecordingRef: refs.apiRecordingRef,
      cancel,
    })
  }

  async function destroyVadSession(session: VadConversationSession | null) {
    await destroyVadSessionRuntime({
      session,
      vadSessionRef: refs.vadSessionRef,
      setSpeechLevelValue,
    })
  }

  async function stopVadListening(cancel = false) {
    await stopVadListeningRuntime({
      vadSessionRef: refs.vadSessionRef,
      destroyVadSession,
      cancel,
    })
  }

  // ── Conversation state cleanup ──────────────────────────────────────────
  function clearParaformerConversationState() {
    clearParaformerConversationStateRuntime({
      paraformerConversationRef: refs.paraformerConversationRef,
      setSpeechLevelValue,
    })
  }

  function clearSenseVoiceConversationState() {
    clearSenseVoiceConversationStateRuntime({
      sensevoiceConversationRef: refs.sensevoiceConversationRef,
      setSpeechLevelValue,
    })
  }

  function clearTencentConversationState() {
    clearTencentConversationStateRuntime({
      tencentConversationRef: refs.tencentConversationRef,
      setSpeechLevelValue,
    })
  }

  // ── Speech output plumbing ──────────────────────────────────────────────
  function stopActiveSpeechOutput() {
    stopActiveSpeechOutputRuntime({
      wakewordAcknowledgingRef: refs.wakewordAcknowledgingRef,
      stopSpeechInterruptMonitor,
      stopSpeechTracking,
      activeStreamingSpeechOutputRef: refs.activeStreamingSpeechOutputRef,
      streamAudioPlayerRef: refs.streamAudioPlayerRef,
      audioPlaybackQueueRef: refs.audioPlaybackQueueRef,
    })
  }

  function getStreamAudioPlayer() {
    return getStreamAudioPlayerRuntime({
      streamAudioPlayerRef: refs.streamAudioPlayerRef,
      onLevel: setSpeechLevelValue,
    })
  }

  function getAudioPlaybackQueue() {
    return getAudioPlaybackQueueRuntime({
      audioPlaybackQueueRef: refs.audioPlaybackQueueRef,
      getSpeechLevelController,
      stopSpeechTracking,
    })
  }

  async function startSpeechOutput(
    text: string,
    speechSettings: AppSettings,
    options?: {
      onStart?: () => void
      onEnd?: () => void
      onError?: (message: string) => void
    },
  ) {
    await startSpeechOutputRuntime({
      text,
      speechSettings,
      runtime: {
        getStreamAudioPlayer,
        setActiveController: (nextController) => {
          refs.activeStreamingSpeechOutputRef.current = nextController
        },
        resetPlayer: () => {
          refs.streamAudioPlayerRef.current = null
        },
        stopSpeechTracking,
      },
      callbacks: options,
      buildSpeechOutputFailoverCandidates,
      applySpeechOutputProviderFallback,
      appendVoiceTrace,
      telemetry: {
        busEmit: (event) => voiceBus.emit(event),
      },
      ti,
    })
  }

  // ── No-speech restart counter ───────────────────────────────────────────
  function resetNoSpeechRestartCount() {
    resetNoSpeechRestartCounter(refs.noSpeechRestartCountRef)
  }

  function getNoSpeechRestartDelay() {
    return getNoSpeechRestartDelayForCount(refs.noSpeechRestartCountRef)
  }

  // ── Pause helper ────────────────────────────────────────────────────────
  function pauseContinuousVoice(message: string, statusText = message) {
    pauseContinuousVoiceSession({
      clearPendingVoiceRestart,
      setContinuousVoiceSession,
      resetNoSpeechRestartCount,
      setError: ctx.setError,
      showPetStatus,
      message,
      statusText,
    })
  }

  // ── Settings predicates ─────────────────────────────────────────────────
  function shouldAutoRestartVoice() {
    return shouldAutoRestartVoiceForSettings({
      continuousVoiceActiveRef: refs.continuousVoiceActiveRef,
      settingsRef: ctx.settingsRef,
    })
  }

  function shouldKeepContinuousVoiceSession() {
    return shouldKeepContinuousVoiceSessionForSettings({
      settingsRef: ctx.settingsRef,
    })
  }

  function canInterruptSpeech() {
    return canInterruptSpeechForSettings({
      settingsRef: ctx.settingsRef,
    })
  }

  // ── Interrupted-flag helpers ────────────────────────────────────────────
  function isSpeechInterrupted(speechGeneration: number) {
    return isSpeechInterruptedForGeneration(refs.interruptedSpeechGenerationRef, speechGeneration)
  }

  function clearSpeechInterruptedFlag(speechGeneration: number) {
    clearSpeechInterruptedFlagForGeneration(refs.interruptedSpeechGenerationRef, speechGeneration)
  }

  // ── Speech interrupt monitor (cyclic — needs lifecycle.scheduleVoiceRestart)
  async function startSpeechInterruptMonitor(
    speechGeneration: number,
    shouldResumeContinuousVoice: boolean,
  ) {
    await startSpeechInterruptMonitorRuntime({
      speechGeneration,
      shouldResumeContinuousVoice,
      speechInterruptMonitorRef: refs.speechInterruptMonitorRef,
      assistantSpeechGenerationRef: refs.assistantSpeechGenerationRef,
      interruptedSpeechGenerationRef: refs.interruptedSpeechGenerationRef,
      voiceStateRef: refs.voiceStateRef,
      continuousVoiceActiveRef: refs.continuousVoiceActiveRef,
      settingsRef: ctx.settingsRef,
      speechLevelValueRef: refs.speechLevelValueRef,
      // When KWS is listening, the monitor subscribes to its existing mic
      // frames instead of opening a second getUserMedia. See
      // `startSpeechInterruptMonitor` for the full rationale.
      wakewordRuntimeRef: refs.wakewordRuntimeRef,
      clearPendingVoiceRestart,
      stopActiveSpeechOutput,
      onInterrupted: () => {
        logVoiceEvent('assistant speech interrupted by user speech')
        // dispatchVoiceSessionAndSync now auto-emits tts:interrupted to the
        // VoiceBus, so the explicit voiceBus.emit is no longer needed.
        dispatchVoiceSessionAndSync({ type: 'tts_interrupted' })
      },
      setMood: ctx.setMood,
      showPetStatus,
      // Late-bound: lifecycle is built after bindings, so resolve at call time.
      scheduleVoiceRestart: (statusText, delay, force) => {
        lifecycleHolder.current?.scheduleVoiceRestart(statusText, delay, force)
      },
      ti,
    })
  }

  // ── Provider failover hooks ─────────────────────────────────────────────
  function applySpeechOutputProviderFallback(providerId: string, statusText?: string) {
    return applySpeechOutputProviderFallbackRuntime({
      providerId,
      statusText,
      settingsRef: ctx.settingsRef,
      showPetStatus,
    })
  }

  function buildSpeechOutputFailoverCandidates(settings: AppSettings) {
    return buildSpeechOutputFailoverCandidatesRuntime(settings)
  }

  function testSpeechInputReadiness(draftSettings: AppSettings) {
    return testSpeechInputReadinessRuntime({ draftSettings, ti })
  }

  // ── Composer / dedup helpers ────────────────────────────────────────────
  function fillComposerWithVoiceTranscript(transcript: string) {
    const nextInput = ctx.inputRef.current.trim()
      ? `${ctx.inputRef.current}\n${transcript}`
      : transcript

    ctx.inputRef.current = nextInput
    ctx.setInput(nextInput)
  }

  function shouldIgnoreRepeatedVoiceContent(content: string) {
    const normalizedContent = normalizeVoiceDedupText(content)
    if (!normalizedContent) {
      return false
    }

    const previous = refs.lastSubmittedVoiceContentRef.current
    return (
      previous.content === normalizedContent
      && Date.now() - previous.sentAt < tunables.voiceTranscriptDedupWindowMs
    )
  }

  function rememberSubmittedVoiceContent(content: string) {
    const normalizedContent = normalizeVoiceDedupText(content)
    if (!normalizedContent) {
      return
    }

    refs.lastSubmittedVoiceContentRef.current = {
      content: normalizedContent,
      sentAt: Date.now(),
    }
  }

  // ── Transcript handling ─────────────────────────────────────────────────
  async function handleRecognizedVoiceTranscript(
    rawTranscript: string,
    options?: { traceId?: string },
  ) {
    return handleRecognizedVoiceTranscriptRuntime({
      rawTranscript,
      traceId: options?.traceId,
      hearingConfig: hearingConfigFromSettings(ctx.settingsRef.current),
      activeVoiceConversationOptionsRef: refs.activeVoiceConversationOptionsRef,
      dispatchVoiceSessionAndSync,
      setMood: ctx.setMood,
      setError: ctx.setError,
      setLiveTranscript: setters.setLiveTranscript,
      updateVoicePipeline: hookCallbacks.updateVoicePipeline,
      appendVoiceTrace,
      openChatPanelForVoice: ctx.openChatPanelForVoice,
      fillComposerWithVoiceTranscript,
      showPetStatus,
      shouldAutoRestartVoice,
      // Late-bound through lifecycle holder.
      scheduleVoiceRestart: (statusText, delay, force) => {
        lifecycleHolder.current?.scheduleVoiceRestart(statusText, delay, force)
      },
      shouldIgnoreRepeatedVoiceContent,
      rememberSubmittedVoiceContent,
      sendMessage: (content, sendOptions) => ctx.sendMessageRef.current(content, sendOptions),
      resetNoSpeechRestartCount,
      ti,
    })
  }

  function handleVoiceListeningFailure(message: string, errorCode?: string) {
    handleVoiceListeningFailureRuntime({
      message,
      errorCode,
      activeVoiceConversationOptionsRef: refs.activeVoiceConversationOptionsRef,
      dispatchVoiceSessionAndSync,
      setLiveTranscript: setters.setLiveTranscript,
      setSpeechLevelValue,
      setMood: ctx.setMood,
      updateVoicePipeline: hookCallbacks.updateVoicePipeline,
      appendVoiceTrace,
      setError: ctx.setError,
      shouldAutoRestartVoice,
      noSpeechRestartCountRef: refs.noSpeechRestartCountRef,
      maxContinuousNoSpeechRestarts: tunables.maxContinuousNoSpeechRestarts,
      pauseContinuousVoice,
      showPetStatus,
      // Late-bound: lifecycle.scheduleVoiceRestart.
      scheduleVoiceRestart: (statusText, delay, force) => {
        lifecycleHolder.current?.scheduleVoiceRestart(statusText, delay, force)
      },
      getNoSpeechRestartDelay,
      setContinuousVoiceSession,
      resetNoSpeechRestartCount,
      ti,
    })
  }

  return {
    dispatchVoiceSession,
    dispatchVoiceSessionAndSync,
    beginVoiceListeningSession,
    setSpeechLevelValue,
    getSpeechLevelController,
    stopSpeechTracking,
    setContinuousVoiceSession,
    interruptSpeakingForVoiceInput,
    stopSpeechInterruptMonitor,
    startSpeechInterruptMonitor,
    stopApiRecording,
    destroyVadSession,
    stopVadListening,
    clearParaformerConversationState,
    clearSenseVoiceConversationState,
    clearTencentConversationState,
    stopActiveSpeechOutput,
    getStreamAudioPlayer,
    getAudioPlaybackQueue,
    startSpeechOutput,
    resetNoSpeechRestartCount,
    getNoSpeechRestartDelay,
    pauseContinuousVoice,
    shouldAutoRestartVoice,
    shouldKeepContinuousVoiceSession,
    canInterruptSpeech,
    isSpeechInterrupted,
    clearSpeechInterruptedFlag,
    applySpeechOutputProviderFallback,
    buildSpeechOutputFailoverCandidates,
    testSpeechInputReadiness,
    fillComposerWithVoiceTranscript,
    shouldIgnoreRepeatedVoiceContent,
    rememberSubmittedVoiceContent,
    handleRecognizedVoiceTranscript,
    handleVoiceListeningFailure,
  }
}
