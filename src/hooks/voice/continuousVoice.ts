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
  return (
    options.continuousVoiceActiveRef.current
    && options.settingsRef.current.continuousVoiceModeEnabled
    && options.settingsRef.current.voiceTriggerMode !== 'wake_word'
  )
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

export function scheduleVoiceRestart(options: ScheduleVoiceRestartOptions) {
  const statusText = options.statusText || '我继续收音，你可以接着说。'
  const delay = options.delay ?? 520

  if (!options.shouldAutoRestartVoice() || options.restartVoiceTimerRef.current) {
    return
  }

  options.restartVoiceTimerRef.current = window.setTimeout(() => {
    options.restartVoiceTimerRef.current = null

    if (!options.shouldAutoRestartVoice()) {
      return
    }

    if (
      options.recognitionRef.current
      || options.vadSessionRef.current
      || options.busyRef.current
      || options.voiceStateRef.current === 'processing'
      || options.voiceStateRef.current === 'speaking'
    ) {
      scheduleVoiceRestart({
        ...options,
        statusText,
        delay: 320,
      })
      return
    }

    if (delay >= 1_000) {
      options.showPetStatus(statusText, 6_000, 4_500)
    }

    try {
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
