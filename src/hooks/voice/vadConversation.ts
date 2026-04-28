import type { MutableRefObject } from 'react'
import {
  createVoiceActivityDetector,
  encodeVadAudioToWavBlob,
} from '../../features/hearing/browserVad.ts'
import { createMainProcessVadController } from '../../features/hearing/mainProcessVad.ts'
import type { WakewordRuntimeController } from '../../features/hearing/wakewordRuntime.ts'
import type { VoiceBusEvent } from '../../features/voice/busEvents'
import { formatTraceLabel } from '../../features/voice/shared'
import type {
  VoiceSessionEvent,
  VoiceSessionTransport,
} from '../../features/voice/sessionMachine'
import { VoiceReasonCodes } from '../../features/voice/voiceReasonCodes'
import { blobToBase64 } from '../../lib/common'
import { createId } from '../../lib'
import { recordSttUsage } from '../../features/metering/speechCost'
import { mapSpeechError } from '../../lib/voice'
import type {
  AppSettings,
  PetMood,
  TranslationKey,
  TranslationParams,
  VoicePipelineState,
  VoiceState,
} from '../../types'
import {
  API_RECORDING_MAX_DURATION_MS,
  API_RECORDING_MAX_IDLE_MS,
} from './constants'
import type {
  VadConversationSession,
  VoiceConversationOptions,
} from './types'

type ShowPetStatus = (
  message: string,
  duration?: number,
  dedupeWindowMs?: number,
) => void

type Translator = (key: TranslationKey, params?: TranslationParams) => string

export type StartVadConversationOptions = {
  transcribeMode: 'api' | 'local'
  options?: VoiceConversationOptions
  currentSettings: AppSettings
  vadSessionRef: MutableRefObject<VadConversationSession | null>
  wakewordRuntimeRef: MutableRefObject<WakewordRuntimeController | null>
  /**
   * Timestamp (ms epoch) before which VAD should suppress `speech_start`
   * callbacks. Set whenever the user just interrupted TTS — residual
   * main-process audio may reach the mic within ~200 ms of the abort
   * IPC and would otherwise be detected as a false speech onset.
   */
  voiceEchoCooldownUntilRef: MutableRefObject<number>
  voiceStateRef: MutableRefObject<VoiceState>
  suppressVoiceReplyRef: MutableRefObject<boolean>
  clearPendingVoiceRestart: () => void
  canInterruptSpeech: () => boolean
  interruptSpeakingForVoiceInput: () => boolean
  setContinuousVoiceSession: (active: boolean) => void
  shouldKeepContinuousVoiceSession: () => boolean
  resetNoSpeechRestartCount: () => void
  beginVoiceListeningSession: (transport: VoiceSessionTransport) => unknown
  dispatchVoiceSession: (event: VoiceSessionEvent) => unknown
  dispatchVoiceSessionAndSync: (event: VoiceSessionEvent) => unknown
  setVoiceState: (state: VoiceState) => void
  setMood: (mood: PetMood) => void
  setError: (error: string | null) => void
  setLiveTranscript: (transcript: string) => void
  updateVoicePipeline: (
    step: VoicePipelineState['step'],
    detail: string,
    transcript?: string,
  ) => void
  appendVoiceTrace: (title: string, detail: string) => void
  showPetStatus: ShowPetStatus
  setSpeechLevelValue: (level: number) => void
  destroyVadSession: (session: VadConversationSession | null) => Promise<void>
  handleRecognizedVoiceTranscript: (
    transcript: string,
    options?: { traceId?: string },
  ) => Promise<boolean>
  handleVoiceListeningFailure: (
    message: string,
    errorCode?: string,
  ) => void
  startFallbackConversation: (
    options?: VoiceConversationOptions,
  ) => Promise<void>
  shouldAutoRestartVoice: () => boolean
  busEmit?: (event: VoiceBusEvent) => void
  ti: Translator
}

export async function startVadConversation(
  params: StartVadConversationOptions,
) {
  const restart = params.options?.restart ?? false
  const passive = params.options?.passive ?? false

  if (params.transcribeMode === 'api' && !window.desktopPet?.transcribeAudio) {
    params.setContinuousVoiceSession(false)
    params.setError(params.ti('voice.provider.api.connect_required'))
    return
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    params.setContinuousVoiceSession(false)
    params.setError(params.ti('voice.provider.vad.no_mic_input'))
    return
  }

  params.clearPendingVoiceRestart()

  if (params.voiceStateRef.current === 'speaking') {
    if (!params.canInterruptSpeech()) {
      params.showPetStatus(params.ti('voice.interruption_disabled'), 2_800, 3_200)
      return
    }

    if (!params.interruptSpeakingForVoiceInput()) {
      return
    }
  }

  params.suppressVoiceReplyRef.current = false

  if (!restart) {
    params.setContinuousVoiceSession(params.shouldKeepContinuousVoiceSession())
    params.resetNoSpeechRestartCount()
  }

  // Prefer the shared-audio path: if the always-on wakeword listener is
  // live, VAD subscribes to its ScriptProcessor frames and runs Silero on
  // the same samples KWS is decoding. No second getUserMedia, no MicVAD,
  // no mic-device race with Chromium/WASAPI. Falls back to the legacy
  // MicVAD path only when the wakeword listener isn't available (e.g.,
  // manual voice start while wake word is off, or the listener is in an
  // error/retry state and has no active ScriptProcessor).
  const wakewordRuntime = params.wakewordRuntimeRef.current
  const wakewordPhase = wakewordRuntime?.getState().phase
  const useFrameDriver = Boolean(
    wakewordRuntime && (wakewordPhase === 'listening' || wakewordPhase === 'paused'),
  )

  // Declare up front so the shared VAD event handlers below can close over
  // the session variable — TS would otherwise complain about use-before-
  // assignment inside the handlers passed into the detector/frame driver.
  let session!: VadConversationSession

  const handleSpeechStart = () => {
    if (params.vadSessionRef.current !== session) return
    // Echo cooldown: suppress speech_start during the short window after a
    // user barge-in, so the tail end of the aborted TTS doesn't bounce
    // back through the mic and look like user speech.
    if (Date.now() < params.voiceEchoCooldownUntilRef.current) return
    session.speechDetected = true
    params.dispatchVoiceSession({ type: 'speech_detected' })
    params.busEmit?.({
      type: 'vad:speech_start',
      reason: VoiceReasonCodes.VAD_SPEECH_START,
    })
    params.updateVoicePipeline('listening', params.ti('voice.pipeline.vad_detected'))
  }

  const handleSpeechRealStart = () => {
    if (params.vadSessionRef.current !== session) return
    params.resetNoSpeechRestartCount()
  }

  const handleFrameProcessed = (speechProbability: number) => {
    if (params.vadSessionRef.current !== session) return
    params.setSpeechLevelValue(speechProbability)
  }

  const handleMisfire = () => {
    if (params.vadSessionRef.current !== session || session.cancelled) return
    // Misfire = speech detected but shorter than minSpeechMs. With the
    // frame driver path VAD starts receiving audio the instant the
    // wakeword session fires, so it often picks up the tail of "星绘"
    // before the real command arrives. Don't tear the session down —
    // just keep listening for the real utterance. The noSpeechTimer
    // still guards against truly empty sessions.
    console.warn('[VAD] onMisfire — ignoring, keep listening')
    session.speechDetected = false
    params.setSpeechLevelValue(0)
  }

  const handleSpeechEnd = async (audio: Float32Array) => {
    if (params.vadSessionRef.current !== session || session.cancelled) return

    params.vadSessionRef.current = null
    if (session.noSpeechTimer) {
      window.clearTimeout(session.noSpeechTimer)
    }
    if (session.maxDurationTimer) {
      window.clearTimeout(session.maxDurationTimer)
    }
    params.setSpeechLevelValue(0)
    params.busEmit?.({
      type: 'vad:speech_end',
      reason: VoiceReasonCodes.VAD_SPEECH_END,
    })

    try {
      params.dispatchVoiceSessionAndSync({ type: 'stt_finalizing' })
      params.setMood('thinking')
      const traceId = createId('voice')
      const traceLabel = formatTraceLabel(traceId)
      params.appendVoiceTrace(
        params.transcribeMode === 'local' ? 'Start local transcription' : 'Start transcription',
        `#${traceLabel} ${
          params.transcribeMode === 'local'
            ? 'calling local Whisper'
            : 'requesting speech recognition service'
        }`,
      )
      params.updateVoicePipeline(
        'transcribing',
        params.ti('voice.pipeline.vad_end_transcribing'),
      )

      const audioBlob = encodeVadAudioToWavBlob(audio)
      const transcript = (
        await window.desktopPet!.transcribeAudio({
          providerId: params.currentSettings.speechInputProviderId,
          baseUrl: params.currentSettings.speechInputApiBaseUrl,
          apiKey: params.currentSettings.speechInputApiKey,
          model: params.currentSettings.speechInputModel,
          traceId,
          language: params.currentSettings.speechRecognitionLang,
          hotwords: params.currentSettings.speechInputHotwords,
          audioBase64: await blobToBase64(audioBlob),
          mimeType: 'audio/wav',
          fileName: 'speech.wav',
        })
      ).text.trim()

      await session.tearDown().catch(() => undefined)

      if (!transcript) {
        params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
        return
      }

      if (params.transcribeMode !== 'local') {
        recordSttUsage({
          providerId: params.currentSettings.speechInputProviderId,
          modelId: params.currentSettings.speechInputModel,
          transcriptChars: transcript.length,
        })
      }

      params.appendVoiceTrace(
        params.transcribeMode === 'local' ? 'Local transcription complete' : 'Transcription complete',
        `#${traceLabel} received recognized text`,
      )
      await params.handleRecognizedVoiceTranscript(transcript, { traceId })
    } catch (error) {
      await session.tearDown().catch(() => undefined)

      params.handleVoiceListeningFailure(
        error instanceof Error
          ? error.message
          : params.ti('voice.provider.api.failed_retry'),
      )
    }
  }

  try {
    if (useFrameDriver) {
      const mainVad = await createMainProcessVadController(
        {
          onSpeechStart: handleSpeechStart,
          onSpeechRealStart: handleSpeechRealStart,
          onSpeechEnd: handleSpeechEnd,
          onMisfire: handleMisfire,
          onFrameProcessed: handleFrameProcessed,
        },
        params.currentSettings.vadSensitivity,
      )

      const unsubscribe = wakewordRuntime!.subscribeMicFrames((samples) => {
        mainVad.pushSamples(samples)
      })

      session = {
        detector: null,
        frameDriver: mainVad,
        unsubscribeFrames: unsubscribe,
        async tearDown() {
          try { unsubscribe() } catch { /* no-op */ }
          await mainVad.destroy().catch(() => undefined)
        },
        noSpeechTimer: null,
        maxDurationTimer: null,
        cancelled: false,
        speechDetected: false,
      }
    } else {
      const detector = await createVoiceActivityDetector(
        {
          onSpeechStart: handleSpeechStart,
          onSpeechRealStart: handleSpeechRealStart,
          onSpeechEnd: handleSpeechEnd,
          onMisfire: handleMisfire,
          onFrameProcessed: handleFrameProcessed,
        },
        params.currentSettings.vadSensitivity,
      )

      session = {
        detector,
        frameDriver: null,
        unsubscribeFrames: null,
        async tearDown() {
          await detector.destroy().catch(() => undefined)
        },
        noSpeechTimer: null,
        maxDurationTimer: null,
        cancelled: false,
        speechDetected: false,
      }
    }

    params.vadSessionRef.current = session
    params.beginVoiceListeningSession(
      params.transcribeMode === 'local' ? 'local_vad' : 'remote_vad',
    )
    params.setMood('happy')
    params.setError(null)
    params.setLiveTranscript('')
    params.updateVoicePipeline(
      'listening',
      params.transcribeMode === 'local'
        ? (
            params.shouldAutoRestartVoice()
              ? params.ti('voice.pipeline.vad_local_continuous')
              : params.ti('voice.pipeline.vad_local_listening')
          )
        : (
            params.shouldAutoRestartVoice()
              ? params.ti('voice.pipeline.vad_api_continuous')
              : params.ti('voice.pipeline.vad_api_listening')
          ),
    )

    if (!passive) {
      params.showPetStatus(
        params.shouldAutoRestartVoice()
          ? params.ti('voice.status.continuous_vad_start')
          : params.ti('voice.status.vad_listening'),
        4_200,
        3_600,
      )
    }

    session.noSpeechTimer = window.setTimeout(() => {
      if (
        params.vadSessionRef.current !== session
        || session.cancelled
        || session.speechDetected
      ) {
        return
      }

      console.warn('[VAD] destroy source: noSpeechTimer')
      void params.destroyVadSession(session)
      params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
    }, API_RECORDING_MAX_IDLE_MS)

    session.maxDurationTimer = window.setTimeout(() => {
      if (params.vadSessionRef.current !== session || session.cancelled) return

      if (!session.speechDetected) {
        console.warn('[VAD] destroy source: maxDurationTimer (no speech)')
        void params.destroyVadSession(session)
        params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
        return
      }

      // Only the legacy MicVAD exposes a pause() that flushes the current
      // speech segment via submitUserSpeechOnPause. The frame-driver path
      // doesn't open its own mic; just force-tear down the session here.
      if (session.detector) {
        void session.detector.pause().catch(() => undefined)
      } else {
        void params.destroyVadSession(session)
      }
    }, API_RECORDING_MAX_DURATION_MS)

    if (session.detector) {
      await session.detector.start()
    }
  } catch (error) {
    // Partial-init cleanup: anything we wired up before throwing must
    // be torn down here, otherwise mainVad / detector / timers / the
    // session ref leak. Iterate every possible state.
    if (session) {
      session.cancelled = true
      if (session.noSpeechTimer != null) {
        window.clearTimeout(session.noSpeechTimer)
        session.noSpeechTimer = null
      }
      if (session.maxDurationTimer != null) {
        window.clearTimeout(session.maxDurationTimer)
        session.maxDurationTimer = null
      }
      try { await session.tearDown() } catch { /* best-effort */ }
      if (params.vadSessionRef.current === session) {
        params.vadSessionRef.current = null
      }
    }

    params.setVoiceState('idle')
    params.setMood('idle')
    params.setSpeechLevelValue(0)
    const originalMessage = (
      error instanceof Error
        ? error.message
        : params.ti('voice.provider.vad.start_failed')
    )
    const fallbackMessage = params.ti('voice.provider.vad.silero_fallback')

    console.warn('[Voice] Silero VAD unavailable, falling back to legacy recording', error)
    params.updateVoicePipeline('idle', fallbackMessage)
    params.showPetStatus(fallbackMessage, 4_800, 4_500)
    params.setError(params.ti('voice.provider.vad.silero_fallback_detail', { fallback: fallbackMessage, original: originalMessage }))

    await params.startFallbackConversation(params.options)
  }
}
