import type { VadSensitivity } from '../../types'
import { requestVoiceInputStream } from '../voice/runtimeSupport.ts'

type VadModule = typeof import('@ricky0123/vad-web')
type MicVadInstance = Awaited<ReturnType<VadModule['MicVAD']['new']>>

// ── VAD speech probability shared state ─────────────────────────────────────
const VAD_GATE_THRESHOLD = 0.3
const VAD_GATE_HOLDOVER_MS = 2000

let _lastVadProb = 0
let _lastSpeechTs = 0
let vadModulePromise: Promise<VadModule> | null = null

export function getVadSpeechProb(): number {
  return _lastVadProb
}

export function isVadSpeechActive(): boolean {
  return _lastVadProb >= VAD_GATE_THRESHOLD || (Date.now() - _lastSpeechTs) < VAD_GATE_HOLDOVER_MS
}

type VoiceActivityDetectorCallbacks = {
  onSpeechStart?: () => void
  onSpeechRealStart?: () => void
  onSpeechEnd: (audio: Float32Array) => void | Promise<void>
  onMisfire?: () => void
  onFrameProcessed?: (speechProbability: number) => void
}

export type VoiceActivityDetector = {
  start: () => Promise<void>
  pause: () => Promise<void>
  destroy: () => Promise<void>
}

type VadPreset = {
  positiveSpeechThreshold: number
  negativeSpeechThreshold: number
  redemptionMs: number
  preSpeechPadMs: number
  minSpeechMs: number
}

const VAD_PRESETS: Record<VadSensitivity, VadPreset> = {
  low: {
    positiveSpeechThreshold: 0.75,
    negativeSpeechThreshold: 0.45,
    redemptionMs: 420,
    preSpeechPadMs: 280,
    minSpeechMs: 360,
  },
  medium: {
    positiveSpeechThreshold: 0.62,
    negativeSpeechThreshold: 0.38,
    redemptionMs: 560,
    preSpeechPadMs: 360,
    minSpeechMs: 240,
  },
  high: {
    positiveSpeechThreshold: 0.48,
    negativeSpeechThreshold: 0.28,
    redemptionMs: 720,
    preSpeechPadMs: 480,
    minSpeechMs: 180,
  },
}

function resolvePublicAssetPath(relativePath: string) {
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href)
  return new URL(relativePath.replace(/^\.\//, ''), baseUrl).toString()
}

function shouldFallbackToScriptProcessor(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.toLowerCase()
  return (
    message.includes('worklet')
    || message.includes('audioworklet')
    || message.includes('unable to load a worklet')
  )
}

async function getVadModule() {
  if (!vadModulePromise) {
    vadModulePromise = import('@ricky0123/vad-web')
  }

  return vadModulePromise
}

export async function createVoiceActivityDetector(
  callbacks: VoiceActivityDetectorCallbacks,
  sensitivity: VadSensitivity = 'medium',
  options: { sharedStream?: MediaStream } = {},
): Promise<VoiceActivityDetector> {
  const preset = VAD_PRESETS[sensitivity]
  const sharedStream = options.sharedStream ?? null
  const createDetector = async (processorType: 'auto' | 'ScriptProcessor'): Promise<MicVadInstance> => {
    const { MicVAD } = await getVadModule()

    return MicVAD.new({
      model: 'v5',
      startOnLoad: false,
      processorType,
      positiveSpeechThreshold: preset.positiveSpeechThreshold,
      negativeSpeechThreshold: preset.negativeSpeechThreshold,
      redemptionMs: preset.redemptionMs,
      preSpeechPadMs: preset.preSpeechPadMs,
      minSpeechMs: preset.minSpeechMs,
      submitUserSpeechOnPause: true,
      baseAssetPath: resolvePublicAssetPath('vendor/vad/'),
      onnxWASMBasePath: resolvePublicAssetPath('vendor/ort/'),
      getStream: async () => {
        if (sharedStream) {
          // Clone the wake word's mic stream instead of calling getUserMedia
          // again. Both the wake word KWS feed and VAD end up reading from
          // the same underlying Windows capture, so there is no race on
          // WASAPI releasing / re-grabbing the device — the kind of race
          // that caused VAD to get silent audio after a getUserMedia retry.
          return sharedStream.clone()
        }
        const { stream } = await requestVoiceInputStream({ purpose: 'vad' })
        return stream
      },
      pauseStream: async (stream: MediaStream) => {
        // When we own the stream, stop its tracks. When the stream is a clone
        // of the shared wake word capture, don't stop the underlying tracks —
        // that would also kill the wake word listener. Disconnecting the
        // MediaStreamAudioSourceNode inside vad-web's destroy is already
        // enough to detach us from the pipeline.
        if (!sharedStream) {
          stream.getTracks().forEach((track) => track.stop())
        }
      },
      resumeStream: async (stream: MediaStream) => {
        if (stream.active) {
          return stream
        }
        if (sharedStream) {
          return sharedStream.clone()
        }

        const { stream: nextStream } = await requestVoiceInputStream({ purpose: 'vad' })
        return nextStream
      },
      onSpeechStart: () => callbacks.onSpeechStart?.(),
      onSpeechRealStart: () => callbacks.onSpeechRealStart?.(),
      onSpeechEnd: (audio) => callbacks.onSpeechEnd(audio),
      onVADMisfire: () => callbacks.onMisfire?.(),
      onFrameProcessed: (probabilities) => {
        _lastVadProb = probabilities.isSpeech
        if (_lastVadProb >= VAD_GATE_THRESHOLD) _lastSpeechTs = Date.now()
        callbacks.onFrameProcessed?.(probabilities.isSpeech)
      },
    })
  }
  let detector: MicVadInstance

  try {
    detector = await createDetector('auto')
  } catch (error) {
    if (!shouldFallbackToScriptProcessor(error)) {
      throw error
    }

    console.warn('[Voice] AudioWorklet VAD unavailable, retrying with ScriptProcessor', error)
    detector = await createDetector('ScriptProcessor')
  }

  return {
    start: () => detector.start(),
    pause: () => detector.pause(),
    destroy: () => detector.destroy(),
  }
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

function toPcm16Sample(value: number) {
  const clamped = Math.max(-1, Math.min(1, value))
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
}

export function encodeVadAudioToWavBlob(audio: Float32Array, sampleRate = 16_000) {
  const blockAlign = 2
  const byteRate = sampleRate * blockAlign
  const dataSize = audio.length * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  for (let index = 0; index < audio.length; index += 1) {
    view.setInt16(44 + index * blockAlign, toPcm16Sample(audio[index]), true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}
