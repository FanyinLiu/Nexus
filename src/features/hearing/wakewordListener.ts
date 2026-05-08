/**
 * Always-on wake word listener using sherpa-onnx KeywordSpotter.
 *
 * Captures microphone audio in the renderer process via ScriptProcessor,
 * sends chunks to the main process KWS engine via IPC, and fires a callback
 * when a wake keyword is detected.
 */

import { requestVoiceInputStream } from '../voice/runtimeSupport.ts'
import type { TranslationKey, TranslationParams } from '../../types'

type Translator = (key: TranslationKey, params?: TranslationParams) => string

const KWS_SAMPLE_RATE = 16000
const KWS_BUFFER_SIZE = 2048

export type WakewordListenerCallbacks = {
  onKeywordDetected: (keyword: string) => void
  onError?: (message: string) => void
  onStatusChange?: (active: boolean) => void
}

export type WakewordListenerOptions = {
  wakeWord?: string
  ti?: Translator
  requestInputStream?: typeof requestVoiceInputStream
  AudioContextCtor?: typeof AudioContext
}

export type WakewordFrameSubscriber = (samples: Float32Array, sampleRate: number) => void

export type WakewordListener = {
  stop: () => void
  // Subscribe to the raw audio frames the wakeword ScriptProcessor is
  // capturing. VAD sessions use this to consume the same underlying Windows
  // capture without opening a second getUserMedia (which Chromium silences
  // on Windows because of WASAPI exclusivity). Returns an unsubscribe fn.
  subscribeFrames: (subscriber: WakewordFrameSubscriber) => () => void
}

export async function startWakewordListener(
  callbacks: WakewordListenerCallbacks,
  options: WakewordListenerOptions = {},
): Promise<WakewordListener> {
  const api = window.desktopPet
  if (!api?.kwsStart || !api.kwsFeed || !api.kwsStop) {
    throw new Error(options.ti?.('voice.wakeword.not_supported') ?? 'The current environment does not support wake-word detection.')
  }
  const wakewordApi = api

  const wakeWord = options.wakeWord?.trim() || ''
  const requestInputStream = options.requestInputStream ?? requestVoiceInputStream
  const AudioContextCtor = options.AudioContextCtor ?? AudioContext
  await wakewordApi.kwsStart({ wakeWord })
  callbacks.onStatusChange?.(true)

  let stream: MediaStream | null = null
  let audioContext: AudioContext | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let processor: ScriptProcessorNode | null = null
  let output: GainNode | null = null
  let destroyed = false
  let feedInflight = false

  const frameSubscribers = new Set<WakewordFrameSubscriber>()

  const handleProcessorFrame = (event: AudioProcessingEvent) => {
    if (destroyed) return

    const channelData = event.inputBuffer.getChannelData(0)
    if (!channelData.length) return

    const samples = new Float32Array(channelData)
    const ctxSampleRate = audioContext?.sampleRate ?? KWS_SAMPLE_RATE

    // Broadcast to any registered subscribers (e.g. the VAD frame driver
    // during a voice session). Subscribers read the same underlying capture
    // KWS is feeding from, so there's no second getUserMedia and no way for
    // Chromium/WASAPI to silence one of the consumers.
    if (frameSubscribers.size > 0) {
      for (const subscriber of frameSubscribers) {
        try {
          subscriber(samples, ctxSampleRate)
        } catch (error) {
          console.warn('[Wake] frame subscriber error:', error)
        }
      }
    }

    // Fire-and-forget with an inflight guard. Unlike the old unbounded
    // promise chain, this drops frames when IPC is backed up instead of
    // queuing millions of microtasks over multi-hour sessions.
    if (feedInflight) return
    feedInflight = true
    void (async () => {
      try {
        const result = await wakewordApi.kwsFeed({
          samples,
          sampleRate: ctxSampleRate,
        })

        if (result?.keyword && !destroyed) {
          callbacks.onKeywordDetected(result.keyword)
        }
      } catch (error) {
        if (!destroyed) {
          callbacks.onError?.(error instanceof Error ? error.message : (options.ti?.('voice.wakeword.detection_error') ?? 'Wake-word detection error.'))
        }
      } finally {
        feedInflight = false
      }
    })()
  }

  async function acquireMicAndWire() {
    const microphone = await requestInputStream({
      preferredSampleRate: KWS_SAMPLE_RATE,
      purpose: 'wakeword',
    })
    if (destroyed) {
      microphone.stream.getTracks().forEach((track) => track.stop())
      throw new Error('Wakeword listener was destroyed during microphone acquisition.')
    }
    stream = microphone.stream

    // Monitor the mic track — on Windows the OS can silently kill it when
    // the user unplugs a device, switches default recording device, or
    // resumes from sleep. Without this listener the ScriptProcessor keeps
    // running on silence and KWS never fires again.
    const track = stream.getAudioTracks()[0]
    if (track) {
      track.onended = () => {
        if (!destroyed) {
          callbacks.onError?.('Microphone track ended unexpectedly — triggering recovery.')
        }
      }
    }

    audioContext = new AudioContextCtor({ sampleRate: KWS_SAMPLE_RATE })
    await audioContext.resume().catch(() => undefined)

    // Auto-resume if Chromium suspends the context (background tab
    // throttling, system audio service restart, power-save mode, etc.).
    audioContext.onstatechange = () => {
      if (audioContext?.state === 'suspended' && !destroyed) {
        void audioContext.resume().catch(() => undefined)
      }
    }

    if (destroyed) {
      stream.getTracks().forEach((t) => t.stop())
      void audioContext.close().catch(() => undefined)
      throw new Error('Wakeword listener was destroyed during audio context setup.')
    }

    source = audioContext.createMediaStreamSource(stream)
    processor = audioContext.createScriptProcessor(KWS_BUFFER_SIZE, 1, 1)
    output = audioContext.createGain()
    output.gain.value = 0

    source.connect(processor)
    processor.connect(output)
    output.connect(audioContext.destination)
    processor.onaudioprocess = handleProcessorFrame
  }

  try {
    await acquireMicAndWire()
  } catch (error) {
    callbacks.onStatusChange?.(false)
    wakewordApi.kwsStop().catch(() => undefined)
    throw error
  }

  function teardown() {
    if (destroyed) return
    destroyed = true
    if (processor) {
      processor.onaudioprocess = null
      try { processor.disconnect() } catch { /* no-op */ }
      processor = null
    }
    if (source) {
      try { source.disconnect() } catch { /* no-op */ }
      source = null
    }
    if (output) {
      try { output.disconnect() } catch { /* no-op */ }
      output = null
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      stream = null
    }
    if (audioContext) {
      void audioContext.close().catch(() => undefined)
      audioContext = null
    }
    wakewordApi.kwsStop().catch(() => undefined)
    callbacks.onStatusChange?.(false)
  }

  return {
    stop: teardown,
    subscribeFrames(subscriber) {
      if (destroyed) return () => undefined
      frameSubscribers.add(subscriber)
      return () => {
        frameSubscribers.delete(subscriber)
      }
    },
  }
}

export async function checkWakewordAvailability(
  options: WakewordListenerOptions = {},
): Promise<{
  installed: boolean
  modelFound: boolean
  active: boolean
  reason?: string
  modelKind?: 'zh' | 'en' | null
}> {
  const api = window.desktopPet
  if (!api?.kwsStatus) {
    return { installed: false, modelFound: false, active: false }
  }

  return api.kwsStatus({ wakeWord: options.wakeWord?.trim() || '' })
}
