import type { MutableRefObject, RefObject } from 'react'
import {
  canInterruptSpeech as policyCanInterruptSpeech,
  getNoSpeechRestartDelay as policyGetNoSpeechRestartDelay,
  shouldAutoRestart,
  shouldKeepContinuousSession,
} from '../../features/voice/autoRestartPolicy'
import { calculateAudioRms, requestVoiceInputStream } from '../../features/voice/runtimeSupport'
import { voiceDebug } from '../../features/voice/voiceDebugLog'
import type { WakewordRuntimeController } from '../../features/hearing/wakewordRuntime.ts'
import type { AppSettings, PetMood, TranslationKey, TranslationParams, VoiceState } from '../../types'

type Translator = (key: TranslationKey, params?: TranslationParams) => string
import {
  SPEECH_INTERRUPT_ANALYSER_FFT_SIZE,
  SPEECH_INTERRUPT_GRACE_MS,
  SPEECH_INTERRUPT_MIN_SPEECH_MS,
  SPEECH_INTERRUPT_RMS_THRESHOLD,
  SPEECH_INTERRUPT_TTS_LEVEL_GAIN,
} from './constants'
import type { SpeechInterruptMonitorSession } from './types'

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
  /**
   * When the always-on KWS listener is live, monitor subscribes to its mic
   * frames instead of opening a second getUserMedia. On macOS a second
   * stream on the same default input occasionally contends with the KWS
   * ScriptProcessor, producing sporadic "silence" from the monitor. Null
   * ref or wakeword not listening → falls back to own mic.
   */
  wakewordRuntimeRef?: MutableRefObject<WakewordRuntimeController | null>
  clearPendingVoiceRestart: () => void
  stopActiveSpeechOutput: () => void
  onInterrupted: () => void
  setMood: (mood: PetMood) => void
  showPetStatus: ShowPetStatus
  scheduleVoiceRestart: (statusText?: string, delay?: number, force?: boolean) => void
  ti: Translator
}

function destroySpeechInterruptMonitor(
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

  // Frame-driver path: drop the wakeword subscription so the monitor
  // stops receiving samples. No mic / audioContext to tear down.
  if (session.unsubscribeFrames) {
    try { session.unsubscribeFrames() } catch { /* no-op */ }
    session.unsubscribeFrames = null
    return
  }

  // Legacy capture path: close the WebAudio graph and release the mic.
  try {
    session.source?.disconnect()
  } catch {
    // no-op
  }

  try {
    session.analyser?.disconnect()
  } catch {
    // no-op
  }

  session.stream?.getTracks().forEach((track) => track.stop())
  if (session.audioContext) {
    void session.audioContext.close().catch(() => undefined)
  }
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

function shouldMonitorSpeechInterruptions(
  options: {
    shouldResumeContinuousVoice: boolean
  } & ContinuousVoiceOptions,
) {
  // Monitor activation decoupled from `shouldResumeContinuousVoice`: previously
  // barge-in only worked when the turn originated from a continuous voice
  // session, which made typed-text TTS un-interruptible. Now the monitor
  // spawns whenever the user has opted in (`voiceInterruptionEnabled`) and a
  // mic is available. The flag is still threaded through to influence the
  // post-interrupt restart decision via shouldAutoRestartVoice.
  return (
    canInterruptSpeech(options)
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

  // Prefer wakeword frames when the KWS listener is already running: avoids
  // opening a second getUserMedia on the same device (which occasionally
  // contends on macOS), and means the monitor starts instantly — no
  // permission / mic-init latency. Fall back to opening our own mic when
  // the wakeword listener isn't up.
  const wakewordRuntime = options.wakewordRuntimeRef?.current
  const wakewordPhase = wakewordRuntime?.getState().phase
  const useFrameDriver = Boolean(
    wakewordRuntime && (wakewordPhase === 'listening' || wakewordPhase === 'paused'),
  )
  voiceDebug(
    'BargeIn',
    'monitor armed',
    `mode=${useFrameDriver ? 'frame-driver' : 'own-mic'}`,
    `gen=${options.speechGeneration}`,
  )

  let session: SpeechInterruptMonitorSession

  if (useFrameDriver) {
    session = {
      stream: null,
      audioContext: null,
      analyser: null,
      source: null,
      // dataArray is unused on the frame-driver path but kept on the shape
      // so consumers can share one session type. Zero-length is fine.
      dataArray: new Float32Array(0) as Float32Array<ArrayBuffer>,
      unsubscribeFrames: null,
      currentRms: 0,
      animationFrameId: null,
      startedAt: performance.now(),
      speechStartedAt: null,
      speechGeneration: options.speechGeneration,
      triggered: false,
    }

    options.speechInterruptMonitorRef.current = session

    session.unsubscribeFrames = wakewordRuntime!.subscribeMicFrames((samples) => {
      // Only update if this is still the active session — avoid a stale
      // callback mutating a session we've already torn down.
      if (options.speechInterruptMonitorRef.current !== session) return
      session.currentRms = calculateAudioRms(samples)
    })
  } else {
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

      session = {
        stream,
        audioContext,
        analyser,
        source,
        dataArray: new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>,
        unsubscribeFrames: null,
        currentRms: 0,
        animationFrameId: null,
        startedAt: performance.now(),
        speechStartedAt: null,
        speechGeneration: options.speechGeneration,
        triggered: false,
      }

      options.speechInterruptMonitorRef.current = session
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      void audioContext?.close().catch(() => undefined)
      console.warn('[Voice] speech interruption monitor unavailable', error)
      return
    }
  }

  const readRms = (): number => {
    if (session.analyser && session.dataArray.length > 0) {
      session.analyser.getFloatTimeDomainData(session.dataArray)
      return calculateAudioRms(session.dataArray)
    }
    return session.currentRms
  }

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

    const rms = readRms()
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
        voiceDebug(
          'BargeIn',
          'fired',
          `gen=${options.speechGeneration}`,
          `rms=${rms.toFixed(4)}`,
          `threshold=${dynamicThreshold.toFixed(4)}`,
          `ttsLevel=${ttsLevel.toFixed(3)}`,
          `speechMs=${Math.round(now - session.speechStartedAt)}`,
        )
        destroySpeechInterruptMonitor(options.speechInterruptMonitorRef, session)
        options.clearPendingVoiceRestart()
        options.stopActiveSpeechOutput()
        options.onInterrupted()
        options.setMood('happy')
        options.showPetStatus(options.ti('voice.pause_before_continue'), 2_400, 3_200)

        // Post-barge-in restart policy:
        // - Wake-word modes (voiceTriggerMode === 'wake_word' OR
        //   wakewordAlwaysOn): don't reopen VAD. KWS will pick the user's
        //   continuation back up via the wake word; forcing a VAD session
        //   here would conflict with the always-on listener and also
        //   violate the "mic only opens after wake word" setting.
        // - Otherwise (continuous, push-to-talk, or typed-turn barge-in):
        //   force a VAD restart. The user just spoke to interrupt — they
        //   clearly intend to continue. This makes barge-in useful on
        //   typed-text TTS too, not just when continuous mode happens to
        //   be on.
        const settings = options.settingsRef.current
        const canForceBargeInRestart = (
          settings.voiceTriggerMode !== 'wake_word'
          && !settings.wakewordAlwaysOn
        )
        if (canForceBargeInRestart) {
          options.scheduleVoiceRestart(options.ti('voice.status.resume_listening'), 60, true)
        }
        return
      }
    }

    session.animationFrameId = window.requestAnimationFrame(tick)
  }

  session.animationFrameId = window.requestAnimationFrame(tick)
}
