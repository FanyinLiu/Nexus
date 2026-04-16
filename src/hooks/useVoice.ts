/* eslint-disable react-hooks/refs -- useVoice is a ref-heavy voice infrastructure
   hook that must bridge refs, state, and event bus during render.  The lint rule
   flags `settings` (a plain AppSettings value) because the context object that
   carries it also holds RefObjects; these are false positives. */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createInitialWakewordRuntimeState,
  HearingRuntime,
  type HearingPhase,
  type ParaformerStreamSession,
  type SenseVoiceStreamSession,
  type WakewordRuntimeController,
} from '../features/hearing'
import type { TencentAsrStreamSession } from '../features/hearing/tencentAsr'
import {
  createVoiceSessionState,
  type AudioPlaybackQueue,
  type SpeechLevelController,
  type StreamAudioPlayer,
} from '../features/voice'
import {
  createId,
  loadVoiceTrace,
  loadVoicePipelineState,
  saveVoiceTrace,
  saveVoicePipelineState,
  type BrowserSpeechRecognition,
} from '../lib'
import { clearPendingVoiceRestart as clearPendingVoiceRestartTimer } from './voice/continuousVoice'
import { ensureSupportedSpeechInputSettingsRuntime } from './voice/providerFallbacks'
import type { ParaformerConversationState } from './voice/paraformerConversation'
import type { TencentConversationState } from './voice/tencentConversation'
import type { SenseVoiceConversationState } from './voice/sensevoiceConversation'
import {
  RESTART_RETRY_LIMIT,
  evaluateRestartGuards,
  getRestartDelay,
} from '../features/voice/autoRestartPolicy'
import { VoiceBus, type BusEffect } from '../features/voice/bus'
import type { VoiceBusEvent } from '../features/voice/busEvents'
import {
  getGlobalVoiceTransitionLog,
  installVoiceLogDevHooks,
} from '../features/voice/voiceTransitionLog'
import {
  acknowledgeWakewordAndStartListeningRuntime,
  cleanupVoiceRuntimeResources,
  createWakewordRuntimeBinding,
  handleWakewordKeywordDetectedRuntime,
  handleWakewordRuntimeStateChangeRuntime,
} from './voice'
import type {
  VoiceTraceEntry,
  VoicePipelineState,
  VoiceState,
  WakewordRuntimeState,
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
import type {
  Holder,
  VoiceBindings,
  VoiceEngines,
  VoiceLifecycle,
  VoiceRuntimeBag,
} from './voice/voiceRuntimeBag'
import { createVoiceBindings } from './voice/voiceBindings'
import { createVoiceConversationStarters } from './voice/voiceConversationStarters'
import { createVoiceLifecycleControls } from './voice/voiceLifecycleControls'
import { createVoiceTestEntries } from './voice/voiceTestEntries'

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_CONTINUOUS_NO_SPEECH_RESTARTS = 5
const VOICE_TRANSCRIPT_DEDUP_WINDOW_MS = 6_000
const MAX_VOICE_TRACE_ENTRIES = 8
const BROWSER_TTS_LIPSYNC_INTERVAL_MS = 88
const AUDIO_TTS_ANALYSER_FFT_SIZE = 512

export type { UseVoiceContext } from './voice/types'

export function useVoice(ctx: UseVoiceContext) {
  const settings = ctx.settings
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

  // ── Late-binding holders ────────────────────────────────────────────────
  // Bindings, engines, and lifecycle have circular dependencies (e.g.
  // bindings.startSpeechInterruptMonitor → lifecycle.scheduleVoiceRestart;
  // lifecycle.startVoiceConversation → engines.startParaformerVoiceConversation
  // → bindings.handleRecognizedVoiceTranscript).  We resolve them by
  // building each layer in order while passing shared holder slots, then
  // populating the slots as the factories return.
  const bindingsHolder: Holder<VoiceBindings> = { current: null }
  const enginesHolder: Holder<VoiceEngines> = { current: null }
  const lifecycleHolder: Holder<VoiceLifecycle> = { current: null }

  // ── Bus effect executor ────────────────────────────────────────────────
  //
  // Bus-driven restarts funnel through the same guard evaluation as the
  // legacy scheduleVoiceRestart path (Phase 1-2) so bus-originated restarts
  // don't drift from scheduler-originated ones. Retries reuse the policy
  // module's backoff curve.
  function scheduleBusRestart(delay: number, retryCount: number) {
    window.setTimeout(() => {
      const currentPhase = voiceBus.phase
      if (currentPhase !== 'idle') {
        console.log('[VoiceBus] restart_voice skipped — phase:', currentPhase)
        return
      }

      const guard = evaluateRestartGuards({
        hasActiveRecognition: Boolean(recognitionRef.current),
        hasActiveVadSession: Boolean(vadSessionRef.current),
        chatBusy: Boolean(ctx.busyRef.current),
        voiceState: voiceStateRef.current,
      })

      if (!guard.ok) {
        if (retryCount >= RESTART_RETRY_LIMIT) {
          console.warn('[VoiceBus] restart gave up after', retryCount, 'retries — blocker:', guard.blocker)
          showPetStatus('语音重启超时，请手动点击麦克风。', 4_000, 3_000)
          return
        }
        console.log('[VoiceBus] restart blocked (retry', retryCount + 1, '), blocker:', guard.blocker)
        scheduleBusRestart(getRestartDelay('retry'), retryCount + 1)
        return
      }

      try {
        console.log('[VoiceBus] restart_voice — starting voice conversation')
        lifecycleHolder.current?.startVoiceConversation({ restart: true, passive: true })
      } catch (err) {
        console.warn('[VoiceBus] restart failed:', err)
        showPetStatus('语音重启失败，请手动重试。', 4_000, 3_000)
      }
    }, delay)
  }

  function executeBusEffects(effects: BusEffect[]) {
    for (const effect of effects) {
      switch (effect.type) {
        case 'restart_voice':
          scheduleBusRestart(getRestartDelay('bus_effect', { requested: effect.delay }), 0)
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

  function busEmit(event: VoiceBusEvent) {
    const prevUiPhase = voiceBus.uiPhase
    const effects = voiceBus.emit(event)
    const nextUiPhase = voiceBus.uiPhase
    // Phase 2-3: UI state is derived directly from the internal 13-state
    // machine via `toUiPhase`, so we no longer bounce through the legacy
    // 4-phase `VoicePhase` surface here.
    if (prevUiPhase !== nextUiPhase) {
      setVoiceState(nextUiPhase)
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

  const clearPendingVoiceRestart = useCallback(() => {
    clearPendingVoiceRestartTimer(restartVoiceTimerRef)
  }, [])

  const ensureSupportedSpeechInputSettings = useCallback((announce = false) => {
    return ensureSupportedSpeechInputSettingsRuntime({
      announce,
      settingsRef: ctx.settingsRef,
      showPetStatus,
    })
  }, [ctx, showPetStatus])

  // ── Build the runtime bag and call factories in order ──────────────────
  // Bindings → Engines → Lifecycle → TestEntries.  Each populates its
  // holder slot so later factories can read it directly while earlier ones
  // (which are already constructed) use the holder for late-bound calls.
  const runtimeBag: VoiceRuntimeBag = {
    ctx,
    refs: {
      voiceStateRef,
      voiceSessionRef,
      continuousVoiceActiveRef,
      suppressVoiceReplyRef,
      restartVoiceTimerRef,
      noSpeechRestartCountRef,
      recognitionRef,
      apiRecordingRef,
      vadSessionRef,
      speechLevelControllerRef,
      audioPlaybackQueueRef,
      streamAudioPlayerRef,
      activeStreamingSpeechOutputRef,
      speechLevelValueRef,
      paraformerSessionRef,
      paraformerConversationRef,
      sensevoiceSessionRef,
      sensevoiceConversationRef,
      tencentAsrSessionRef,
      tencentConversationRef,
      speechInterruptMonitorRef,
      wakewordRuntimeRef,
      wakewordAcknowledgingRef,
      activeVoiceConversationOptionsRef,
      assistantSpeechGenerationRef,
      interruptedSpeechGenerationRef,
      lastSubmittedVoiceContentRef,
    },
    setters: {
      setVoiceState,
      setVoicePipeline,
      setVoiceTrace,
      setSpeechLevel,
      setContinuousVoiceActive,
      setLiveTranscript,
      setWakewordState,
    },
    hookCallbacks: {
      showPetStatus,
      updateVoicePipeline,
      appendVoiceTrace,
      clearPendingVoiceRestart,
      ensureSupportedSpeechInputSettings,
      busEmit,
    },
    hearingRuntime,
    voiceBus,
    bindingsHolder,
    enginesHolder,
    lifecycleHolder,
    tunables: {
      voiceTranscriptDedupWindowMs: VOICE_TRANSCRIPT_DEDUP_WINDOW_MS,
      maxContinuousNoSpeechRestarts: MAX_CONTINUOUS_NO_SPEECH_RESTARTS,
      browserTtsLipsyncIntervalMs: BROWSER_TTS_LIPSYNC_INTERVAL_MS,
      audioTtsAnalyserFftSize: AUDIO_TTS_ANALYSER_FFT_SIZE,
    },
  }

  bindingsHolder.current = createVoiceBindings(runtimeBag)
  enginesHolder.current = createVoiceConversationStarters(runtimeBag)
  lifecycleHolder.current = createVoiceLifecycleControls(runtimeBag)
  const testEntries = createVoiceTestEntries(runtimeBag)

  const bindings = bindingsHolder.current
  const lifecycle = lifecycleHolder.current

  const acknowledgeWakewordAndStartListening = useCallback((keyword: string) => {
    acknowledgeWakewordAndStartListeningRuntime({
      keyword,
      wakewordAcknowledgingRef,
      showPetStatus,
      updateVoicePipeline,
      startVoiceConversation: (options) => {
        startVoiceConversationRef.current(options)
      },
    })
  }, [showPetStatus, updateVoicePipeline])

  // ── Wakeword runtime binding ───────────────────────────────────────────────

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
      busEmit: (event) => voiceBus.emit(event),
    })
  }, [appendVoiceTrace, showPetStatus, voiceBus])

  const handleWakewordKeywordDetected = useCallback((keyword: string) => {
    handleWakewordKeywordDetectedRuntime({
      keyword,
      voiceStateRef,
      busyRef: ctx.busyRef,
      wakewordAcknowledgingRef,
      vadSessionRef,
      recognitionRef,
      paraformerSessionRef,
      sensevoiceSessionRef,
      tencentAsrSessionRef,
      appendVoiceTrace,
      acknowledgeWakewordAndStartListening,
      busEmit: (event) => voiceBus.emit(event),
    })
  }, [acknowledgeWakewordAndStartListening, appendVoiceTrace, ctx.busyRef, voiceBus])

  useEffect(() => {
    wakewordRuntimeStateChangeRef.current = handleWakewordRuntimeStateChange
  }, [handleWakewordRuntimeStateChange])

  useEffect(() => {
    wakewordKeywordDetectedRef.current = handleWakewordKeywordDetected
  }, [handleWakewordKeywordDetected])

  useEffect(() => {
    // Wakeword always-on listener is independent of the manual speech input toggle.
    // It only depends on the dedicated wakewordAlwaysOn setting and a non-empty wake word.
    if (!settings.wakewordAlwaysOn) {
      return
    }

    return createWakewordRuntimeBinding({
      wakewordRuntimeRef,
      wakewordRuntimeStateChangeRef,
      wakewordKeywordDetectedRef,
      setWakewordState,
    })
  }, [settings.wakewordAlwaysOn])

  // Keep refs current — intentionally no deps to capture latest closures.
  // Use a layout-time assignment instead of useEffect to avoid extra render cycles.
  startVoiceConversationRef.current = lifecycle.startVoiceConversation
  stopApiRecordingRef.current = bindings.stopApiRecording
  stopVadListeningRef.current = bindings.stopVadListening
  stopActiveSpeechOutputRef.current = bindings.stopActiveSpeechOutput

  // ── Effects ────────────────────────────────────────────────────────────────

  // Ensure supported speech input settings on mount
  useEffect(() => {
    ensureSupportedSpeechInputSettings()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Disable continuous voice when setting is off
  useEffect(() => {
    if (settings.continuousVoiceModeEnabled || !continuousVoiceActiveRef.current) return

    clearPendingVoiceRestart()
    bindings.setContinuousVoiceSession(false)
  }, [settings.continuousVoiceModeEnabled, clearPendingVoiceRestart, bindings])

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
      settings.wakewordAlwaysOn
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
  }, [
    settings.wakewordAlwaysOn,
    settings.wakeWord,
    view,
    voiceState,
  ])

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
        tencentAsrSessionRef,
        apiRecordingRef,
        wakewordRuntimeRef,
      })
    }
  }, [clearPendingVoiceRestart])

  useEffect(() => {
    return () => {
      voiceBus.reset()
      voiceBus.destroy()
      hearingRuntime.dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 1-1 observability: mirror every bus transition into the log.
  // The log is a pure observer — it never blocks or mutates events.
  useEffect(() => {
    const log = getGlobalVoiceTransitionLog()
    installVoiceLogDevHooks()
    return voiceBus.onTransition((event, prevPhase, nextPhase) => {
      log.record({ event, prevPhase, nextPhase })
    })
  }, [voiceBus])

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
    toggleVoiceConversation: lifecycle.toggleVoiceConversation,
    startVoiceConversation: lifecycle.startVoiceConversation,
    stopVoiceConversation: lifecycle.stopVoiceConversation,
    speakAssistantReply: lifecycle.speakAssistantReply,
    beginStreamingSpeechReply: lifecycle.beginStreamingSpeechReply,
    scheduleVoiceRestart: lifecycle.scheduleVoiceRestart,
    voiceBus,
    hearingRuntime,
    busEmit,
    shouldAutoRestartVoice: bindings.shouldAutoRestartVoice,
    clearPendingVoiceRestart,
    resetNoSpeechRestartCount: bindings.resetNoSpeechRestartCount,
    setContinuousVoiceSession: bindings.setContinuousVoiceSession,
    fillComposerWithVoiceTranscript: bindings.fillComposerWithVoiceTranscript,
    stopActiveSpeechOutput: bindings.stopActiveSpeechOutput,

    // Test functions
    testSpeechInputConnection: testEntries.testSpeechInputConnection,
    testSpeechOutputReadiness: testEntries.testSpeechOutputReadiness,
    runAudioSmokeTest: testEntries.runAudioSmokeTest,
    ensureSupportedSpeechInputSettings,

    // Low-level speech output (for settings preview)
    startSpeechOutput: bindings.startSpeechOutput,
  }
}
