import type { AppSettings } from '../../types'
import {
  AudioPlayerSink,
  FrameProcessor,
  Pipeline,
  SentenceAggregator,
  TTSStreamService,
  createEndFrame,
  createInterruptionFrame,
  createStartFrame,
  createTextDeltaFrame,
  type Frame,
  type TtsIpcBridge,
} from '../../features/voice/tts-pipeline/index.ts'
import { createId } from '../../lib'
import { getMaxRequestCharsForProvider } from './speechTextSegmentation.ts'
import type {
  StreamingSpeechOutputOptions,
  StreamingSpeechOutputRuntime,
} from './streamingSpeechOutput'
import type { StreamingSpeechOutputController } from './types.ts'

/**
 * Pipeline-backed alternative to the monolithic streamingSpeechOutput
 * controller. Exposes the same StreamingSpeechOutputController surface
 * (pushDelta / flushPending / finish / abort / hasStarted /
 * waitForCompletion) so callers can't tell which path they're on, then
 * internally drives a pipecat-style pipeline of:
 *
 *   Observer → SentenceAggregator → TTSStreamService → AudioPlayerSink
 *
 * The Observer sits at the head so `hasStarted()` can track whether
 * any AudioFrame has reached playback yet.
 */
export function createPipelineStreamingSpeechController(
  speechSettings: AppSettings,
  runtime: StreamingSpeechOutputRuntime,
  options?: StreamingSpeechOutputOptions,
): StreamingSpeechOutputController {
  const bridge = window.desktopPet as unknown as TtsIpcBridge | undefined
  if (
    !bridge
    || typeof bridge.ttsStreamStart !== 'function'
    || typeof bridge.subscribeTtsStream !== 'function'
  ) {
    throw new Error('Desktop client is not connected in the current environment; streaming speech playback is unavailable.')
  }

  const turnId = createId('tts-turn')
  const player = runtime.getPlayer()
  let hasAudio = false
  let resolveCompletion: (() => void) | null = null
  let rejectCompletion: ((error: Error) => void) | null = null
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve
    rejectCompletion = reject
  })
  let finishRequested = false
  let aborted = false
  let onStartFired = false

  // Head processor: observes frames for hasStarted/onStart telemetry. It
  // forwards everything unchanged so the rest of the pipeline behaves
  // as if it were the true head.
  class HeadObserver extends FrameProcessor {
    async process(frame: Frame): Promise<void> {
      if (frame.type === 'audio' && !hasAudio) {
        hasAudio = true
        if (!onStartFired) {
          onStartFired = true
          options?.onStart?.()
        }
      }
      await this.pushDownstream(frame)
    }
  }

  const pipeline = new Pipeline([
    new HeadObserver(),
    new SentenceAggregator({
      maxSentenceChars: getMaxRequestCharsForProvider(speechSettings.speechOutputProviderId),
    }),
    new TTSStreamService({
      settings: speechSettings,
      ipc: bridge,
    }),
    new AudioPlayerSink({ getPlayer: () => player }),
  ])

  // Kick the pipeline off with a StartFrame so aggregator/service/sink
  // reset their per-turn state. Fire-and-forget; any error bubbles
  // through the TTSStreamService's ErrorFrame path rather than throwing.
  void pipeline.push(createStartFrame(turnId))

  const controller: StreamingSpeechOutputController = {
    pushDelta(delta: string) {
      if (!delta || finishRequested || aborted) return
      void pipeline.push(createTextDeltaFrame(turnId, delta))
    },

    flushPending() {
      // SentenceAggregator drains whole sentences eagerly on every
      // TextDeltaFrame, so there's nothing queued to flush between
      // tool-call rounds — the old controller needed this because it
      // buffered until finish(). No-op here preserves the API.
    },

    finish() {
      if (finishRequested || aborted) return
      finishRequested = true

      void (async () => {
        try {
          await pipeline.push(createEndFrame(turnId))
          // TTSStreamService has called ttsStreamFinish; the main
          // process drains its chain and the last chunks are on their
          // way. Wait for playback to actually finish.
          await player.waitForDrain()
          if (resolveCompletion) resolveCompletion()
          options?.onEnd?.()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (rejectCompletion) rejectCompletion(error instanceof Error ? error : new Error(message))
          options?.onError?.(message)
        } finally {
          runtime.setActiveController?.(null)
        }
      })()
    },

    abort() {
      if (aborted) return
      aborted = true
      const wasFinished = finishRequested
      finishRequested = true
      void (async () => {
        try {
          await pipeline.push(createInterruptionFrame(turnId, 'abort-requested'))
        } catch {
          // InterruptionFrame propagation should never throw; if it
          // does, the abort signal is still delivered by stop() below.
        }
        await pipeline.stop()
        runtime.resetPlayer?.()
        runtime.setActiveController?.(null)
        if (!wasFinished && rejectCompletion) {
          rejectCompletion(new Error('Speech playback has been stopped.'))
        }
      })()
    },

    hasStarted() {
      return hasAudio
    },

    waitForCompletion() {
      return completion
    },
  }

  runtime.setActiveController?.(controller)
  return controller
}

/**
 * Feature flag for the pipecat-style TTS pipeline. Phase 5 flipped the
 * default from "opt-in" to "default-on"; the legacy
 * streamingSpeechOutput controller stays available as an emergency
 * fallback. Flip via DevTools if the new path regresses:
 *
 *   localStorage.setItem('nexus:useTtsPipeline', 'false')
 *   location.reload()
 *
 * Default: true. Set to the string 'false' to explicitly opt out; any
 * other value (unset, 'true', '1') keeps the new pipeline active.
 */
export function isPipelineTtsEnabled(): boolean {
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      return window.localStorage.getItem('nexus:useTtsPipeline') !== 'false'
    }
  } catch {
    // localStorage access can throw in some sandboxed renderer contexts.
  }
  return true
}
