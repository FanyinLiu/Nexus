/* eslint-disable react-hooks/refs -- useVoice is a ref-heavy voice infrastructure
   hook that must bridge refs, state, and event bus during render.  The lint rule
   flags `settings` (a plain AppSettings value) because the context object that
   carries it also holds RefObjects; these are false positives. */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createInitialWakewordRuntimeState,
  hearingConfigFromSettings,
  HearingRuntime,
  type HearingPhase,
  type ParaformerStreamSession,
  type SenseVoiceStreamSession,
  type WakewordRuntimeController,
} from '../features/hearing'
import type { TencentAsrStreamSession } from '../features/hearing/tencentAsr'
import {
  createVoiceSessionState,
  logVoiceEvent,
  normalizeVoiceDedupText,
  type AudioPlaybackQueue,
  type SpeechLevelController,
  type StreamAudioPlayer,
  type VoiceSessionEvent,
  type VoiceSessionTransport,
} from '../features/voice'
import {
  createId,
  loadVoiceTrace,
  loadVoicePipelineState,
  saveVoiceTrace,
  saveVoicePipelineState,
  type BrowserSpeechRecognition,
} from '../lib'
import {
  canInterruptSpeech as canInterruptSpeechForSettings,
  clearPendingVoiceRestart as clearPendingVoiceRestartTimer,
  clearSpeechInterruptedFlag as clearSpeechInterruptedFlagForGeneration,
  getNoSpeechRestartDelay as getNoSpeechRestartDelayForCount,
  isSpeechInterrupted as isSpeechInterruptedForGeneration,
  pauseContinuousVoice as pauseContinuousVoiceSession,
  resetNoSpeechRestartCount as resetNoSpeechRestartCounter,
  scheduleVoiceRestart as scheduleContinuousVoiceRestart,
  shouldAutoRestartVoice as shouldAutoRestartVoiceForSettings,
  shouldKeepContinuousVoiceSession as shouldKeepContinuousVoiceSessionForSettings,
  startSpeechInterruptMonitor as startSpeechInterruptMonitorRuntime,
  stopSpeechInterruptMonitor as stopSpeechInterruptMonitorSession,
} from './voice/continuousVoice'
import {
  startVoiceConversationEntrypoint,
  stopVoiceConversationEntrypoint,
} from './voice/conversationEntrypoints'
import {
  probeSpeechOutputPlaybackStartRuntime,
  runAudioSmokeTestRuntime,
  testSpeechInputConnectionRuntime,
  testSpeechInputReadinessRuntime,
  testSpeechOutputReadinessRuntime,
} from './voice/diagnostics'
import {
  applySpeechOutputProviderFallbackRuntime,
  buildSpeechOutputFailoverCandidatesRuntime,
  ensureSupportedSpeechInputSettingsRuntime,
} from './voice/providerFallbacks'
import {
  startApiRecordingConversation,
} from './voice/recordingConversations'
import { startParaformerConversation, type ParaformerConversationState } from './voice/paraformerConversation'
import { startTencentConversation, type TencentConversationState } from './voice/tencentConversation'
import { startSenseVoiceConversation, type SenseVoiceConversationState } from './voice/sensevoiceConversation'
import {
  beginStreamingSpeechReplyRuntime,
  speakAssistantReplyRuntime,
} from './voice/speechReply'
import { VoiceBus } from '../features/voice/bus'
import type { BusEffect, VoicePhase } from '../features/voice/busReducer'
import type { VoiceBusEvent } from '../features/voice/busEvents'
import { startSpeechOutputRuntime } from './voice/speechOutputRuntime'
import {
  handleRecognizedVoiceTranscriptRuntime,
  handleVoiceListeningFailureRuntime,
} from './voice/transcriptHandling'
import { startVadConversation } from './voice/vadConversation'
import {
  acknowledgeWakewordAndStartListeningRuntime,
  cleanupVoiceRuntimeResources,
  createWakewordRuntimeBinding,
  beginVoiceListeningSessionRuntime,
  clearParaformerConversationStateRuntime,
  clearTencentConversationStateRuntime,
  clearSenseVoiceConversationStateRuntime,
  destroyVadSessionRuntime,
  dispatchVoiceSessionAndSyncRuntime,
  dispatchVoiceSessionRuntime,
  getAudioPlaybackQueueRuntime,
  getSpeechLevelControllerRuntime,
  getStreamAudioPlayerRuntime,
  handleWakewordKeywordDetectedRuntime,
  handleWakewordRuntimeStateChangeRuntime,
  interruptSpeakingForVoiceInputRuntime,
  setContinuousVoiceSessionRuntime,
  setSpeechLevelValueRuntime,
  stopActiveSpeechOutputRuntime,
  stopApiRecordingRuntime,
  stopSpeechTrackingRuntime,
  stopVadListeningRuntime,
} from './voice'
import type {
  AppSettings,
  WakewordRuntimeState,
  VoiceTraceEntry,
  VoicePipelineState,
  VoiceState,
} from '../types'
import type {
  ApiRecordingSession,
  SpeechInterruptMonitorSession,
  SpeechSegmentMeta,
  StreamingSpeechOutputController,
  UseVoiceContext,
  VadConversationSession,
  VoiceConversationOptions,
} from './voice/types'

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_CONTINUOUS_NO_SPEECH_RESTARTS = 5
const VOICE_TRANSCRIPT_DEDUP_WINDOW_MS = 6_000
const MAX_VOICE_TRACE_ENTRIES = 8
const BROWSER_TTS_LIPSYNC_INTERVAL_MS = 88
const AUDIO_TTS_ANALYSER_FFT_SIZE = 512

export type { UseVoiceContext } from './voice/types'

export function useVoice(ctx: UseVoiceContext) {
  const settings = ctx.settings
  const inputRef = ctx.inputRef
  const setInput = ctx.setInput
  const view = ctx.view
  const [voiceState, setVoiceStateRaw] = useState<VoiceState>('idle')
  const [continuousVoiceActive, setContinuousVoiceActive] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState('')
  const [speechLevel, setSpeechLevel] = useState(0)
  const [wakewordState, setWakewordState] = useState<WakewordRuntimeState>(() => createInitialWakewordRuntimeState())
  const voiceEnabled = settings.speechInputEnabled || settings.speechOutputEnabled
  const [voicePipeline, setVoicePipeline] = useState<VoicePipelineState>(() => voiceEnabled ? loadVoicePipelineState() : { step: 'idle' as const, detail: '', transcript: '', updatedAt: '' })
  const [voiceTrace, setVoiceTrace] = useState<VoiceTraceEntry[]>(() => voiceEnabled ? loadVoiceTrace() : [])

  const voiceStateRef = useRef<VoiceState>('idle')
  const voiceSessionRef = useRef(createVoiceSessionState())
  const continuousVoiceActiveRef = useRef(false)
  const suppressVoiceReplyRef = useRef(false)
  const restartVoiceTimerRef = useRef<number | null>(null)
  const noSpeechRestartCountRef = useRef(0)
  const previousContinuousVoiceActiveRef = useRef(false)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const apiRecordingRef = useRef<ApiRecordingSession | null>(null)
  const vadSessionRef = useRef<VadConversationSession | null>(null)
  const speechLevelControllerRef = useRef<SpeechLevelController | null>(null)
  const audioPlaybackQueueRef = useRef<AudioPlaybackQueue<SpeechSegmentMeta> | null>(null)
  const streamAudioPlayerRef = useRef<StreamAudioPlayer | null>(null)
  const activeStreamingSpeechOutputRef = useRef<StreamingSpeechOutputController | null>(null)
  const speechLevelValueRef = useRef(0)
  const paraformerSessionRef = useRef<ParaformerStreamSession | null>(null)
  const paraformerConversationRef = useRef<ParaformerConversationState | null>(null)
  const sensevoiceSessionRef = useRef<SenseVoiceStreamSession | null>(null)
  const sensevoiceConversationRef = useRef<SenseVoiceConversationState | null>(null)
  const tencentAsrSessionRef = useRef<TencentAsrStreamSession | null>(null)
  const tencentConversationRef = useRef<TencentConversationState | null>(null)
  const speechInterruptMonitorRef = useRef<SpeechInterruptMonitorSession | null>(null)
  const wakewordRuntimeRef = useRef<WakewordRuntimeController | null>(null)
  const wakewordRuntimeStateChangeRef = useRef<(
    nextState: WakewordRuntimeState,
    previousState: WakewordRuntimeState,
  ) => void>(() => undefined)
  const wakewordKeywordDetectedRef = useRef<(keyword: string) => void>(() => undefined)
  const wakewordAcknowledgingRef = useRef(false)
  const activeVoiceConversationOptionsRef = useRef<VoiceConversationOptions>({})
  const assistantSpeechGenerationRef = useRef(0)
  const interruptedSpeechGenerationRef = useRef<number | null>(null)
  const lastSubmittedVoiceContentRef = useRef<{ content: string; sentAt: number }>({
    content: '',
    sentAt: 0,
  })
  const lastPetStatusRef = useRef<{ text: string; at: number }>({
    text: '',
    at: 0,
  })
  const startVoiceConversationRef = useRef<(options?: VoiceConversationOptions) => void>(() => undefined)
  const stopApiRecordingRef = useRef<(cancel?: boolean) => void>(() => undefined)
  const stopVadListeningRef = useRef<(cancel?: boolean) => Promise<void>>(async () => undefined)
  const stopActiveSpeechOutputRef = useRef<() => void>(() => undefined)

  // ── Hearing runtime (unified input-side store) ──────────────────────────
  const hearingRuntimeRef = useRef<HearingRuntime | null>(null)
  if (!hearingRuntimeRef.current) {
    hearingRuntimeRef.current = new HearingRuntime()
  }
  const hearingRuntime = hearingRuntimeRef.current

  // ── Voice event bus ──────────────────────────────────────────────────────
  const voiceBusRef = useRef<VoiceBus | null>(null)
  if (!voiceBusRef.current) {
    voiceBusRef.current = new VoiceBus()
  }
  const voiceBus = voiceBusRef.current

  const setSettings = ctx.setSettings

  // ── Bus effect executor ────────────────────────────────────────────────
  function executeBusEffects(effects: BusEffect[]) {
    for (const effect of effects) {
      switch (effect.type) {
        case 'restart_voice':
          window.setTimeout(() => {
            const currentPhase = voiceBus.phase
            if (currentPhase !== 'idle') {
              console.log('[VoiceBus] restart_voice skipped — phase:', currentPhase)
              return
            }
            try {
              console.log('[VoiceBus] restart_voice — starting voice conversation')
              startVoiceConversation({ restart: true, passive: true })
            } catch (err) {
              console.warn('[VoiceBus] restart failed:', err)
              showPetStatus('语音重启失败，请手动重试。', 4_000, 3_000)
            }
          }, effect.delay)
          break
        case 'set_mood':
          ctx.setMood(effect.mood)
          break
        case 'show_status':
          showPetStatus(effect.message, effect.duration)
          break
        case 'log':
          console[effect.level]('[VoiceBus]', effect.message, effect.data ?? '')
          break
      }
    }
  }

  function voiceStateForBusPhase(phase: VoicePhase): VoiceState {
    switch (phase) {
      case 'listening': return 'listening'
      case 'transcribing': return 'processing'
      case 'speaking': return 'speaking'
      default: return 'idle'
    }
  }

  function busEmit(event: VoiceBusEvent) {
    const prevPhase = voiceBus.phase
    const effects = voiceBus.emit(event)
    const nextPhase = voiceBus.phase
    // Sync voiceState when bus phase changes — replaces the legacy
    // dispatchVoiceSessionAndSync → setVoiceState path for bus-driven events.
    if (prevPhase !== nextPhase) {
      setVoiceState(voiceStateForBusPhase(nextPhase))
    }
    executeBusEffects(effects)
  }

  // ── Ref sync ───────────────────────────────────────────────────────────────
  // All voice-state changes should go through setVoiceStateSync so the ref
  // is updated synchronously (scheduleVoiceRestart reads the ref, not React state).
  // The useEffect is kept only as a safety net for edge cases.

  function setVoiceState(next: VoiceState) {
    voiceStateRef.current = next
    setVoiceStateRaw(next)
  }

  useEffect(() => {
    voiceStateRef.current = voiceState
  }, [voiceState])

  // ── Persistence ────────────────────────────────────────────────────────────

  const voicePipelineSaveSkipRef = useRef(true)
  const voiceTraceSaveSkipRef = useRef(true)

  useEffect(() => {
    if (voicePipelineSaveSkipRef.current) {
      voicePipelineSaveSkipRef.current = false
      return
    }
    saveVoicePipelineState(voicePipeline)
  }, [voicePipeline])

  useEffect(() => {
    if (voiceTraceSaveSkipRef.current) {
      voiceTraceSaveSkipRef.current = false
      return
    }
    saveVoiceTrace(voiceTrace)
  }, [voiceTrace])

  // ── HearingRuntime sync ────────────────────────────────────────────────────
  // Sync phase from voiceState → hearingRuntime
  useEffect(() => {
    const phaseMap: Record<VoiceState, HearingPhase> = {
      idle: 'idle',
      listening: 'listening',
      processing: 'transcribing',
      speaking: 'idle',
    }
    hearingRuntime.setPhase(phaseMap[voiceState] ?? 'idle')
  }, [voiceState, hearingRuntime])

  // Sync wakeword listening state
  useEffect(() => {
    hearingRuntime.setWakewordListening(wakewordState.active)
  }, [wakewordState.active, hearingRuntime])

  // ── Voice pipeline helpers ─────────────────────────────────────────────────

  const updateVoicePipeline = useCallback((
    step: VoicePipelineState['step'],
    detail: string,
    transcript = '',
  ) => {
    setVoicePipeline({
      step,
      detail,
      transcript: transcript.trim(),
      updatedAt: new Date().toISOString(),
    })
  }, [])

  const appendVoiceTrace = useCallback((
    title: string,
    detail: string,
    tone: VoiceTraceEntry['tone'] = 'info',
  ) => {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    const entry: VoiceTraceEntry = {
      id: createId('voice-trace'),
      title,
      detail: `[${timestamp}] ${detail}`,
      tone,
      createdAt: new Date().toISOString(),
    }

    setVoiceTrace((current) => [entry, ...current].slice(0, MAX_VOICE_TRACE_ENTRIES))
  }, [])

  const showPetStatus = useCallback((
    message: string,
    duration = 2_600,
    dedupeWindowMs = 2_200,
  ) => {
    const text = message.trim()
    if (!text) return

    const now = Date.now()
    if (
      lastPetStatusRef.current.text === text
      && now - lastPetStatusRef.current.at < dedupeWindowMs
    ) {
      return
    }

    lastPetStatusRef.current = { text, at: now }
    ctx.updatePetStatus(text, duration)
  }, [ctx])

  function dispatchVoiceSession(event: VoiceSessionEvent) {
    return dispatchVoiceSessionRuntime({
      voiceSessionRef,
      event,
    })
  }

  function dispatchVoiceSessionAndSync(event: VoiceSessionEvent) {
    return dispatchVoiceSessionAndSyncRuntime({
      voiceSessionRef,
      voiceStateRef,
      setVoiceState,
      event,
    })
  }

  function beginVoiceListeningSession(transport: VoiceSessionTransport) {
    return beginVoiceListeningSessionRuntime({
      voiceSessionRef,
      voiceStateRef,
      setVoiceState,
      transport,
    })
  }

  // ── Internal voice functions ───────────────────────────────────────────────

  function setSpeechLevelValue(nextLevel: number) {
    setSpeechLevelValueRuntime({
      nextLevel,
      speechLevelValueRef,
      setSpeechLevel,
    })
  }

  function getSpeechLevelController() {
    return getSpeechLevelControllerRuntime({
      speechLevelControllerRef,
      onLevelChange: setSpeechLevelValue,
      simulationIntervalMs: BROWSER_TTS_LIPSYNC_INTERVAL_MS,
      analyserFftSize: AUDIO_TTS_ANALYSER_FFT_SIZE,
    })
  }

  function stopSpeechTracking() {
    stopSpeechTrackingRuntime({
      getSpeechLevelController,
    })
  }

  function setContinuousVoiceSession(active: boolean) {
    setContinuousVoiceSessionRuntime({
      active,
      continuousVoiceActiveRef,
      setContinuousVoiceActive,
    })
  }

  function interruptSpeakingForVoiceInput() {
    return interruptSpeakingForVoiceInputRuntime({
      voiceStateRef,
      canInterruptSpeech,
      showPetStatus,
      stopActiveSpeechOutput,
      dispatchVoiceSessionAndSync,
    })
  }

  function stopSpeechInterruptMonitor() {
    stopSpeechInterruptMonitorSession(speechInterruptMonitorRef)
  }

  function stopApiRecording(cancel = false) {
    stopApiRecordingRuntime({
      apiRecordingRef,
      cancel,
    })
  }

  async function destroyVadSession(session: VadConversationSession | null) {
    await destroyVadSessionRuntime({
      session,
      vadSessionRef,
      setSpeechLevelValue,
    })
  }

  async function stopVadListening(cancel = false) {
    await stopVadListeningRuntime({
      vadSessionRef,
      destroyVadSession,
      cancel,
    })
  }

  function clearParaformerConversationState() {
    clearParaformerConversationStateRuntime({
      paraformerConversationRef,
      setSpeechLevelValue,
    })
  }

  function clearSenseVoiceConversationState() {
    clearSenseVoiceConversationStateRuntime({
      sensevoiceConversationRef,
      setSpeechLevelValue,
    })
  }

  function clearTencentConversationState() {
    clearTencentConversationStateRuntime({
      tencentConversationRef,
      setSpeechLevelValue,
    })
  }

  function stopActiveSpeechOutput() {
    stopActiveSpeechOutputRuntime({
      wakewordAcknowledgingRef,
      stopSpeechInterruptMonitor,
      stopSpeechTracking,
      activeStreamingSpeechOutputRef,
      streamAudioPlayerRef,
      audioPlaybackQueueRef,
    })
  }

  function getStreamAudioPlayer() {
    return getStreamAudioPlayerRuntime({
      streamAudioPlayerRef,
      onLevel: setSpeechLevelValue,
    })
  }

  function getAudioPlaybackQueue() {
    return getAudioPlaybackQueueRuntime({
      audioPlaybackQueueRef,
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
        getAudioPlaybackQueue,
        stopSpeechTracking,
      },
      callbacks: options,
      buildSpeechOutputFailoverCandidates,
      applySpeechOutputProviderFallback,
      appendVoiceTrace,
    })
  }

  function resetNoSpeechRestartCount() {
    resetNoSpeechRestartCounter(noSpeechRestartCountRef)
  }

  function getNoSpeechRestartDelay() {
    return getNoSpeechRestartDelayForCount(noSpeechRestartCountRef)
  }

  const clearPendingVoiceRestart = useCallback(() => {
    clearPendingVoiceRestartTimer(restartVoiceTimerRef)
  }, [])

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

  function shouldAutoRestartVoice() {
    return shouldAutoRestartVoiceForSettings({
      continuousVoiceActiveRef,
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

  function isSpeechInterrupted(speechGeneration: number) {
    return isSpeechInterruptedForGeneration(interruptedSpeechGenerationRef, speechGeneration)
  }

  function clearSpeechInterruptedFlag(speechGeneration: number) {
    clearSpeechInterruptedFlagForGeneration(interruptedSpeechGenerationRef, speechGeneration)
  }

  async function startSpeechInterruptMonitor(
    speechGeneration: number,
    shouldResumeContinuousVoice: boolean,
  ) {
    await startSpeechInterruptMonitorRuntime({
      speechGeneration,
      shouldResumeContinuousVoice,
      speechInterruptMonitorRef,
      assistantSpeechGenerationRef,
      interruptedSpeechGenerationRef,
      voiceStateRef,
      continuousVoiceActiveRef,
      settingsRef: ctx.settingsRef,
      clearPendingVoiceRestart,
      stopActiveSpeechOutput,
      onInterrupted: () => {
        logVoiceEvent('assistant speech interrupted by user speech')
        dispatchVoiceSessionAndSync({ type: 'tts_interrupted' })
      },
      setMood: ctx.setMood,
      showPetStatus,
      scheduleVoiceRestart,
    })
  }

  // ── Settings validation ────────────────────────────────────────────────────

  const ensureSupportedSpeechInputSettings = useCallback((announce = false) => {
    return ensureSupportedSpeechInputSettingsRuntime({
      announce,
      settingsRef: ctx.settingsRef,
      showPetStatus,
    })
  }, [ctx, showPetStatus])

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

  const testSpeechInputReadiness = useCallback(async (draftSettings: AppSettings) => {
    return testSpeechInputReadinessRuntime({
      draftSettings,
    })
  }, [])

  // ── Transcript handling ────────────────────────────────────────────────────

  function fillComposerWithVoiceTranscript(transcript: string) {
    const nextInput = inputRef.current.trim()
      ? `${inputRef.current}\n${transcript}`
      : transcript

    inputRef.current = nextInput
    setInput(nextInput)
  }

  function shouldIgnoreRepeatedVoiceContent(content: string) {
    const normalizedContent = normalizeVoiceDedupText(content)
    if (!normalizedContent) {
      return false
    }

    const previous = lastSubmittedVoiceContentRef.current
    return (
      previous.content === normalizedContent
      && Date.now() - previous.sentAt < VOICE_TRANSCRIPT_DEDUP_WINDOW_MS
    )
  }

  function rememberSubmittedVoiceContent(content: string) {
    const normalizedContent = normalizeVoiceDedupText(content)
    if (!normalizedContent) {
      return
    }

    lastSubmittedVoiceContentRef.current = {
      content: normalizedContent,
      sentAt: Date.now(),
    }
  }

  async function handleRecognizedVoiceTranscript(
    rawTranscript: string,
    options?: {
      traceId?: string
    },
  ) {
    return handleRecognizedVoiceTranscriptRuntime({
      rawTranscript,
      traceId: options?.traceId,
      hearingConfig: hearingConfigFromSettings(ctx.settingsRef.current),
      activeVoiceConversationOptionsRef,
      dispatchVoiceSessionAndSync,
      setMood: ctx.setMood,
      setError: ctx.setError,
      setLiveTranscript,
      updateVoicePipeline,
      appendVoiceTrace,
      openChatPanelForVoice: ctx.openChatPanelForVoice,
      fillComposerWithVoiceTranscript,
      showPetStatus,
      shouldAutoRestartVoice,
      scheduleVoiceRestart,
      shouldIgnoreRepeatedVoiceContent,
      rememberSubmittedVoiceContent,
      sendMessage: (content, sendOptions) => ctx.sendMessageRef.current(content, sendOptions),
    })
  }

  function handleVoiceListeningFailure(message: string, errorCode?: string) {
    handleVoiceListeningFailureRuntime({
      message,
      errorCode,
      activeVoiceConversationOptionsRef,
      dispatchVoiceSessionAndSync,
      setLiveTranscript,
      setSpeechLevelValue,
      setMood: ctx.setMood,
      updateVoicePipeline,
      appendVoiceTrace,
      setError: ctx.setError,
      shouldAutoRestartVoice,
      noSpeechRestartCountRef,
      maxContinuousNoSpeechRestarts: MAX_CONTINUOUS_NO_SPEECH_RESTARTS,
      pauseContinuousVoice,
      showPetStatus,
      scheduleVoiceRestart,
      getNoSpeechRestartDelay,
      setContinuousVoiceSession,
      resetNoSpeechRestartCount,
    })
  }

  // ── Voice restart / TTS ────────────────────────────────────────────────────

  function scheduleVoiceRestart(statusText = '我继续收音，你可以接着说。', delay = 520, force?: boolean) {
    scheduleContinuousVoiceRestart({
      restartVoiceTimerRef,
      recognitionRef,
      vadSessionRef,
      busyRef: ctx.busyRef,
      voiceStateRef,
      shouldAutoRestartVoice,
      showPetStatus,
      startVoiceConversation,
      statusText,
      delay,
      force,
    })
  }

  async function speakAssistantReply(text: string, shouldResumeContinuousVoice: boolean) {
    await speakAssistantReplyRuntime({
      text,
      speechGeneration: ++assistantSpeechGenerationRef.current,
      shouldResumeContinuousVoice,
      currentSettings: ctx.settingsRef.current,
      startSpeechOutput,
      setMood: ctx.setMood,
      setError: ctx.setError,
      busEmit,
      startSpeechInterruptMonitor,
      stopSpeechInterruptMonitor,
      isSpeechInterrupted,
      clearSpeechInterruptedFlag,
    })
  }

  /**
   * Creates a streaming TTS controller for use during AI streaming responses.
   * Returns an object with pushDelta/finish/waitForCompletion methods.
   * The caller feeds text deltas as they arrive from the AI, and audio starts
   * playing as soon as the first sentence completes, no waiting for the full response.
   */
  function beginStreamingSpeechReply(shouldResumeContinuousVoice: boolean) {
    return beginStreamingSpeechReplyRuntime({
      speechGeneration: ++assistantSpeechGenerationRef.current,
      shouldResumeContinuousVoice,
      currentSettings: ctx.settingsRef.current,
      setMood: ctx.setMood,
      setError: ctx.setError,
      busEmit,
      startSpeechInterruptMonitor,
      stopSpeechInterruptMonitor,
      isSpeechInterrupted,
      clearSpeechInterruptedFlag,
      streamingRuntime: {
        getPlayer: getStreamAudioPlayer,
        setActiveController: (nextController) => {
          activeStreamingSpeechOutputRef.current = nextController
        },
        resetPlayer: () => {
          streamAudioPlayerRef.current = null
        },
      },
    })
  }

  // ── VAD conversation ───────────────────────────────────────────────────────

  async function startVadVoiceConversation(
    transcribeMode: 'api' | 'local',
    options?: VoiceConversationOptions,
  ) {
    hearingRuntime.activateEngine('vad')
    await startVadConversation({
      transcribeMode,
      options,
      currentSettings: ctx.settingsRef.current,
      vadSessionRef,
      voiceStateRef,
      suppressVoiceReplyRef,
      clearPendingVoiceRestart,
      canInterruptSpeech,
      interruptSpeakingForVoiceInput,
      setContinuousVoiceSession,
      shouldKeepContinuousVoiceSession,
      resetNoSpeechRestartCount,
      beginVoiceListeningSession,
      dispatchVoiceSession,
      dispatchVoiceSessionAndSync,
      setVoiceState,
      setMood: ctx.setMood,
      setError: ctx.setError,
      setLiveTranscript,
      updateVoicePipeline,
      appendVoiceTrace,
      showPetStatus,
      setSpeechLevelValue,
      destroyVadSession,
      handleRecognizedVoiceTranscript,
      handleVoiceListeningFailure,
      startFallbackConversation: startApiVoiceConversation,
      shouldAutoRestartVoice,
    })
  }

  // ── Paraformer streaming conversation ──────────────────────────────────────

  async function startParaformerVoiceConversation(options?: VoiceConversationOptions) {
    hearingRuntime.activateEngine('paraformer')
    await startParaformerConversation({
      options,
      currentSettings: ctx.settingsRef.current,
      voiceStateRef,
      suppressVoiceReplyRef,
      paraformerSessionRef,
      paraformerConversationRef,
      clearPendingVoiceRestart,
      canInterruptSpeech,
      interruptSpeakingForVoiceInput,
      setContinuousVoiceSession,
      shouldKeepContinuousVoiceSession,
      resetNoSpeechRestartCount,
      clearParaformerConversationState,
      beginVoiceListeningSession,
      dispatchVoiceSession,
      dispatchVoiceSessionAndSync,
      setVoiceState,
      setMood: ctx.setMood,
      setError: ctx.setError,
      setLiveTranscript,
      updateVoicePipeline,
      appendVoiceTrace,
      showPetStatus,
      setSpeechLevelValue,
      handleRecognizedVoiceTranscript,
      handleVoiceListeningFailure,
      shouldAutoRestartVoice,
    })
  }

  // ── SenseVoice offline conversation ────────────────────────────────────────

  async function startSenseVoiceVoiceConversation(options?: VoiceConversationOptions) {
    hearingRuntime.activateEngine('sensevoice')
    await startSenseVoiceConversation({
      options,
      currentSettings: ctx.settingsRef.current,
      voiceStateRef,
      suppressVoiceReplyRef,
      sensevoiceSessionRef,
      sensevoiceConversationRef,
      clearPendingVoiceRestart,
      canInterruptSpeech,
      interruptSpeakingForVoiceInput,
      setContinuousVoiceSession,
      shouldKeepContinuousVoiceSession,
      resetNoSpeechRestartCount,
      clearSenseVoiceConversationState,
      beginVoiceListeningSession,
      dispatchVoiceSession,
      dispatchVoiceSessionAndSync,
      setVoiceState,
      setMood: ctx.setMood,
      setError: ctx.setError,
      setLiveTranscript,
      updateVoicePipeline,
      appendVoiceTrace,
      showPetStatus,
      setSpeechLevelValue,
      handleRecognizedVoiceTranscript,
      handleVoiceListeningFailure,
      shouldAutoRestartVoice,
    })
  }

  // ── Tencent Cloud ASR streaming conversation ───────────────────────────────

  async function startTencentAsrConversation(options?: VoiceConversationOptions) {
    hearingRuntime.activateEngine('tencent-asr')
    await startTencentConversation({
      options,
      currentSettings: ctx.settingsRef.current,
      voiceStateRef,
      suppressVoiceReplyRef,
      tencentAsrSessionRef,
      tencentConversationRef,
      clearPendingVoiceRestart,
      canInterruptSpeech,
      interruptSpeakingForVoiceInput,
      setContinuousVoiceSession,
      shouldKeepContinuousVoiceSession,
      resetNoSpeechRestartCount,
      clearTencentConversationState,
      beginVoiceListeningSession,
      dispatchVoiceSession,
      dispatchVoiceSessionAndSync,
      setVoiceState,
      setMood: ctx.setMood,
      setError: ctx.setError,
      setLiveTranscript,
      updateVoicePipeline,
      appendVoiceTrace,
      showPetStatus,
      setSpeechLevelValue,
      handleRecognizedVoiceTranscript,
      handleVoiceListeningFailure,
      shouldAutoRestartVoice,
    })
  }

  // ── API recording conversation ─────────────────────────────────────────────

  async function startApiVoiceConversation(options?: VoiceConversationOptions) {
    hearingRuntime.activateEngine('api-recording')
    await startApiRecordingConversation({
      options,
      currentSettings: ctx.settingsRef.current,
      apiRecordingRef,
      voiceStateRef,
      suppressVoiceReplyRef,
      clearPendingVoiceRestart,
      canInterruptSpeech,
      interruptSpeakingForVoiceInput,
      setContinuousVoiceSession,
      shouldKeepContinuousVoiceSession,
      resetNoSpeechRestartCount,
      stopApiRecording,
      beginVoiceListeningSession,
      dispatchVoiceSessionAndSync,
      setVoiceState,
      setMood: ctx.setMood,
      setError: ctx.setError,
      setLiveTranscript,
      updateVoicePipeline,
      appendVoiceTrace,
      showPetStatus,
      handleRecognizedVoiceTranscript,
      handleVoiceListeningFailure,
      shouldAutoRestartVoice,
    })
  }

  // ── Voice entry points ─────────────────────────────────────────────────────

  function toggleVoiceConversation() {
    ctx.markPresenceActivity()

    if (continuousVoiceActiveRef.current || voiceStateRef.current === 'listening') {
      stopVoiceConversation()
      return
    }

    if (voiceStateRef.current === 'speaking') {
      if (!canInterruptSpeech()) {
        showPetStatus('当前关闭了语音打断，请等我说完。', 2_800, 3_200)
        return
      }

      if (!interruptSpeakingForVoiceInput()) {
        return
      }
      ctx.setMood('happy')
      showPetStatus('先停下播报，你继续说。', 2_400, 3_200)
    }

    startVoiceConversation()
  }

  function startVoiceConversation(options?: VoiceConversationOptions) {
    try {
    startVoiceConversationEntrypoint({
      options,
      settingsRef: ctx.settingsRef,
      busyRef: ctx.busyRef,
      activeVoiceConversationOptionsRef,
      voiceStateRef,
      suppressVoiceReplyRef,
      recognitionRef,
      vadSessionRef,
      paraformerSessionRef,
      sensevoiceSessionRef,
      tencentAsrSessionRef,
      clearPendingVoiceRestart,
      canInterruptSpeech,
      interruptSpeakingForVoiceInput,
      setContinuousVoiceSession,
      shouldKeepContinuousVoiceSession,
      resetNoSpeechRestartCount,
      beginVoiceListeningSession,
      dispatchVoiceSessionAndSync,
      setMood: ctx.setMood,
      setError: ctx.setError,
      setLiveTranscript,
      updateVoicePipeline,
      showPetStatus,
      handleRecognizedVoiceTranscript,
      handleVoiceListeningFailure,
      shouldAutoRestartVoice,
      scheduleVoiceRestart,
      ensureSupportedSpeechInputSettings,
      startParaformerConversation: startParaformerVoiceConversation,
      startSenseVoiceConversation: startSenseVoiceVoiceConversation,
      startTencentAsrConversation,
      startVadVoiceConversation,
      startApiVoiceConversation,
    })
    } catch (err) {
      console.error('[Voice] startVoiceConversation failed:', err)
      ctx.setError(err instanceof Error ? err.message : '语音启动失败，请重试。')
      setVoiceState('idle')
    }
  }

  function stopVoiceConversation() {
    hearingRuntime.clearEngine()
    stopVoiceConversationEntrypoint({
      continuousVoiceActiveRef,
      suppressVoiceReplyRef,
      recognitionRef,
      paraformerSessionRef,
      sensevoiceSessionRef,
      tencentAsrSessionRef,
      clearPendingVoiceRestart,
      setContinuousVoiceSession,
      resetNoSpeechRestartCount,
      clearParaformerConversationState,
      clearSenseVoiceConversationState,
      clearTencentConversationState,
      stopApiRecording,
      stopVadListening,
      stopActiveSpeechOutput,
      dispatchVoiceSessionAndSync,
      busEmit,
      setLiveTranscript,
      setMood: ctx.setMood,
      updateVoicePipeline,
      showPetStatus,
    })
  }

  const acknowledgeWakewordAndStartListening = useCallback((keyword: string) => {
    acknowledgeWakewordAndStartListeningRuntime({
      keyword,
      wakewordAcknowledgingRef,
      currentSettings: ctx.settingsRef.current,
      showPetStatus,
      updateVoicePipeline,
      startVoiceConversation: (options) => {
        startVoiceConversationRef.current(options)
      },
    })
  }, [ctx.settingsRef, showPetStatus, updateVoicePipeline])

  // ── Update stable refs for cross-reference ─────────────────────────────────

  const handleWakewordRuntimeStateChange = useCallback((
    nextState: WakewordRuntimeState,
    previousState: WakewordRuntimeState,
  ) => {
    handleWakewordRuntimeStateChangeRuntime({
      nextState,
      previousState,
      setWakewordState,
      appendVoiceTrace,
      showPetStatus,
    })
  }, [appendVoiceTrace, showPetStatus])

  const handleWakewordKeywordDetected = useCallback((keyword: string) => {
    handleWakewordKeywordDetectedRuntime({
      keyword,
      voiceStateRef,
      busyRef: ctx.busyRef,
      wakewordAcknowledgingRef,
      appendVoiceTrace,
      acknowledgeWakewordAndStartListening,
    })
  }, [acknowledgeWakewordAndStartListening, appendVoiceTrace, ctx.busyRef])

  useEffect(() => {
    wakewordRuntimeStateChangeRef.current = handleWakewordRuntimeStateChange
  }, [handleWakewordRuntimeStateChange])

  useEffect(() => {
    wakewordKeywordDetectedRef.current = handleWakewordKeywordDetected
  }, [handleWakewordKeywordDetected])

  useEffect(() => {
    // Only create wakeword runtime if speech input is enabled and trigger mode is wake_word
    if (!settings.speechInputEnabled || settings.voiceTriggerMode !== 'wake_word') {
      return
    }

    return createWakewordRuntimeBinding({
      wakewordRuntimeRef,
      wakewordRuntimeStateChangeRef,
      wakewordKeywordDetectedRef,
      setWakewordState,
    })
  }, [settings.speechInputEnabled, settings.voiceTriggerMode])  

  // Keep refs current — intentionally no deps to capture latest closures.
  // Use a layout-time assignment instead of useEffect to avoid extra render cycles.
  startVoiceConversationRef.current = startVoiceConversation
  stopApiRecordingRef.current = stopApiRecording
  stopVadListeningRef.current = stopVadListening
  stopActiveSpeechOutputRef.current = stopActiveSpeechOutput

  // ── Test functions ─────────────────────────────────────────────────────────

  async function testSpeechInputConnection(draftSettings: AppSettings) {
    return testSpeechInputConnectionRuntime({
      draftSettings,
      testSpeechInputReadiness,
    })
  }

  async function probeSpeechOutputPlaybackStart(
    draftSettings: AppSettings,
    text: string,
  ) {
    await probeSpeechOutputPlaybackStartRuntime({
      draftSettings,
      text,
      stopActiveSpeechOutput,
      startSpeechOutput,
    })
  }

  async function testSpeechOutputReadiness(
    draftSettings: AppSettings,
    options?: {
      playSample?: boolean
      sampleText?: string
    },
  ) {
    return testSpeechOutputReadinessRuntime({
      draftSettings,
      options,
      probeSpeechOutputPlaybackStart,
    })
  }

  async function runAudioSmokeTest(draftSettings: AppSettings) {
    return runAudioSmokeTestRuntime({
      draftSettings,
      testSpeechInputConnection,
      testSpeechOutputReadiness,
    })
  }

  // ── Effects ────────────────────────────────────────────────────────────────

  // Ensure supported speech input settings on mount
  useEffect(() => {
    ensureSupportedSpeechInputSettings()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Disable continuous voice when setting is off
  useEffect(() => {
    if (settings.continuousVoiceModeEnabled || !continuousVoiceActiveRef.current) return

    clearPendingVoiceRestart()
    setContinuousVoiceSession(false)
  }, [settings.continuousVoiceModeEnabled, clearPendingVoiceRestart])

  // If runtime continuous voice is already active on startup, keep the saved setting aligned.
  useEffect(() => {
    const wasActive = previousContinuousVoiceActiveRef.current
    previousContinuousVoiceActiveRef.current = continuousVoiceActive

    if (wasActive || !continuousVoiceActive || settings.continuousVoiceModeEnabled) {
      return
    }

    if (ctx.applySettingsUpdate) {
      void ctx.applySettingsUpdate((current) => (
        current.continuousVoiceModeEnabled
          ? current
          : {
              ...current,
              continuousVoiceModeEnabled: true,
            }
      ))
      return
    }

    setSettings((current) => (
      current.continuousVoiceModeEnabled
        ? current
        : {
            ...current,
            continuousVoiceModeEnabled: true,
          }
    ))
  }, [continuousVoiceActive, settings.continuousVoiceModeEnabled]) // eslint-disable-line react-hooks/exhaustive-deps -- ctx and setSettings are stable parent references

  useEffect(() => {
    const runtime = wakewordRuntimeRef.current
    if (!runtime) return
    const configuredWakeWord = settings.wakeWord.trim()

    const wakewordEnabled = (
      settings.speechInputEnabled
      && settings.voiceTriggerMode === 'wake_word'
      && Boolean(configuredWakeWord)
      && view === 'pet'
    )

    const suspended = voiceState !== 'idle'
    const suspendReason = suspended
      ? voiceState === 'listening'
        ? '正在收音'
        : voiceState === 'processing'
          ? '正在处理语音'
          : '正在播报回复'
      : ''

    void runtime.update({
      enabled: wakewordEnabled,
      wakeWord: configuredWakeWord,
      suspended,
      suspendReason,
    })
  })

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupVoiceRuntimeResources({
        clearPendingVoiceRestart,
        recognitionRef,
        stopApiRecording: stopApiRecordingRef.current,
        stopVadListening: stopVadListeningRef.current,
        speechLevelValueRef,
        setSpeechLevel,
        stopActiveSpeechOutput: stopActiveSpeechOutputRef.current,
        paraformerSessionRef,
        sensevoiceSessionRef,
        wakewordRuntimeRef,
      })
    }
  }, [clearPendingVoiceRestart])

  useEffect(() => {
    return () => {
      voiceBus.destroy()
      hearingRuntime.dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    // State
    voiceState,
    continuousVoiceActive,
    liveTranscript,
    speechLevel,
    wakewordState,
    voicePipeline,
    voiceTrace,

    // Refs (for cross-hook access)
    voiceStateRef,
    continuousVoiceActiveRef,
    suppressVoiceReplyRef,

    // Setters (for sendMessage in useChat + cross-window sync)
    setVoiceState,
    setLiveTranscript,
    setVoicePipeline,
    setVoiceTrace,

    // Pipeline
    updateVoicePipeline,
    appendVoiceTrace,

    // Voice control
    toggleVoiceConversation,
    startVoiceConversation,
    stopVoiceConversation,
    speakAssistantReply,
    beginStreamingSpeechReply,
    scheduleVoiceRestart,
    voiceBus,
    hearingRuntime,
    busEmit,
    shouldAutoRestartVoice,
    clearPendingVoiceRestart,
    resetNoSpeechRestartCount,
    setContinuousVoiceSession,
    fillComposerWithVoiceTranscript,
    stopActiveSpeechOutput,

    // Test functions
    testSpeechInputConnection,
    testSpeechOutputReadiness,
    runAudioSmokeTest,
    ensureSupportedSpeechInputSettings,

    // Low-level speech output (for settings preview)
    startSpeechOutput,
  }
}
