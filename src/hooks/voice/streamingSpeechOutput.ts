import type { VoiceBusEvent } from '../../features/voice/busEvents.ts'
import type { StreamAudioPlayer } from '../../features/voice/streamAudioPlayer.ts'
import { voiceDebug } from '../../features/voice/voiceDebugLog.ts'
import { prepareTextForTts } from '../../features/voice/text.ts'
import { VoiceReasonCodes } from '../../features/voice/voiceReasonCodes.ts'
import { createId } from '../../lib/storage.ts'
import { humanizeVoiceError } from '../../lib/humanizeError.ts'
import { recordTtsUsage } from '../../features/metering/speechCost.ts'
import {
  isNeutralSegmentStyle,
  type SegmentStyleResolver,
} from '../../features/voice/voiceEmotion.ts'
import {
  meetsMinimumSegmentWeight,
  StreamingTtsChunker,
} from '../../features/voice/streamingTts.ts'
import type {
  AppSettings,
  TranslationKey,
  TranslationParams,
  VoiceEmotionCue,
} from '../../types'

type Translator = (key: TranslationKey, params?: TranslationParams) => string
import {
  getMaxRequestCharsForProvider,
  getMaxSegmentCharsForProvider,
  prefersWholeSentenceSegments,
  splitLongTextAtSentences,
} from './speechTextSegmentation.ts'
import type { StreamingSpeechOutputController, VoiceStreamEvent } from './types.ts'

export type StreamingSpeechOutputOptions = {
  onStart?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
  /** Phase 1-1: fire transition-log events so the voice bus can observe streaming. */
  busEmit?: (event: VoiceBusEvent) => void
  /** speechGeneration from the caller so events can correlate with tts:started/completed. */
  speechGeneration?: number
  ti?: Translator
  /** Per-sentence emotion resolver; called for every queued segment. */
  resolveSegmentVoiceStyle?: SegmentStyleResolver
  /** Reply-level cue for direct-speech playback (streaming carries cues inline). */
  initialCue?: VoiceEmotionCue | null
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

  const player = runtime.getPlayer()
  // Voice cloning disabled — always use the provider's configured voice.
  const effectiveVoice = speechSettings.speechOutputVoice
  const requestId = createId('tts-stream')
  const busEmit = options?.busEmit
  const speechGeneration = options?.speechGeneration ?? 0
  const providerId = speechSettings.speechOutputProviderId

  // Text is chunked as the model streams: each completed sentence goes to the
  // provider right away, so she starts speaking on sentence one instead of
  // waiting for the whole reply. One requestId (and therefore one pinned
  // speaker) covers the entire reply.
  const maxSegmentChars = getMaxSegmentCharsForProvider(providerId)
  const wholeSentenceSegments = prefersWholeSentenceSegments(providerId)
  const chunker = new StreamingTtsChunker({
    maxChunkLength: maxSegmentChars,
    // Buffering providers wait for a sentence terminator (or the ceiling)
    // instead of splitting at a comma; streaming providers keep the early
    // split so PCM can start inside a long sentence.
    ...(wholeSentenceSegments
      ? {
          preferredEarlySplitLength: maxSegmentChars,
          minForcedChunkLength: maxSegmentChars,
        }
      : {}),
  })
  const maxRequestChars = getMaxRequestCharsForProvider(providerId)
  // A lone "嗯，" is not worth a full synthesis request: hold the first chunk
  // until the next sentence arrives — or until the stream is flushed, so a
  // short reply is never swallowed.
  let heldFirstFragment = ''
  let hasQueuedSegment = false
  // Hard ceiling on how long we'll wait for the first audio chunk after the
  // stream has been started. Catches providers whose socket is half-closed
  // after a long play — observed as the "text rendered but no audio on the
  // next turn" bug. Shorter than the chat-turn wait (12 s) so the upstream
  // handler can fall back to direct-speech before the user gives up. Local
  // Qwen3-TTS gets a longer budget because a 1.7B checkpoint generates slower
  // than real time even after warm-up.
  const FIRST_AUDIO_TIMEOUT_MS = providerId === 'qwen3-tts-local' ? 20_000 : 6_000
  let firstAudioWatchdog: ReturnType<typeof setTimeout> | null = null
  let segmentCounter = 0
  let firstAudioEmitted = false
  let started = false
  let ended = false
  let settled = false
  let aborted = false
  let finishRequested = false
  let streamStarted = false
  // A cue applies to every sentence after it until another cue arrives. The
  // reply-level cue seeds it for direct-speech playback, which has no stream
  // to carry inline tags.
  let activeCue: VoiceEmotionCue | null = options?.initialCue ?? null
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

    if (event.type === 'latency') {
      // Main-process timing marks. Dev-console only, numbers only — no reply
      // text ever leaves the stream as text.
      voiceDebug('TTS-Latency', {
        requestId,
        provider: providerId,
        firstSegmentChars: event.firstSegmentChars,
        ...event.stages,
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
    const playbackMessage = humanizeVoiceError(error, { category: 'playback', ti: options?.ti })
    options?.onError?.(playbackMessage)
    rejectAllPlayed?.(new Error(playbackMessage))
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
      characterId: speechSettings.activeCharacterProfileId,
      instructions: speechSettings.speechOutputInstructions,
      language: speechSettings.speechSynthesisLang,
      rate: speechSettings.speechRate,
      pitch: speechSettings.speechPitch,
      volume: speechSettings.speechVolume,
    }).then(() => {
      streamStarted = true
      // The watchdog is armed from the first queued segment; if the stream
      // start was still pending (local warm-up), arm it now that synthesis can
      // actually begin. It never re-arms after the first chunk, so a long
      // multi-sentence reply cannot trip it.
      if (firstSegmentQueuedAt !== null) {
        armFirstAudioWatchdog()
      }
    })

    return startPromise
  }

  let firstSegmentQueuedAt: number | null = null

  function armFirstAudioWatchdog() {
    if (firstAudioWatchdog !== null || firstAudioEmitted || settled || aborted) {
      return
    }

    firstAudioWatchdog = setTimeout(() => {
      firstAudioWatchdog = null
      if (firstAudioEmitted || settled || aborted) return
      // Still warming a local checkpoint: checkpoint load is not synthesis
      // latency, and the main process bounds it on its own. Re-arm once the
      // stream start settles instead of failing a cold local provider.
      if (!streamStarted && startPromise) {
        void startPromise.then(() => armFirstAudioWatchdog()).catch(() => undefined)
        return
      }
      fail(new Error(options?.ti?.('voice.streaming_tts.first_audio_timeout') ?? 'Streaming TTS did not produce audio within 6 seconds.'))
    }, FIRST_AUDIO_TIMEOUT_MS)
  }

  function noteFirstSegmentQueued() {
    if (firstSegmentQueuedAt !== null) {
      return
    }
    firstSegmentQueuedAt = Date.now()
    if (streamStarted) {
      armFirstAudioWatchdog()
    }
  }

  let finishSent = false

  function requestFinish() {
    if (finishSent || settled || aborted) {
      return
    }

    finishSent = true
    void ensureStarted()
      .then(() => {
        // Re-check after the stream-start await: abort() or another finish
        // path may have fired while ensureStarted was pending. Without this
        // guard the main-process request-id state machine sees a stray
        // ttsStreamFinish after the abort it already processed.
        if (settled || aborted) return
        return window.desktopPet!.ttsStreamFinish({ requestId })
      })
      .catch((error) => {
        fail(error instanceof Error ? error : new Error('Streaming TTS finalize failed.'))
      })
      .finally(() => {
        maybeResolve()
      })
  }

  function queueSegment(segment: string): boolean {
    const cleaned = prepareTextForTts(segment)
    if (!cleaned || settled || aborted) {
      return false
    }

    // Resolve from the RAW sentence: prepareTextForTts strips terminal
    // punctuation, which is exactly what the ？/！/… heuristic reads. The live
    // getters are called per sentence — not once at stream start. Neutral
    // styles stay local instead of crossing IPC.
    const resolvedStyle = options?.resolveSegmentVoiceStyle?.(segment.trim(), activeCue)
    const style = resolvedStyle && !isNeutralSegmentStyle(resolvedStyle)
      ? resolvedStyle
      : undefined

    const segmentIndex = segmentCounter++
    pendingSegments += 1
    noteFirstSegmentQueued()
    busEmit?.({
      type: 'tts:segment_queued',
      segmentIndex,
      speechGeneration,
      reason: VoiceReasonCodes.TTS_SEGMENT_QUEUED,
      provider: providerId,
      meta: { requestId, length: cleaned.length },
    })
    ensureStarted()
      .then(() => window.desktopPet!.ttsStreamPushText({ requestId, text: cleaned, style }))
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
    return true
  }

  /**
   * Push one completed chunk (usually one sentence) toward the provider,
   * merging a too-short FIRST chunk with the next one so the reply's first
   * request is not a single "嗯，". `force` bypasses the merge for flush/finish.
   */
  function queueChunkText(rawChunk: string, force: boolean) {
    const text = heldFirstFragment ? `${heldFirstFragment}${rawChunk}` : rawChunk
    heldFirstFragment = ''

    if (!text) {
      return
    }

    if (!hasQueuedSegment && !force && !meetsMinimumSegmentWeight(text)) {
      heldFirstFragment = text
      return
    }

    // One push_text per sentence: Qwen3 applies a single `instructions` to the
    // whole request, so batching sentences would flatten them onto one tone.
    // Long single sentences still split by the provider's length ceiling.
    for (const segment of splitLongTextAtSentences(text, maxRequestChars)) {
      if (queueSegment(segment)) {
        hasQueuedSegment = true
      }
    }
  }

  // Drain the chunker into segments. Pulled out of finish() so we can flush
  // between agent-loop rounds (pre-tool text goes first, post-tool text
  // appended after the tool result lands) without finalizing the stream.
  function flushChunker() {
    for (const chunk of chunker.flush()) {
      queueChunkText(chunk, true)
    }
    if (heldFirstFragment) {
      queueChunkText('', true)
    }
  }

  const controller: StreamingSpeechOutputController = {
    pushDelta(delta: string, cue?: VoiceEmotionCue | null) {
      if (!delta || finishRequested || settled || aborted) {
        return
      }

      if (cue) {
        activeCue = cue
      }

      // Feed the streaming chunker: every sentence it completes is queued for
      // synthesis immediately, so playback overlaps the rest of the reply.
      for (const chunk of chunker.pushText(delta)) {
        queueChunkText(chunk, false)
      }
    },
    flushPending() {
      if (finishRequested || settled || aborted) {
        return
      }
      flushChunker()
    },
    finish() {
      if (finishRequested || settled || aborted) {
        return
      }

      flushChunker()

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
        // Without this, callers awaiting `tts:completed` (voiceSessionMachine
        // moves SPEAKING → IDLE on that event) hang forever whenever the
        // stream is finished before any text arrived — the caller has no
        // signal that the controller is done. The other settle paths
        // (settleSuccess / fail) already emit; this branch was an oversight.
        options?.onEnd?.()
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
