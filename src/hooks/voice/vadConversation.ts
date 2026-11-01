import type { MutableRefObject } from 'react'
import {
  createVoiceActivityDetector,
  encodeVadAudioToWavBlob,
  getBrowserVadSilenceMs,
} from '../../features/hearing/browserVad.ts'
import {
  createMainProcessVadController,
  getMainProcessVadSilenceMs,
} from '../../features/hearing/mainProcessVad.ts'
import { turnEndMaxSilenceMs } from '../../features/hearing/turnEnd.ts'
import { checkSenseVoiceAvailability } from '../../features/hearing/localSenseVoice.ts'
import type { WakewordRuntimeController } from '../../features/hearing/wakewordRuntime.ts'
import type { VoiceBusEvent } from '../../features/voice/busEvents.ts'
import { formatTraceLabel } from '../../features/voice/shared.ts'
import { isVoiceCaptureCancelled } from '../../features/voice/voiceCaptureAttempt.ts'
import { VoiceReasonCodes } from '../../features/voice/voiceReasonCodes.ts'
import { blobToBase64 } from '../../lib/common.ts'
import { createLogger } from '../../lib/logger.ts'
import { humanizeVoiceError } from '../../lib/humanizeError.ts'
import { createId } from '../../lib/index.ts'
import { recordSttUsage } from '../../features/metering/speechCost.ts'
import { mapSpeechError } from '../../lib/voice.ts'
import {
  API_RECORDING_MAX_DURATION_MS,
  API_RECORDING_MAX_IDLE_MS,
} from './constants.ts'
import {
  beginAsrConversation,
  createAsrSpeechClock,
  createAsrTurnEnd,
  startAsrListeningPhase,
  type AsrConversationDeps,
  type AsrTurnEndRuntime,
} from './asrRunnerCore.ts'
import type {
  VadConversationSession,
  VoiceConversationOptions,
} from './types.ts'

const log = createLogger('voice.vad')

export type StartVadConversationOptions = AsrConversationDeps & {
  transcribeMode: 'api' | 'local'
  vadSessionRef: MutableRefObject<VadConversationSession | null>
  wakewordRuntimeRef: MutableRefObject<WakewordRuntimeController | null>
  /**
   * Timestamp (ms epoch) before which VAD should suppress `speech_start`
   * callbacks. Set whenever the user just interrupted TTS — residual
   * main-process audio may reach the mic within ~200 ms of the abort
   * IPC and would otherwise be detected as a false speech onset.
   */
  voiceEchoCooldownUntilRef: MutableRefObject<number>
  resetSpeechLevel: () => void
  destroyVadSession: (session: VadConversationSession | null) => Promise<void>
  startFallbackConversation: (
    options?: VoiceConversationOptions,
  ) => Promise<void>
  busEmit?: (event: VoiceBusEvent) => void
}

/**
 * Event-driven VAD runner. It shares the core's gate/listening/turn-end
 * primitives, but owns its detector wiring and one-shot transcription.
 *
 * The MicVAD fallback runs rule-only turn end: its samples stay in the
 * renderer, so there is no main-process Smart Turn session to probe.
 */
export async function startVadConversation(
  params: StartVadConversationOptions,
) {
  const plan = beginAsrConversation(params, () => {
    if (params.transcribeMode === 'api' && !window.desktopPet?.transcribeAudio) {
      params.setContinuousVoiceSession(false)
      params.setError(params.ti('voice.provider.api.connect_required'))
      return null
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      params.setContinuousVoiceSession(false)
      params.setError(params.ti('voice.provider.vad.no_mic_input'))
      return null
    }

    return true
  })
  if (!plan) return

  // Prefer the shared-audio path: if the always-on wakeword listener is
  // live, VAD subscribes to its ScriptProcessor frames and runs Silero on
  // the same samples KWS is decoding. No second getUserMedia, no MicVAD,
  // no mic-device race with Chromium/WASAPI. Falls back to the legacy
  // MicVAD path only when the wakeword listener isn't available (e.g.,
  // manual voice start while wake word is off, or the listener is in an
  // error/retry state and has no active ScriptProcessor).
  //
  // hasActiveFrameSource() matters here: the 'paused' phase is ambiguous.
  // Paused *with* a kept-alive listener still captures frames (continuous
  // voice restarts rely on that), but paused *without* one (listener died
  // before the voice turn) used to pass this check — subscribeMicFrames()
  // then attached to nothing, mainVAD starved, and the 3s noSpeechTimer
  // silently dropped the turn. No live frame source → MicVAD path instead.
  const wakewordRuntime = params.wakewordRuntimeRef.current
  const wakewordPhase = wakewordRuntime?.getState().phase
  const useFrameDriver = Boolean(
    wakewordRuntime
    && (wakewordPhase === 'listening' || wakewordPhase === 'paused')
    && wakewordRuntime.hasActiveFrameSource(),
  )

  const baseSilenceMs = useFrameDriver
    ? getMainProcessVadSilenceMs(params.currentSettings.vadSensitivity)
    : getBrowserVadSilenceMs(params.currentSettings.vadSensitivity)
  // The main VAD reports a post-hangover `isDetected` flag, so it cannot see a
  // 250 ms pause while its 1.8 s silence window is still open. The shared mic
  // frames give us the raw RMS needed for the Smart Turn probe clock.
  const clock = createAsrSpeechClock(0)

  // Declare up front so the shared VAD event handlers below can close over
  // the session variable — TS would otherwise complain about use-before-
  // assignment inside the handlers passed into the detector/frame driver.
  let session!: VadConversationSession

  // Backchannel pacing: this path has no partial transcript, so the policy
  // only ever sees an empty string and picks the neutral listening token.
  let turnEnd: AsrTurnEndRuntime | null = null
  const stopTurnEnd = () => turnEnd?.stop()

  const handleSpeechStart = () => {
    if (params.vadSessionRef.current !== session) return
    // Echo cooldown: suppress speech_start during the short window after a
    // user barge-in, so the tail end of the aborted TTS doesn't bounce
    // back through the mic and look like user speech.
    if (Date.now() < params.voiceEchoCooldownUntilRef.current) return
    clock.markSpeech(performance.now())
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

    const now = performance.now()
    if (speechProbability >= 0.3) {
      clock.markSpeechStart(now)
      // The frame driver keeps `isDetected` high through its 1.8 s hangover;
      // its pause clock comes from the raw RMS callback instead.
      if (!useFrameDriver) clock.markLastSpeech(now)
      return
    }

    if (!session.speechDetected || clock.getSpeechStartedAt() === null) return
    // The legacy MicVAD exposes the real per-frame probability, so it can
    // drive the same controller directly.
    if (!useFrameDriver) turnEnd?.controller.tick()
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
    params.resetSpeechLevel()
  }

  const handleSpeechEnd = async (audio: Float32Array) => {
    if (params.vadSessionRef.current !== session || session.cancelled) return

    params.vadSessionRef.current = null
    params.backchannel?.stop()
    stopTurnEnd()
    if (session.noSpeechTimer) {
      window.clearTimeout(session.noSpeechTimer)
    }
    if (session.maxDurationTimer) {
      window.clearTimeout(session.maxDurationTimer)
    }
    params.resetSpeechLevel()
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
      let transcript = ''
      try {
        transcript = (
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
      } catch (cloudError) {
        // Cloud ASR failed — when the user enabled failover and the local
        // sherpa SenseVoice model is installed, retry fully offline. The VAD
        // path still holds the raw 16kHz samples, so hand them straight to the
        // one-shot local transcribe (which lazy-loads the model on first use).
        const status = params.currentSettings.speechInputFailoverEnabled
          ? await checkSenseVoiceAvailability().catch(() => null) // silent-catch-ok: availability probe failure keeps the cloud error as the fallback signal
          : null
        if (!status?.installed || !status.modelFound || !window.desktopPet?.sensevoiceTranscribe) {
          throw cloudError
        }
        params.appendVoiceTrace(
          'STT failover',
          `#${traceLabel} cloud transcription failed, falling back to local SenseVoice`,
        )
        const local = await window.desktopPet.sensevoiceTranscribe({ samples: audio, sampleRate: 16_000 })
        transcript = (local.text ?? '').trim()
      }

      await session.tearDown().catch(() => { log.debug('VAD session teardown failed', { errorPresent: true }) })

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
      await session.tearDown().catch(() => { log.debug('VAD session teardown failed', { errorPresent: true }) })

      params.handleVoiceListeningFailure(
        humanizeVoiceError(error, { ti: params.ti }),
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

        // Pause clock for Smart Turn. The main VAD's `isDetected` is already
        // held for its silence window, so the raw frame energy is the only
        // signal that can tell us the user paused 250 ms ago.
        if (!session || session.cancelled) return
        let energy = 0
        for (let i = 0; i < samples.length; i += 1) energy += samples[i] * samples[i]
        const rms = Math.sqrt(energy / samples.length)
        const now = performance.now()
        if (clock.isSpeech(rms)) {
          clock.markSpeech(now)
          return
        }
        if (session.speechDetected && clock.getSpeechStartedAt() !== null) {
          turnEnd?.controller.tick()
        }
      })

      session = {
        detector: null,
        frameDriver: mainVad,
        unsubscribeFrames: unsubscribe,
        async tearDown() {
          try { unsubscribe() } catch { /* silent-catch-ok: the frame subscription may already be detached during teardown */ }
          await mainVad.destroy().catch(() => { log.debug('main-process VAD destroy failed', { errorPresent: true }) })
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
        { maxSilenceMs: turnEndMaxSilenceMs(baseSilenceMs) },
      )

      session = {
        detector,
        frameDriver: null,
        unsubscribeFrames: null,
        async tearDown() {
          await detector.destroy().catch(() => { log.debug('browser VAD destroy failed', { errorPresent: true }) })
        },
        noSpeechTimer: null,
        maxDurationTimer: null,
        cancelled: false,
        speechDetected: false,
      }
    }

    turnEnd = createAsrTurnEnd({
      mode: useFrameDriver ? 'smart-turn' : 'rule-only',
      locale: params.currentSettings.speechRecognitionLang,
      presetSilenceMs: baseSilenceMs,
      partialTranscript: () => '',
      getSpeechStartedAt: clock.getSpeechStartedAt,
      getLastSpeechAt: clock.getLastSpeechAt,
      isFinalizing: () => params.vadSessionRef.current !== session || session.cancelled,
      onEnd: () => {
        // Both backends can emit their current utterance on demand: the main
        // VAD flushes its segment, MicVAD uses pause() with
        // submitUserSpeechOnPause. The normal speech-end path does the rest.
        if (session.detector) {
          void session.detector.pause().catch(() => { log.debug('VAD pause failed', { errorPresent: true }) })
        } else {
          void session.frameDriver?.flush()
        }
      },
      backchannel: params.backchannel,
    })

    params.vadSessionRef.current = session
    startAsrListeningPhase(params, {
      transport: params.transcribeMode === 'local' ? 'local_vad' : 'remote_vad',
      detail: () => (
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
            )
      ),
      status: () => (
        params.shouldAutoRestartVoice()
          ? params.ti('voice.status.continuous_vad_start')
          : params.ti('voice.status.vad_listening')
      ),
      order: 'pipeline-after-backchannel',
      passive: plan.passive,
    })

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
      stopTurnEnd()
      params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
    }, API_RECORDING_MAX_IDLE_MS)

    session.maxDurationTimer = window.setTimeout(() => {
      if (params.vadSessionRef.current !== session || session.cancelled) return

      if (!session.speechDetected) {
        console.warn('[VAD] destroy source: maxDurationTimer (no speech)')
        void params.destroyVadSession(session)
        stopTurnEnd()
        params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
        return
      }

      // Only the legacy MicVAD exposes a pause() that flushes the current
      // speech segment via submitUserSpeechOnPause. The frame-driver has no
      // mic of its own, but its main-process VAD can flush the in-flight
      // segment over IPC — route that through the normal speech-end path
      // (transcribe + tear down) instead of dropping a long utterance.
      if (session.detector) {
        void session.detector.pause().catch(() => { log.debug('VAD pause failed', { errorPresent: true }) })
      } else if (session.frameDriver) {
        void session.frameDriver.flush().then((flushed) => {
          if (
            flushed
            || params.vadSessionRef.current !== session
            || session.cancelled
          ) {
            return
          }
          // Nothing buffered to flush — recover state like the no-speech
          // branch so the session doesn't hang stuck in LISTENING.
          console.warn('[VAD] destroy source: maxDurationTimer (frame-driver flush empty)')
          void params.destroyVadSession(session)
          params.handleVoiceListeningFailure(mapSpeechError('no-speech'), 'no-speech')
        })
      } else {
        void params.destroyVadSession(session)
      }
    }, API_RECORDING_MAX_DURATION_MS)

    if (session.detector) {
      await session.detector.start()
    }
  } catch (error) {
    params.backchannel?.stop()
    stopTurnEnd()
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
      try { await session.tearDown() } catch { /* silent-catch-ok: VAD teardown is best-effort after the session was cancelled */ }
      if (params.vadSessionRef.current === session) {
        params.vadSessionRef.current = null
      }
    }

    params.setVoiceState('idle')
    params.setMood('idle')
    params.resetSpeechLevel()
    if (isVoiceCaptureCancelled(error)) return
    const originalMessage = humanizeVoiceError(error, { ti: params.ti })
    const fallbackMessage = params.ti('voice.provider.vad.silero_fallback')

    console.warn('[Voice] Silero VAD unavailable, falling back to legacy recording', error)
    params.updateVoicePipeline('idle', fallbackMessage)
    params.showPetStatus(fallbackMessage, 4_800, 4_500)
    params.setError(originalMessage)

    await params.startFallbackConversation(params.options)
  }
}
