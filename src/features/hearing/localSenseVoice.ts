/**
 * Renderer-side bridge for SenseVoice offline ASR running in the Electron
 * main process. Captures audio via ScriptProcessor, accumulates it in the
 * main process, and transcribes in one shot when the user finishes speaking.
 *
 * SenseVoice is non-streaming (OfflineRecognizer), so there are no partial
 * results during recording. The final transcription happens at stop() and
 * is extremely fast (~70ms for 10s of audio).
 */

import { requestVoiceInputStream } from '../voice/runtimeSupport.ts'
import { humanizeVoiceError } from '../../lib/humanizeError.ts'
import { createLogger } from '../../lib/logger.ts'
import type { TranslationKey, TranslationParams, VoiceEmotionLabel } from '../../types'

type Translator = (key: TranslationKey, params?: TranslationParams) => string

const log = createLogger('voice.asr')

const SAMPLE_RATE = 16000
const SCRIPT_PROCESSOR_BUFFER_SIZE = 1024

export type SenseVoiceStreamCallbacks = {
  onActivity?: (rms: number) => void
  onError?: (message: string) => void
}

export type SenseVoiceStreamStopResult = {
  text: string
  audioSamples: Float32Array | null
  sampleRate: number
  /**
   * Prosody-based emotion label parsed from SenseVoice's inline tag (e.g.
   * `<|HAPPY|>`). `null` when the model emitted NEUTRAL / EMO_UNKNOWN or
   * no tag at all — consumers feed this into emotionResonance only when
   * non-null so a misread doesn't shove the model.
   */
  voiceEmotion: VoiceEmotionLabel | null
}

export type SenseVoiceTranscript = {
  text: string
  voiceEmotion: VoiceEmotionLabel | null
}

export type SenseVoiceStreamSession = {
  /**
   * Stop capture and recognize the final buffer. Pass `reuseTranscript` when a
   * speculative decode already covered an unchanged utterance; the streaming
   * buffer is then aborted instead of decoded a second time.
   */
  stop: (options?: { reuseTranscript?: SenseVoiceTranscript }) => Promise<SenseVoiceStreamStopResult>
  abort: () => void
  /** Copy of the current in-memory utterance, or null before any audio. */
  snapshotAudio: () => { samples: Float32Array; sampleRate: number } | null
  /** One-shot recognition of a snapshot without consuming the stream buffer. */
  transcribeSamples: (samples: Float32Array, sampleRate: number) => Promise<SenseVoiceTranscript>
}

function createInputAudioContext(sampleRate?: number) {
  try {
    return sampleRate
      ? new AudioContext({ sampleRate })
      : new AudioContext()
  } catch {
    return new AudioContext()
  }
}

export async function startSenseVoiceStream(
  callbacks: SenseVoiceStreamCallbacks,
  ti?: Translator,
): Promise<SenseVoiceStreamSession> {
  const desktopPet = window.desktopPet
  if (
    !desktopPet?.sensevoiceStart
    || !desktopPet.sensevoiceFeed
    || !desktopPet.sensevoiceFinish
    || !desktopPet.sensevoiceAbort
  ) {
    throw new Error(ti?.('voice.provider.sensevoice.connect_required') ?? 'SenseVoice offline recognition is not available.')
  }
  const api = desktopPet

  // Start mic capture
  const microphone = await requestVoiceInputStream({
    preferredSampleRate: SAMPLE_RATE,
    purpose: 'stt',
  })
  const stream = microphone.stream

  const audioContext = createInputAudioContext(SAMPLE_RATE)
  await audioContext.resume().catch(() => { log.debug('audio context resume failed', { errorPresent: true }) })

  const sourceNode = audioContext.createMediaStreamSource(stream)
  const processorNode = audioContext.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 1, 1)
  const outputNode = audioContext.createGain()
  outputNode.gain.value = 0

  sourceNode.connect(processorNode)
  processorNode.connect(outputNode)
  outputNode.connect(audioContext.destination)

  // Buffer audio that arrives before sensevoice is ready
  let sensevoiceReady = false
  const earlyBuffer: Float32Array[] = []
  const MAX_EARLY_BUFFER_SIZE = 16000 * 10

  processorNode.onaudioprocess = (event) => {
    const channelData = event.inputBuffer.getChannelData(0)
    if (!channelData.length) return
    const samples = new Float32Array(channelData)
    if (!sensevoiceReady) {
      const currentSize = earlyBuffer.reduce((sum, chunk) => sum + chunk.length, 0)
      if (currentSize < MAX_EARLY_BUFFER_SIZE) {
        earlyBuffer.push(samples)
      }
    }
    let energy = 0
    for (const sample of samples) energy += sample * sample
    callbacks.onActivity?.(Math.sqrt(energy / samples.length))
  }

  // Initialize SenseVoice recognizer
  try {
    await api.sensevoiceStart()
  } catch (error) {
    processorNode.onaudioprocess = null
    try { sourceNode.disconnect() } catch { log.debug('source node disconnect failed', { errorPresent: true }) }
    try { processorNode.disconnect() } catch { log.debug('processor node disconnect failed', { errorPresent: true }) }
    try { outputNode.disconnect() } catch { log.debug('output node disconnect failed', { errorPresent: true }) }
    stream.getTracks().forEach((track) => track.stop())
    void audioContext.close().catch(() => { log.debug('audio context close failed', { errorPresent: true }) })
    throw error
  }

  sensevoiceReady = true

  let audioDisposed = false
  let destroyed = false
  let finalizing = false
  let pushChain = Promise.resolve()
  const recordedChunks: Float32Array[] = []
  let recordedLength = 0

  // Feed buffered audio captured during init
  for (const buffered of earlyBuffer) {
    recordedChunks.push(buffered)
    recordedLength += buffered.length
    pushChain = pushChain.then(async () => {
      if (destroyed || finalizing) return
      try {
        await api.sensevoiceFeed({ samples: buffered })
      } catch (error) {
        fail(error)
      }
    })
  }
  earlyBuffer.length = 0

  function buildRecordedAudioSamples() {
    if (!recordedChunks.length || recordedLength <= 0) return null
    const combined = new Float32Array(recordedLength)
    let offset = 0
    for (const chunk of recordedChunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }
    return combined
  }

  function teardownAudioGraph() {
    if (audioDisposed) return
    audioDisposed = true
    processorNode.onaudioprocess = null
    try { sourceNode.disconnect() } catch { log.debug('source node disconnect failed', { errorPresent: true }) }
    try { processorNode.disconnect() } catch { log.debug('processor node disconnect failed', { errorPresent: true }) }
    try { outputNode.disconnect() } catch { log.debug('output node disconnect failed', { errorPresent: true }) }
    stream.getTracks().forEach((track) => track.stop())
    void audioContext.close().catch(() => { log.debug('audio context close failed', { errorPresent: true }) })
  }

  function fail(error: unknown) {
    if (destroyed) return
    destroyed = true
    finalizing = true
    teardownAudioGraph()
    api.sensevoiceAbort().catch(() => { log.debug('sensevoice abort failed', { errorPresent: true }) })
    callbacks.onError?.(humanizeVoiceError(error, { ti }))
  }

  // Live audio handler
  processorNode.onaudioprocess = (event) => {
    if (destroyed || finalizing) return
    const channelData = event.inputBuffer.getChannelData(0)
    if (!channelData.length) return

    const samples = new Float32Array(channelData)
    recordedChunks.push(samples)
    recordedLength += samples.length

    let energy = 0
    for (const sample of samples) energy += sample * sample
    callbacks.onActivity?.(Math.sqrt(energy / samples.length))

    pushChain = pushChain.catch(() => undefined).then(async () => { // silent-catch-ok: feed failures are reported by fail(); this keeps the chain alive
      if (destroyed || finalizing) return
      try {
        await api.sensevoiceFeed({ samples })
      } catch (error) {
        fail(error)
      }
    })
  }

  function snapshotAudio() {
    const samples = buildRecordedAudioSamples()
    return samples ? { samples, sampleRate: audioContext.sampleRate } : null
  }

  async function transcribeSamples(
    samples: Float32Array,
    sampleRate: number,
  ): Promise<SenseVoiceTranscript> {
    if (!api.sensevoiceTranscribe || !samples.length) {
      return { text: '', voiceEmotion: null }
    }
    const result = await api.sensevoiceTranscribe({ samples, sampleRate })
    return {
      text: (result.text || '').trim(),
      voiceEmotion: result.voiceEmotion ?? null,
    }
  }

  return {
    async stop(options = {}) {
      const reuse = options.reuseTranscript
      if (destroyed) {
        return {
          text: reuse?.text ?? '',
          audioSamples: buildRecordedAudioSamples(),
          sampleRate: audioContext.sampleRate,
          voiceEmotion: reuse?.voiceEmotion ?? null,
        }
      }

      finalizing = true
      teardownAudioGraph()
      await pushChain.catch(() => undefined) // silent-catch-ok: pending feed failures are already reported by fail()

      let text = reuse?.text ?? ''
      let voiceEmotion = reuse?.voiceEmotion ?? null
      try {
        if (reuse) {
          // The speculative decode already covered this utterance; drop the
          // streaming buffer instead of running recognition after stop.
          await api.sensevoiceAbort().catch(() => { log.debug('sensevoice abort failed', { errorPresent: true }) })
        } else {
          const result = await api.sensevoiceFinish()
          text = (result.text || '').trim()
          voiceEmotion = result.voiceEmotion ?? null
        }
      } catch {
        // Fall through with empty text, but leave a diagnostic trail.
        log.warn('sensevoice finish failed', { errorPresent: true })
      } finally {
        destroyed = true
      }

      return {
        text,
        audioSamples: buildRecordedAudioSamples(),
        sampleRate: audioContext.sampleRate,
        voiceEmotion,
      }
    },

    abort() {
      if (destroyed) return
      destroyed = true
      finalizing = true
      teardownAudioGraph()
      api.sensevoiceAbort().catch(() => { log.debug('sensevoice abort failed', { errorPresent: true }) })
    },

    snapshotAudio,
    transcribeSamples,
  }
}

export async function checkSenseVoiceAvailability() {
  if (!window.desktopPet?.sensevoiceStatus) {
    return { installed: false, modelFound: false, modelsDir: '' }
  }
  return window.desktopPet.sensevoiceStatus()
}
