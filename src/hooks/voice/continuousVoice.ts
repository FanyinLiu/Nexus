import type { MutableRefObject, RefObject } from 'react'
import { calculateAudioRms, requestVoiceInputStream } from '../../features/voice/runtimeSupport'
import type { BrowserSpeechRecognition } from '../../lib/voice'
import type { AppSettings, PetMood, VoiceState } from '../../types'
import {
  SPEECH_INTERRUPT_ANALYSER_FFT_SIZE,
  SPEECH_INTERRUPT_GRACE_MS,
  SPEECH_INTERRUPT_MIN_SPEECH_MS,
  SPEECH_INTERRUPT_RMS_THRESHOLD,
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

/** Max number of times scheduleVoiceRestart will reschedule when blocked by busy/speaking guards. */
const MAX_RESTART_RETRIES = 8

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
  clearPendingVoiceRestart: () => void
  stopActiveSpeechOutput: () => void
  onInterrupted: () => void
  setMood: (mood: PetMood) => void
  showPetStatus: ShowPetStatus
  scheduleVoiceRestart: (statusText?: string, delay?: number) => void
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
  return Math.min(1680, 420 + noSpeechRestartCountRef.current * 220)
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
  const active = options.continuousVoiceActiveRef.current
  const enabled = options.settingsRef.current.continuousVoiceModeEnabled
  const notWakeWord = options.settingsRef.current.voiceTriggerMode !== 'wake_word'
  const result = active && enabled && notWakeWord
  if (!result) {
    console.log('[ContinuousVoice] shouldAutoRestartVoice=false — active:', active, 'enabled:', enabled, 'notWakeWord:', notWakeWord)
  }
  return result
}

export function shouldKeepContinuousVoiceSession(
  options: ContinuousVoiceOptions,
) {
  return (
    options.settingsRef.current.continuousVoiceModeEnabled
    && options.settingsRef.current.voiceTriggerMode !== 'wake_word'
  )
}

export function canInterruptSpeech(_options: ContinuousVoiceOptions) {
  // Disabled: echo-cancelled mic still picks up TTS output, causing false interrupts
  // that abort multi-chunk speech. Needs hardware echo cancellation to work reliably.
  void _options
  return false
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
  const delay = options.delay ?? 150
  const force = options.force ?? false
  const retryCount = options._retryCount ?? 0

  const autoRestart = force || options.shouldAutoRestartVoice()
  const hasPendingTimer = Boolean(options.restartVoiceTimerRef.current)
  if (!autoRestart || hasPendingTimer) {
    console.log('[ContinuousVoice] scheduleVoiceRestart BLOCKED — autoRestart:', autoRestart, 'force:', force, 'hasPendingTimer:', hasPendingTimer)
    return
  }

  console.log('[ContinuousVoice] scheduleVoiceRestart — delay:', delay, 'force:', force, 'retry:', retryCount)

  options.restartVoiceTimerRef.current = window.setTimeout(() => {
    options.restartVoiceTimerRef.current = null

    if (!force && !options.shouldAutoRestartVoice()) {
      console.log('[ContinuousVoice] timer — shouldAutoRestartVoice()=false, aborting')
      return
    }

    const gates = {
      recognition: Boolean(options.recognitionRef.current),
      vadSession: Boolean(options.vadSessionRef.current),
      busy: Boolean(options.busyRef.current),
      voiceState: options.voiceStateRef.current,
    }

    if (
      gates.recognition
      || gates.vadSession
      || gates.busy
      || gates.voiceState === 'processing'
      || gates.voiceState === 'speaking'
    ) {
      if (retryCount >= MAX_RESTART_RETRIES) {
        console.warn('[ContinuousVoice] restart gave up after', retryCount, 'retries — gates:', JSON.stringify(gates))
        options.showPetStatus('语音重启超时，请手动点击麦克风。', 4_000, 3_000)
        return
      }
      console.log('[ContinuousVoice] timer — blocked (retry', retryCount + 1, '), gates:', JSON.stringify(gates))
      scheduleVoiceRestart({
        ...options,
        statusText,
        delay: 320,
        _retryCount: retryCount + 1,
      })
      return
    }

    if (delay >= 1_000) {
      options.showPetStatus(statusText, 6_000, 4_500)
    }

    try {
      console.log('[ContinuousVoice] starting voice conversation (restart)')
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

      if (now - session.startedAt >= SPEECH_INTERRUPT_GRACE_MS) {
        if (rms >= SPEECH_INTERRUPT_RMS_THRESHOLD) {
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
