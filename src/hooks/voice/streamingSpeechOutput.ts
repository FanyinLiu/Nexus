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
    unsubscribe()
    runtime.setActiveController?.(null)
  }

  function settleSuccess() {
    if (settled) {
      return
    }

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

  const controller: StreamingSpeechOutputController = {
    pushDelta(delta: string) {
      if (!delta || settled || aborted) {
        return
      }

      // Accumulate silently — no synthesis until finish(). This guarantees
      // the whole reply becomes a single TTS request (or, for very long
      // replies, a small number of sentence-boundary-split requests), so
      // timbre stays consistent across the entire utterance.
      accumulatedText += delta
    },
    finish() {
      if (finishRequested || settled || aborted) {
        return
      }

      const fullText = accumulatedText
      accumulatedText = ''
      if (fullText) {
        const maxChars = getMaxRequestCharsForProvider(providerId)
        const segments = splitLongTextAtSentences(fullText, maxChars)
        for (const segment of segments) {
          queueSegment(segment)
        }
      }

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
