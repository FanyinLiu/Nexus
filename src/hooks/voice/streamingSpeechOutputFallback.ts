/**
 * Streaming speech with a one-shot local fallback.
 *
 * Qwen3-TTS lives on this machine and can be unavailable (Python env moved,
 * model still loading, out of memory). A reply must not go silent in that
 * case: until the primary produces its first audio chunk we keep every delta,
 * and on failure replay the accumulated text through the previous provider.
 *
 * Once the primary has emitted audio we do NOT replay — the user already
 * heard part of the reply, and restarting it from the top sounds broken.
 */

import type { AppSettings, VoiceEmotionCue } from '../../types'
import { InterruptedError } from '../../features/voice/interruptedError.ts'
import {
  createStreamingSpeechOutputController,
  type StreamingSpeechOutputOptions,
  type StreamingSpeechOutputRuntime,
} from './streamingSpeechOutput.ts'
import type { StreamingSpeechOutputController } from './types.ts'
import { createLogger } from '../../lib/logger.ts'

const log = createLogger('voice.tts')

export type StreamingSpeechFallbackOptions = {
  primarySettings: AppSettings
  fallbackSettings: AppSettings
  runtime: StreamingSpeechOutputRuntime
  options?: StreamingSpeechOutputOptions
  onFallback?: () => void
}

export function createStreamingSpeechOutputWithFallback(
  input: StreamingSpeechFallbackOptions,
): StreamingSpeechOutputController {
  const { primarySettings, fallbackSettings, runtime, options, onFallback } = input

  let accumulatedText = ''
  let finished = false
  let aborted = false
  let settled = false
  let started = false
  let fallbackController: StreamingSpeechOutputController | null = null
  let resolveCompletion: (() => void) | null = null
  let rejectCompletion: ((error: Error) => void) | null = null
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve
    rejectCompletion = reject
  })

  function settleSuccess() {
    if (settled) return
    settled = true
    resolveCompletion?.()
    options?.onEnd?.()
  }

  function settleError(message: string) {
    if (settled) return
    settled = true
    options?.onError?.(message)
    rejectCompletion?.(new Error(message))
  }

  function settleAbort() {
    if (settled) return
    settled = true
    rejectCompletion?.(new InterruptedError())
  }

  const sharedCallbacks = {
    ...options,
    onStart: () => {
      if (started) return
      started = true
      options?.onStart?.()
    },
  }

  function startFallback() {
    if (fallbackController || aborted || settled) return
    onFallback?.()
    fallbackController = createStreamingSpeechOutputController(
      fallbackSettings,
      runtime,
      {
        ...sharedCallbacks,
        onEnd: settleSuccess,
        onError: settleError,
      },
    )
    void fallbackController.waitForCompletion().catch(() => { log.debug('fallback speech completion failed', { errorPresent: true }) })
    if (accumulatedText) {
      fallbackController.pushDelta(accumulatedText)
    }
    if (finished) {
      fallbackController.finish()
    }
  }

  const primaryController = createStreamingSpeechOutputController(
    primarySettings,
    runtime,
    {
      ...sharedCallbacks,
      onEnd: () => {
        if (!fallbackController) settleSuccess()
      },
      onError: (message) => {
        if (aborted || settled) return
        if (!primaryController.hasStarted()) {
          startFallback()
          return
        }
        settleError(message)
      },
    },
  )
  // The wrapper owns completion; the inner promise only needs its rejection
  // observed so a failed primary never becomes an unhandled rejection.
  void primaryController.waitForCompletion().catch(() => { log.debug('primary speech completion failed', { errorPresent: true }) })

  return {
    pushDelta(delta, cue?: VoiceEmotionCue | null) {
      if (!delta || aborted || settled) return
      accumulatedText += delta
      if (fallbackController) {
        fallbackController.pushDelta(delta, cue)
      } else {
        primaryController.pushDelta(delta, cue)
      }
    },
    flushPending() {
      if (aborted || settled) return
      ;(fallbackController ?? primaryController).flushPending()
    },
    finish() {
      if (finished || aborted || settled) return
      finished = true
      ;(fallbackController ?? primaryController).finish()
    },
    waitForCompletion() {
      return completion
    },
    hasStarted() {
      return (fallbackController ?? primaryController).hasStarted()
    },
    getSpokenText() {
      return (fallbackController ?? primaryController).getSpokenText?.() ?? ''
    },
    getInterruption() {
      return (fallbackController ?? primaryController).getInterruption?.() ?? null
    },
    wasInterrupted() {
      return aborted
    },
    abort() {
      if (aborted || settled) return
      aborted = true
      ;(fallbackController ?? primaryController).abort()
      settleAbort()
    },
  }
}
