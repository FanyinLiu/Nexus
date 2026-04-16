import type { MutableRefObject, RefObject } from 'react'
import {
  RESTART_RETRY_LIMIT,
  canInterruptSpeech as policyCanInterruptSpeech,
  evaluateRestartGuards,
  getNoSpeechRestartDelay as policyGetNoSpeechRestartDelay,
  getRestartDelay,
  shouldAutoRestart,
  shouldKeepContinuousSession,
} from '../../features/voice/autoRestartPolicy'
import { calculateAudioRms, requestVoiceInputStream } from '../../features/voice/runtimeSupport'
import { voiceDebug } from '../../features/voice/voiceDebugLog'
import type { BrowserSpeechRecognition } from '../../lib/voice'
import type { AppSettings, PetMood, VoiceState } from '../../types'
import {
  SPEECH_INTERRUPT_ANALYSER_FFT_SIZE,
  SPEECH_INTERRUPT_GRACE_MS,
  SPEECH_INTERRUPT_MIN_SPEECH_MS,
  SPEECH_INTERRUPT_RMS_THRESHOLD,
  SPEECH_INTERRUPT_TTS_LEVEL_GAIN,
} from './constants'
import type {
  SpeechInterruptMonitorSession,
  VadConversationSession,
  VoiceConversationOptions,
} from './types'

type ShowPetStatus = (
  message: string,
  duration?: number,
  dedupeWindowMs?: number,
) => void

type ShouldAutoRestartVoiceOptions = {
  continuousVoiceActiveRef: MutableRefObject<boolean>
  settingsRef: RefObject<AppSettings>
}

type ContinuousVoiceOptions = {
  settingsRef: RefObject<AppSettings>
}

type ScheduleVoiceRestartOptions = {
  restartVoiceTimerRef: MutableRefObject<number | null>
  recognitionRef: MutableRefObject<BrowserSpeechRecognition | null>
  vadSessionRef: MutableRefObject<VadConversationSession | null>
  busyRef: RefObject<boolean>
  voiceStateRef: MutableRefObject<VoiceState>
  shouldAutoRestartVoice: () => boolean
  showPetStatus: ShowPetStatus
  startVoiceConversation: (options?: VoiceConversationOptions) => void
  statusText?: string
  delay?: number
  /** When true, skip the shouldAutoRestartVoice() gate (used for voice-initiated turns). */
  force?: boolean
  /** Internal: tracks how many times the restart has been rescheduled. */
  _retryCount?: number
}

type PauseContinuousVoiceOptions = {
  clearPendingVoiceRestart: () => void
  setContinuousVoiceSession: (active: boolean) => void
  resetNoSpeechRestartCount: () => void
  setError: (error: string | null) => void
  showPetStatus: ShowPetStatus
  message: string
  statusText?: string
}

type StartSpeechInterruptMonitorOptions = {
  speechGeneration: number
  shouldResumeContinuousVoice: boolean
  speechInterruptMonitorRef: MutableRefObject<SpeechInterruptMonitorSession | null>
  assistantSpeechGenerationRef: MutableRefObject<number>
  interruptedSpeechGenerationRef: MutableRefObject<number | null>
  voiceStateRef: MutableRefObject<VoiceState>
  continuousVoiceActiveRef: MutableRefObject<boolean>
  settingsRef: RefObject<AppSettings>
  /**
   * Live TTS playback level (normalized 0-1, emitted by StreamAudioPlayer/
   * SpeechLevelController). Used as a reference signal so the interrupt
   * threshold scales up while TTS is loud — prevents residual echo (after
   * WebRTC AEC) from being mistaken for the user speaking.
   */
  speechLevelValueRef: MutableRefObject<number>
  clearPendingVoiceRestart: () => void
  stopActiveSpeechOutput: () => void
  onInterrupted: () => void
  setMood: (mood: PetMood) => void
  showPetStatus: ShowPetStatus
  scheduleVoiceRestart: (statusText?: string, delay?: number, force?: boolean) => void
}

export function destroySpeechInterruptMonitor(
  speechInterruptMonitorRef: MutableRefObject<SpeechInterruptMonitorSession | null>,
  session: SpeechInterruptMonitorSession | null,
) {
  if (!session) {
    return
  }

  if (session.animationFrameId) {
    window.cancelAnimationFrame(session.animationFrameId)
  }

  if (speechInterruptMonitorRef.current === session) {
    speechInterruptMonitorRef.current = null
  }

  try {
    session.source.disconnect()
  } catch {
    // no-op
  }

  try {
    session.analyser.disconnect()
  } catch {
    // no-op
  }

  session.stream.getTracks().forEach((track) => track.stop())
  void session.audioContext.close().catch(() => undefined)
}

export function stopSpeechInterruptMonitor(
  speechInterruptMonitorRef: MutableRefObject<SpeechInterruptMonitorSession | null>,
) {
  destroySpeechInterruptMonitor(speechInterruptMonitorRef, speechInterruptMonitorRef.current)
}

export function resetNoSpeechRestartCount(
  noSpeechRestartCountRef: MutableRefObject<number>,
) {
  noSpeechRestartCountRef.current = 0
}

export function getNoSpeechRestartDelay(
  noSpeechRestartCountRef: MutableRefObject<number>,
) {
  return policyGetNoSpeechRestartDelay(noSpeechRestartCountRef.current)
}

export function clearPendingVoiceRestart(
  restartVoiceTimerRef: MutableRefObject<number | null>,
) {
  if (!restartVoiceTimerRef.current) {
    return
  }

  window.clearTimeout(restartVoiceTimerRef.current)
  restartVoiceTimerRef.current = null
}

export function shouldAutoRestartVoice(
  options: ShouldAutoRestartVoiceOptions,
) {
  const decision = shouldAutoRestart({
    continuousActive: options.continuousVoiceActiveRef.current,
    settings: options.settingsRef.current,
  })
  if (!decision.allowed) {
    voiceDebug('ContinuousVoice', 'shouldAutoRestartVoice=false — reason:', decision.reason)
  }
  return decision.allowed
}

export function shouldKeepContinuousVoiceSession(
  options: ContinuousVoiceOptions,
) {
  return shouldKeepContinuousSession({ settings: options.settingsRef.current })
}

export function canInterruptSpeech(options: ContinuousVoiceOptions) {
  return policyCanInterruptSpeech(options.settingsRef.current)
}

export function isSpeechInterrupted(
  interruptedSpeechGenerationRef: MutableRefObject<number | null>,
  speechGeneration: number,
) {
  return interruptedSpeechGenerationRef.current === speechGeneration
}

export function clearSpeechInterruptedFlag(
  interruptedSpeechGenerationRef: MutableRefObject<number | null>,
  speechGeneration: number,
) {
  if (interruptedSpeechGenerationRef.current === speechGeneration) {
    interruptedSpeechGenerationRef.current = null
  }
}

export function shouldMonitorSpeechInterruptions(
  options: {
    shouldResumeContinuousVoice: boolean
  } & ContinuousVoiceOptions,
) {
  return (
    options.shouldResumeContinuousVoice
    && canInterruptSpeech(options)
    && options.settingsRef.current.speechInputEnabled
    && Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

export function pauseContinuousVoice(options: PauseContinuousVoiceOptions) {
  const statusText = options.statusText || options.message

  options.clearPendingVoiceRestart()
  options.setContinuousVoiceSession(false)
  options.resetNoSpeechRestartCount()
  options.setError(options.message)
  options.showPetStatus(statusText, 3_200, 4_000)
}

/**
 * @deprecated Prefer emitting bus events (`tts:completed`, `tts:error`, `voice:restart_requested`)
 * via `busEmit()` — the bus effect executor in `useVoice` handles restart scheduling automatically.
 * This function is kept during the dual-write migration period and will be removed once all
 * callers have been migrated to the VoiceBus event path.
 */
export function scheduleVoiceRestart(options: ScheduleVoiceRestartOptions) {
  const statusText = options.statusText || '我继续收音，你可以接着说。'
  const delay = getRestartDelay('initial', { requested: options.delay })
  const force = options.force ?? false
  const retryCount = options._retryCount ?? 0

  const autoRestart = force || options.shouldAutoRestartVoice()
  const hasPendingTimer = Boolean(options.restartVoiceTimerRef.current)
  if (!autoRestart || hasPendingTimer) {
    voiceDebug('ContinuousVoice', 'scheduleVoiceRestart BLOCKED — autoRestart:', autoRestart, 'force:', force, 'hasPendingTimer:', hasPendingTimer)
    return
  }

  voiceDebug('ContinuousVoice', 'scheduleVoiceRestart — delay:', delay, 'force:', force, 'retry:', retryCount)

  options.restartVoiceTimerRef.current = window.setTimeout(() => {
    options.restartVoiceTimerRef.current = null

    if (!force && !options.shouldAutoRestartVoice()) {
      voiceDebug('ContinuousVoice', 'timer — shouldAutoRestartVoice()=false, aborting')
      return
    }

    const guard = evaluateRestartGuards({
      hasActiveRecognition: Boolean(options.recognitionRef.current),
      hasActiveVadSession: Boolean(options.vadSessionRef.current),
      chatBusy: Boolean(options.busyRef.current),
      voiceState: options.voiceStateRef.current,
    })

    if (!guard.ok) {
      if (retryCount >= RESTART_RETRY_LIMIT) {
        console.warn('[ContinuousVoice] restart gave up after', retryCount, 'retries — blocker:', guard.blocker)
        options.showPetStatus('语音重启超时，请手动点击麦克风。', 4_000, 3_000)
        return
      }
      voiceDebug('ContinuousVoice', 'timer — blocked (retry', retryCount + 1, '), blocker:', guard.blocker)
      scheduleVoiceRestart({
        ...options,
        statusText,
        delay: getRestartDelay('retry'),
        _retryCount: retryCount + 1,
      })
      return
    }

    if (delay >= 1_000) {
      options.showPetStatus(statusText, 6_000, 4_500)
    }

    try {
      voiceDebug('ContinuousVoice', 'starting voice conversation (restart)')
      options.startVoiceConversation({ restart: true, passive: true })
    } catch (err) {
      console.warn('[ContinuousVoice] restart failed:', err)
      options.showPetStatus('语音重启失败，请手动重试。', 4_000, 3_000)
    }
  }, delay)
}

export async function startSpeechInterruptMonitor(
  options: StartSpeechInterruptMonitorOptions,
) {
  stopSpeechInterruptMonitor(options.speechInterruptMonitorRef)

  if (!shouldMonitorSpeechInterruptions({
    settingsRef: options.settingsRef,
    shouldResumeContinuousVoice: options.shouldResumeContinuousVoice,
  })) {
    return
  }

  let stream: MediaStream | null = null
  let audioContext: AudioContext | null = null

  try {
    stream = (await requestVoiceInputStream({ purpose: 'interrupt' })).stream
    audioContext = new AudioContext()

    if (audioContext.state === 'suspended') {
      await audioContext.resume().catch(() => undefined)
    }

    if (
      options.assistantSpeechGenerationRef.current !== options.speechGeneration
      || options.voiceStateRef.current !== 'speaking'
    ) {
      stream.getTracks().forEach((track) => track.stop())
      void audioContext.close().catch(() => undefined)
      return
    }

    const analyser = audioContext.createAnalyser()
    analyser.fftSize = SPEECH_INTERRUPT_ANALYSER_FFT_SIZE
    analyser.smoothingTimeConstant = 0.18

    const source = audioContext.createMediaStreamSource(stream)
    source.connect(analyser)

    const session: SpeechInterruptMonitorSession = {
      stream,
      audioContext,
      analyser,
      source,
      dataArray: new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>,
      animationFrameId: null,
      startedAt: performance.now(),
      speechStartedAt: null,
      speechGeneration: options.speechGeneration,
      triggered: false,
    }

    options.speechInterruptMonitorRef.current = session

    const tick = () => {
      if (options.speechInterruptMonitorRef.current !== session) {
        return
      }

      if (
        session.speechGeneration !== options.assistantSpeechGenerationRef.current
        || options.voiceStateRef.current !== 'speaking'
      ) {
        destroySpeechInterruptMonitor(options.speechInterruptMonitorRef, session)
        return
      }

      session.analyser.getFloatTimeDomainData(session.dataArray)
      const rms = calculateAudioRms(session.dataArray)
      const now = performance.now()

      // Dynamic threshold = static baseline + a multiple of the current TTS
      // playback level. When TTS is silent the threshold stays at the baseline
      // (sensitive enough for normal-volume user speech). When TTS is loud the
      // threshold rises so residual echo leaking past WebRTC AEC isn't mistaken
      // for the user speaking. The user has to actually speak *over* the TTS.
      const ttsLevel = options.speechLevelValueRef.current
      const dynamicThreshold = SPEECH_INTERRUPT_RMS_THRESHOLD
        + ttsLevel * SPEECH_INTERRUPT_TTS_LEVEL_GAIN

      if (now - session.startedAt >= SPEECH_INTERRUPT_GRACE_MS) {
        if (rms >= dynamicThreshold) {
          session.speechStartedAt ??= now
        } else {
          session.speechStartedAt = null
        }

        if (
          !session.triggered
          && session.speechStartedAt !== null
          && now - session.speechStartedAt >= SPEECH_INTERRUPT_MIN_SPEECH_MS
        ) {
          session.triggered = true
          options.interruptedSpeechGenerationRef.current = options.speechGeneration
          destroySpeechInterruptMonitor(options.speechInterruptMonitorRef, session)
          options.clearPendingVoiceRestart()
          options.stopActiveSpeechOutput()
          options.onInterrupted()
          options.setMood('happy')
          options.showPetStatus('先停下播报，你继续说。', 2_400, 3_200)

          if (shouldAutoRestartVoice({
            continuousVoiceActiveRef: options.continuousVoiceActiveRef,
            settingsRef: options.settingsRef,
          })) {
            options.scheduleVoiceRestart('我继续收音，你可以接着说。', 60)
          }
          return
        }
      }

      session.animationFrameId = window.requestAnimationFrame(tick)
    }

    session.animationFrameId = window.requestAnimationFrame(tick)
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop())
    void audioContext?.close().catch(() => undefined)
    console.warn('[Voice] speech interruption monitor unavailable', error)
  }
}
