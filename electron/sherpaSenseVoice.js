/**
 * SenseVoice offline ASR service for Electron main process.
 *
 * Uses sherpa-onnx OfflineRecognizer with the SenseVoice-Small model.
 * Audio is accumulated during recording and processed in one shot when
 * the user finishes speaking — extremely fast (70ms for 10s audio).
 */

import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { findModelDir, getPrimaryModelsDir } from './services/modelPaths.js'

let sherpa = null
try {
  const require = createRequire(import.meta.url)
  sherpa = require('sherpa-onnx-node')
} catch {
  console.warn('[SenseVoice] sherpa-onnx-node not available')
}

const SAMPLE_RATE = 16000

// SenseVoice emits inline tags like `<|zh|><|HAPPY|><|Speech|><|woitn|>...`.
// We strip every tag from the user-facing text but first capture the
// emotion tag so downstream layers can feed it into the emotion model.
// The model's documented label set is HAPPY / SAD / ANGRY / NEUTRAL /
// FEARFUL / DISGUSTED / SURPRISED / EMO_UNKNOWN. NEUTRAL and EMO_UNKNOWN
// don't carry useful signal — return null so the caller skips them.
const SENSEVOICE_EMOTION_TAG_PATTERN = /<\|(HAPPY|SAD|ANGRY|FEARFUL|DISGUSTED|SURPRISED|NEUTRAL|EMO_UNKNOWN)\|>/i
const VOICE_EMOTION_BY_TAG = {
  HAPPY: 'happy',
  SAD: 'sad',
  ANGRY: 'angry',
  FEARFUL: 'fearful',
  DISGUSTED: 'disgusted',
  SURPRISED: 'surprised',
  NEUTRAL: null,
  EMO_UNKNOWN: null,
}

function parseSenseVoiceOutput(raw) {
  if (!raw) return { text: '', voiceEmotion: null }
  let voiceEmotion = null
  const match = SENSEVOICE_EMOTION_TAG_PATTERN.exec(raw)
  if (match) {
    voiceEmotion = VOICE_EMOTION_BY_TAG[match[1].toUpperCase()] ?? null
  }
  const text = raw.replace(/<\|[^|]*\|>/g, '').trim()
  return { text, voiceEmotion }
}

// SenseVoice model directory candidates
const SENSEVOICE_CANDIDATES = [
  {
    id: 'sensevoice-zh-en-ja-ko-yue',
    directory: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
    files: {
      model: 'model.int8.onnx',
      tokens: 'tokens.txt',
    },
  },
  {
    // Legacy directory name (backward compatibility)
    id: 'sensevoice-zh-en',
    directory: 'sherpa-onnx-sense-voice-zh-en-2024-07-17',
    files: {
      model: 'model.int8.onnx',
      tokens: 'tokens.txt',
    },
  },
  {
    id: 'sensevoice-small',
    directory: 'sensevoice-small',
    files: {
      model: 'model.int8.onnx',
      tokens: 'tokens.txt',
    },
  },
]

class SherpaSenseVoiceService {
  constructor() {
    this.recognizer = null
    this.initialized = false
    this.activeModelId = null
    this._audioBuffer = []
    this._totalSamples = 0
  }

  isAvailable() {
    if (!sherpa) return false
    return this._findModel() !== null
  }

  getStatus() {
    const model = this._findModel()
    return {
      installed: sherpa !== null,
      modelFound: model !== null,
      modelsDir: getPrimaryModelsDir(),
      currentModelId: this.activeModelId,
    }
  }

  _findModel() {
    for (const candidate of SENSEVOICE_CANDIDATES) {
      const dir = findModelDir(candidate.directory)
      if (!dir) continue
      const allExist = Object.values(candidate.files).every(f =>
        fs.existsSync(path.join(dir, f)),
      )
      if (allExist) return { ...candidate, dir }
    }
    return null
  }

  init() {
    if (this.initialized && this.recognizer) return true
    if (!sherpa) return false

    const model = this._findModel()
    if (!model) return false

    try {
      const config = {
        featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
        modelConfig: {
          senseVoice: {
            model: path.join(model.dir, model.files.model),
            useInverseTextNormalization: 1,
          },
          tokens: path.join(model.dir, model.files.tokens),
          numThreads: 2,
          debug: 0,
          provider: 'cpu',
        },
      }

      this.recognizer = new sherpa.OfflineRecognizer(config)
      this.initialized = true
      this.activeModelId = model.id
      console.info('[SenseVoice] Recognizer initialized with', model.id)
      return true
    } catch (error) {
      console.error('[SenseVoice] Init failed:', error)
      this.recognizer = null
      this.initialized = false
      return false
    }
  }

  /** Start accumulating audio for a new utterance. */
  startStream() {
    if (!this.init()) return false
    this._audioBuffer = []
    this._totalSamples = 0
    return true
  }

  /** Feed audio samples (accumulates internally). Returns null — no partial results for offline model. */
  feedAudio(samples, _sampleRate = SAMPLE_RATE) {
    if (!this.recognizer) return null
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    this._audioBuffer.push(float32)
    this._totalSamples += float32.length
    return null
  }

  /** Process all accumulated audio and return final text + voice emotion. */
  finishStream() {
    if (!this.recognizer || !this._audioBuffer.length) return { text: '', voiceEmotion: null }

    // Concatenate all audio chunks
    const fullAudio = new Float32Array(this._totalSamples)
    let offset = 0
    for (const chunk of this._audioBuffer) {
      fullAudio.set(chunk, offset)
      offset += chunk.length
    }

    this._audioBuffer = []
    this._totalSamples = 0

    try {
      const stream = this.recognizer.createStream()
      stream.acceptWaveform({ samples: fullAudio, sampleRate: SAMPLE_RATE })
      this.recognizer.decode(stream)
      const result = stream.result
      const raw = (result.text || '').trim()
      return parseSenseVoiceOutput(raw)
    } catch (error) {
      console.error('[SenseVoice] Recognition error:', error)
      return { text: '', voiceEmotion: null }
    }
  }

  /** Transcribe a complete audio buffer at once (one-shot API). */
  transcribe(samples, sampleRate = SAMPLE_RATE) {
    if (!this.init()) return { text: '', voiceEmotion: null }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)

    try {
      const stream = this.recognizer.createStream()
      stream.acceptWaveform({ samples: float32, sampleRate })
      this.recognizer.decode(stream)
      const result = stream.result
      const raw = (result.text || '').trim()
      return parseSenseVoiceOutput(raw)
    } catch (error) {
      console.error('[SenseVoice] Transcribe error:', error)
      return { text: '', voiceEmotion: null }
    }
  }

  abortStream() {
    this._audioBuffer = []
    this._totalSamples = 0
  }

  destroy() {
    this.abortStream()
    this.recognizer = null
    this.initialized = false
    this.activeModelId = null
  }
}

const sherpaSenseVoiceService = new SherpaSenseVoiceService()
export default sherpaSenseVoiceService
