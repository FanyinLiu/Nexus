import type { VoiceBusEvent } from '../../features/voice/busEvents'
import type { StreamAudioPlayer } from '../../features/voice/streamAudioPlayer'
import { voiceDebug } from '../../features/voice/voiceDebugLog'
import { prepareTextForTts } from '../../features/voice/text'
import { VoiceReasonCodes } from '../../features/voice/voiceReasonCodes'
import { createId } from '../../lib'
import { recordTtsUsage } from '../../features/metering/speechCost'
import type { AppSettings } from '../../types'
import {
  getMaxRequestCharsForProvider,
  splitLongTextAtSentences,
} from './speechTextSegmentation.ts'
import type { StreamingSpeechOutputController, VoiceStreamEvent } from './types'

export type StreamingSpeechOutputOptions = {
  onStart?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
  /** Phase 1-1: fire transition-log events so the voice bus can observe streaming. */
  busEmit?: (event: VoiceBusEvent) => void
  /** speechGeneration from the caller so events can correlate with tts:started/completed. */
  speechGeneration?: number
}

export type StreamingSpeechOutputRuntime = {
  getPlayer: () => StreamAudioPlayer
  setActiveController?: (controller: StreamingSpeechOutputController | null) => void
  resetPlayer?: () => void
}

export function createStreamingSpeechOutputController(
  speechSettings: AppSettings,
  runtime: StreamingSpeechOutputRuntime,
  options?: StreamingSpeechOutputOptions,
): StreamingSpeechOutputController {
  if (!window.desktopPet?.ttsStreamStart || !window.desktopPet?.subscribeTtsStream) {
    throw new Error('Desktop client is not connected in the current environment; streaming speech playback is unavailable.')
  }

  let accumulatedText = ''
  const player = runtime.getPlayer()
  // Voice cloning disabled — always use the provider's configured voice.
  const effectiveVoice = speechSettings.speechOutputVoice
  const requestId = createId('tts-stream')
  const busEmit = options?.busEmit
  const speechGeneration = options?.speechGeneration ?? 0
  const providerId = speechSettings.speechOutputProviderId
  // Hard ceiling on how long we'll wait for the first audio chunk after the
  // stream has been started. Catches providers whose socket is half-closed
  // after a long play — observed as the "text rendered but no audio on the
  // next turn" bug. Shorter than the chat-turn wait (12 s) so the upstream
  // handler can fall back to direct-speech before the user gives up.
  const FIRST_AUDIO_TIMEOUT_MS = 6_000
  let firstAudioWatchdog: ReturnType<typeof setTimeout> | null = null
  let segmentCounter = 0
  let firstAudioEmitted = false
  let started = false
  let ended = false
  let settled = false
  let aborted = false
  let finishRequested = false
  let streamStarted = false
  let startPromise: Promise<void> | null = null
  let pendingSegments = 0
  let pendingAudioAppends = 0
  let rejectAllPlayed: ((error: Error) => void) | null = null
  let resolveAllPlayed: (() => void) | null = null
  const allPlayedPromise = new Promise<void>((resolve, reject) => {
    resolveAllPlayed = resolve
    rejectAllPlayed = reject
  })

  const unsubscribe = window.desktopPet.subscribeTtsStream((event: VoiceStreamEvent) => {
    if (event.requestId !== requestId || settled || aborted) {
      return
    }

    if (event.type === 'chunk') {
      if (!started) {
        started = true
        options?.onStart?.()
      }

      if (!firstAudioEmitted) {
        firstAudioEmitted = true
        if (firstAudioWatchdog !== null) {
          clearTimeout(firstAudioWatchdog)
          firstAudioWatchdog = null
        }
        busEmit?.({
          type: 'tts:first_audio',
          speechGeneration,
          reason: VoiceReasonCodes.TTS_SEGMENT_STARTED,
          provider: providerId,
          meta: { requestId },
        })
      }

      pendingAudioAppends += 1
      void player.appendPcmChunk(event.samples, event.sampleRate, event.channels)
        .catch((error) => {
          fail(error instanceof Error ? error : new Error('Streaming audio playback failed.'))
        })
        .finally(() => {
          pendingAudioAppends = Math.max(0, pendingAudioAppends - 1)
          maybeResolve()
        })
      return
    }

    if (event.type === 'error') {
      // Request-level error from the main-process stream. We don't know
      // which segment failed — main's push_text chain is opaque — so attribute
      // it to the last-queued segment as the best guess for Phase 1-1 logs.
      const lastSegment = Math.max(0, segmentCounter - 1)
      busEmit?.({
        type: 'tts:segment_error',
        segmentIndex: lastSegment,
        speechGeneration,
        message: event.message || 'Streaming TTS synthesis failed.',
        reason: VoiceReasonCodes.TTS_SEGMENT_NETWORK_ERROR,
        provider: providerId,
        meta: { requestId, scope: 'request' },
      })
      fail(new Error(event.message || 'Streaming TTS synthesis failed.'))
      return
    }

    if (event.type === 'end') {
      // Request-level stream end. Segment-level finished events are emitted
      // inside queueSegment() when each push_text IPC resolves; this path
      // only drives the final settle.
      ended = true
      maybeResolve()
    }
  })

  function cleanup() {
    // Preload contract returns an unsubscribe function, but guard the call so a
    // future regression where the bridge returns undefined cannot throw from
    // cancel/abort paths and strand the active controller.
    if (typeof unsubscribe === 'function') unsubscribe()
    if (firstAudioWatchdog !== null) {
      clearTimeout(firstAudioWatchdog)
      firstAudioWatchdog = null
    }
    runtime.setActiveController?.(null)
  }

  function settleSuccess() {
    if (settled) {
      return
    }

    // Lifecycle-trace log — pair this with the renderer-side
    // `[Chat] TTS wait timeout` to tell "tts played fully" from "tts was
    // cut off mid-segment". `segmentsFinished < segmentCounter` at settle
    // means some push_text calls never completed.
    console.info('[TTS] controller settled (success)', {
      requestId,
      segmentsQueued: segmentCounter,
      pendingSegments,
      pendingAudioAppends,
      firstAudioEmitted,
    })
    voiceDebug('StreamingSpeechOutput', 'settleSuccess — calling onEnd')
    settled = true
    cleanup()
    resolveAllPlayed?.()
    options?.onEnd?.()
  }

  function fail(error: Error) {
    if (settled) {
      return
    }

    console.warn('[TTS] controller failed', {
      requestId,
      reason: error.message,
      segmentsQueued: segmentCounter,
      pendingSegments,
      pendingAudioAppends,
      firstAudioEmitted,
    })
    settled = true
    cleanup()
    player.stopAndClear()
    runtime.resetPlayer?.()
    options?.onError?.(error.message)
    rejectAllPlayed?.(error)
  }

  function maybeResolve() {
    if (
      !finishRequested
      || !ended
      || pendingSegments > 0
      || pendingAudioAppends > 0
    ) {
      return
    }

    player.waitForDrain().then(() => {
      if (!settled) settleSuccess()
    }).catch((error) => {
      if (!settled) fail(error instanceof Error ? error : new Error('Streaming audio playback failed.'))
    })
  }

  async function ensureStarted() {
    if (startPromise) {
      return startPromise
    }

    const desktopPet = window.desktopPet
    if (!desktopPet) {
      throw new Error('Desktop client is not connected in the current environment; streaming speech playback is unavailable.')
    }

    startPromise = desktopPet.ttsStreamStart({
      requestId,
      providerId: speechSettings.speechOutputProviderId,
      baseUrl: speechSettings.speechOutputApiBaseUrl,
      apiKey: speechSettings.speechOutputApiKey,
      model: speechSettings.speechOutputModel,
      voice: effectiveVoice,
      instructions: speechSettings.speechOutputInstructions,
      language: speechSettings.speechSynthesisLang,
      rate: speechSettings.speechRate,
      pitch: speechSettings.speechPitch,
      volume: speechSettings.speechVolume,
    }).then(() => {
      streamStarted = true
      // Arm the first-audio watchdog. If the provider never sends a chunk
      // within FIRST_AUDIO_TIMEOUT_MS we fail the controller explicitly,
      // which lets the upstream chat handler fall back to direct-speech.
      if (firstAudioWatchdog === null && !settled && !aborted) {
        firstAudioWatchdog = setTimeout(() => {
          firstAudioWatchdog = null
          if (firstAudioEmitted || settled || aborted) return
          fail(new Error('流式 TTS 超过 6 秒仍未产出音频。'))
        }, FIRST_AUDIO_TIMEOUT_MS)
      }
    })

    return startPromise
  }

  let finishSent = false

  function requestFinish() {
    if (finishSent || settled || aborted) {
      return
    }

    finishSent = true
    void ensureStarted()
      .then(() => window.desktopPet!.ttsStreamFinish({ requestId }))
      .catch((error) => {
        fail(error instanceof Error ? error : new Error('Streaming TTS finalize failed.'))
      })
      .finally(() => {
        maybeResolve()
      })
  }

  function queueSegment(segment: string) {
    const cleaned = prepareTextForTts(segment)
    if (!cleaned || settled || aborted) {
      return
    }

    const segmentIndex = segmentCounter++
    pendingSegments += 1
    busEmit?.({
      type: 'tts:segment_queued',
      segmentIndex,
      speechGeneration,
      reason: VoiceReasonCodes.TTS_SEGMENT_QUEUED,
      provider: providerId,
      meta: { requestId, length: cleaned.length },
    })
    ensureStarted()
      .then(() => window.desktopPet!.ttsStreamPushText({ requestId, text: cleaned }))
      .then(() => {
        // push_text IPC resolved — main has accepted this segment into its
        // synthesis chain. Not the same as "audio started flowing"
        // (tts:first_audio covers that), but the cleanest per-segment hook
        // we have without a protocol change.
        busEmit?.({
          type: 'tts:segment_started',
          segmentIndex,
          speechGeneration,
          reason: VoiceReasonCodes.TTS_SEGMENT_STARTED,
          provider: providerId,
          meta: { requestId },
        })
        recordTtsUsage({
          providerId: speechSettings.speechOutputProviderId,
          modelId: speechSettings.speechOutputModel,
          text: cleaned,
        })
        busEmit?.({
          type: 'tts:segment_finished',
          segmentIndex,
          speechGeneration,
          reason: VoiceReasonCodes.TTS_SEGMENT_FINISHED,
          provider: providerId,
          meta: { requestId },
        })
      })
      .catch((error) => {
        busEmit?.({
          type: 'tts:segment_error',
          segmentIndex,
          speechGeneration,
          message: error instanceof Error ? error.message : 'Streaming TTS push-text failed.',
          reason: VoiceReasonCodes.TTS_SEGMENT_NETWORK_ERROR,
          provider: providerId,
          meta: { requestId, stage: 'push_text' },
        })
        fail(error instanceof Error ? error : new Error('Streaming TTS push-text failed.'))
      })
      .finally(() => {
        pendingSegments = Math.max(0, pendingSegments - 1)
        if (finishRequested && pendingSegments === 0) {
          requestFinish()
        }
        maybeResolve()
      })
  }

  // Drain `accumulatedText` into segments. Pulled out of finish() so we can
  // flush between agent-loop rounds (pre-tool text goes first, post-tool text
  // appended after the tool result lands) without finalizing the stream.
  const flushAccumulatedText = () => {
    const fullText = accumulatedText
    accumulatedText = ''
    if (!fullText) return
    const maxChars = getMaxRequestCharsForProvider(providerId)
    const segments = splitLongTextAtSentences(fullText, maxChars)
    for (const segment of segments) {
      queueSegment(segment)
    }
  }

  const controller: StreamingSpeechOutputController = {
    pushDelta(delta: string) {
      if (!delta || settled || aborted) {
        return
      }

      // Accumulate silently until the next flush. One round of a tool-using
      // agent turn bundles into one or two TTS requests so timbre stays
      // consistent across sentences (Volcengine / MiniMax can otherwise
      // stitch chunks together with different voices).
      accumulatedText += delta
    },
    flushPending() {
      if (finishRequested || settled || aborted) {
        return
      }
      flushAccumulatedText()
    },
    finish() {
      if (finishRequested || settled || aborted) {
        return
      }

      flushAccumulatedText()

      finishRequested = true
      if (!streamStarted && pendingSegments === 0) {
        if (startPromise) {
          startPromise.then(() => {
            window.desktopPet?.ttsStreamAbort?.({ requestId })?.catch(() => {})
          }).catch(() => {})
        }
        settled = true
        cleanup()
        resolveAllPlayed?.()
        return
      }

      if (pendingSegments === 0) {
        requestFinish()
      }
    },
    waitForCompletion() {
      return allPlayedPromise
    },
    hasStarted() {
      return started
    },
    abort() {
      if (aborted || settled) {
        return
      }

      // Loudly trace every abort — this is the single most common cause
      // of "TTS got cut off mid-sentence", and knowing the call stack
      // (is it the user barging in? chat turn unblock? a stale player
      // reset?) saves several round trips when diagnosing.
      console.warn('[TTS] controller aborted', {
        requestId,
        segmentsQueued: segmentCounter,
        pendingSegments,
        pendingAudioAppends,
        firstAudioEmitted,
        stack: new Error('abort trace').stack,
      })
      aborted = true
      settled = true
      cleanup()
      player.stopAndClear()
      runtime.resetPlayer?.()
      rejectAllPlayed?.(new Error('Speech playback has been stopped.'))
      if (startPromise) {
        void startPromise
          .then(() => window.desktopPet!.ttsStreamAbort({ requestId }))
          .catch(() => undefined)
      }
    },
  }

  runtime.setActiveController?.(controller)
  return controller
}
