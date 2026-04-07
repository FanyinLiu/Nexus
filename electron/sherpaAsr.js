/**
 * Sherpa-onnx streaming ASR service for Electron main process.
 *
 * Manages the lifecycle of a sherpa-onnx online (streaming) recognizer.
 * Audio frames are fed incrementally and partial / final results are emitted
 * via a callback so the renderer can show live transcription.
 */

import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'
import { createRequire } from 'node:module'

let sherpa = null
try {
  const require = createRequire(import.meta.url)
  sherpa = require('sherpa-onnx-node')
} catch {
  console.warn('[SherpaASR] sherpa-onnx-node is not installed or failed to load.')
}

const SAMPLE_RATE = 16000

// ── Audio preprocessing for ASR accuracy ──

const NOISE_GATE_THRESHOLD = 0.006
const AUTO_GAIN_TARGET_RMS = 0.12
const AUTO_GAIN_MIN = 0.5
const AUTO_GAIN_MAX = 8.0
const GAIN_SMOOTHING = 0.15

function preprocessAudioChunk(samples, context) {
  if (!samples || !samples.length) return samples

  // 1. Compute RMS energy
  let energy = 0
  for (let i = 0; i < samples.length; i++) {
    energy += samples[i] * samples[i]
  }
  const rms = Math.sqrt(energy / samples.length)

  // 2. Noise gate — suppress very quiet chunks (background noise)
  if (rms < NOISE_GATE_THRESHOLD) {
    return new Float32Array(samples.length)
  }

  // 3. Auto-gain normalization — stabilize input level for recognizer
  let targetGain = rms > 0 ? AUTO_GAIN_TARGET_RMS / rms : 1.0
  targetGain = Math.max(AUTO_GAIN_MIN, Math.min(AUTO_GAIN_MAX, targetGain))

  // Smooth gain transitions to avoid clicks
  const prevGain = context._lastGain ?? targetGain
  context._lastGain = prevGain + (targetGain - prevGain) * GAIN_SMOOTHING

  const output = new Float32Array(samples.length)
  const gain = context._lastGain
  for (let i = 0; i < samples.length; i++) {
    output[i] = Math.max(-1, Math.min(1, samples[i] * gain))
  }

  return output
}
const MODEL_CANDIDATES = [
  {
    id: 'streaming-paraformer-bilingual-zh-en',
    type: 'paraformer',
    directory: 'sherpa-onnx-streaming-paraformer-bilingual-zh-en',
    files: {
      encoder: 'encoder.int8.onnx',
      decoder: 'decoder.int8.onnx',
      tokens: 'tokens.txt',
    },
  },
  {
    id: 'streaming-zipformer-bilingual-zh-en',
    type: 'zipformer',
    directory: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
    files: {
      encoder: 'encoder-epoch-99-avg-1.int8.onnx',
      decoder: 'decoder-epoch-99-avg-1.onnx',
      joiner: 'joiner-epoch-99-avg-1.int8.onnx',
      tokens: 'tokens.txt',
    },
  },
]

const CLAUSE_END_PARTICLES = /(?:吧|呀|啊|啦|呢|嘛|了|的)$/u
const QUESTION_PARTICLES = /(?:吗|么|呢|嘛)$/u
const EXCLAIM_PARTICLES = /(?:啊|呀|啦)$/u

function addChinesePunctuation(text) {
  if (!text) return text
  if (/[。！？；，、：]/u.test(text)) return text

  const segments = text.split(/\s+/).filter(Boolean)

  if (segments.length <= 1) {
    const segment = segments[0] || text
    if (QUESTION_PARTICLES.test(segment)) return `${segment}？`
    if (EXCLAIM_PARTICLES.test(segment)) return `${segment}！`
    return `${segment}。`
  }

  const lastIndex = segments.length - 1
  return segments.map((segment, index) => {
    if (index === lastIndex) {
      if (QUESTION_PARTICLES.test(segment)) return `${segment}？`
      if (EXCLAIM_PARTICLES.test(segment)) return `${segment}！`
      return `${segment}。`
    }

    if (CLAUSE_END_PARTICLES.test(segment)) {
      return `${segment}，`
    }

    return `${segment}，`
  }).join('')
}

function getModelsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'sherpa-models')
    : path.join(app.getAppPath(), 'sherpa-models')
}

function hasAllFiles(directoryPath, fileNames) {
  return fileNames.every((fileName) => fs.existsSync(path.join(directoryPath, fileName)))
}

function getAvailableModelConfigs() {
  const modelsDir = getModelsDir()

  return MODEL_CANDIDATES.flatMap((candidate) => {
    const directoryPath = path.join(modelsDir, candidate.directory)
    const requiredFiles = Object.values(candidate.files)

    if (!hasAllFiles(directoryPath, requiredFiles)) {
      return []
    }

    if (candidate.type === 'paraformer') {
      return [{
        id: candidate.id,
        type: candidate.type,
        tokens: path.join(directoryPath, candidate.files.tokens),
        paraformer: {
          encoder: path.join(directoryPath, candidate.files.encoder),
          decoder: path.join(directoryPath, candidate.files.decoder),
        },
      }]
    }

    return [{
      id: candidate.id,
      type: candidate.type,
      tokens: path.join(directoryPath, candidate.files.tokens),
      transducer: {
        encoder: path.join(directoryPath, candidate.files.encoder),
        decoder: path.join(directoryPath, candidate.files.decoder),
        joiner: path.join(directoryPath, candidate.files.joiner),
      },
    }]
  })
}

function resolveModelConfig(preferredModelId) {
  const availableConfigs = getAvailableModelConfigs()
  if (!availableConfigs.length) {
    return null
  }

  if (preferredModelId) {
    return availableConfigs.find((config) => config.id === preferredModelId) ?? null
  }

  return availableConfigs[0]
}

function buildRecognizerConfig(modelConfig) {
  const config = {
    featConfig: {
      sampleRate: SAMPLE_RATE,
      featureDim: 80,
    },
    modelConfig: {
      debug: 0,
      numThreads: 2,
      provider: 'cpu',
      tokens: modelConfig.tokens,
    },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: 1,
    rule1MinTrailingSilence: 1.8,
    rule2MinTrailingSilence: 1.0,
    rule3MinUtteranceLength: 12,
  }

  if (modelConfig.type === 'paraformer') {
    config.modelConfig.paraformer = modelConfig.paraformer
  } else if (modelConfig.type === 'zipformer') {
    config.modelConfig.transducer = modelConfig.transducer
  }

  return config
}

class SherpaAsrService {
  constructor() {
    this.recognizer = null
    this.stream = null
    this.initialized = false
    this.lastPartialText = ''
    this.activeModelId = null
  }

  isAvailable() {
    return sherpa !== null
  }

  getSampleRate() {
    return SAMPLE_RATE
  }

  getModelStatus(preferredModelId) {
    const availableModels = getAvailableModelConfigs()
    const modelConfig = resolveModelConfig(preferredModelId)

    return {
      installed: sherpa !== null,
      modelFound: modelConfig !== null,
      modelsDir: getModelsDir(),
      currentModelId: this.activeModelId,
      availableModels: availableModels.map((model) => model.id),
    }
  }

  init(preferredModelId) {
    const requestedModelId = String(preferredModelId ?? '').trim() || null

    if (
      this.initialized
      && this.recognizer
      && (!requestedModelId || this.activeModelId === requestedModelId)
    ) {
      return true
    }

    if (!sherpa) {
      console.error('[SherpaASR] sherpa-onnx-node not available')
      return false
    }

    const modelConfig = resolveModelConfig(requestedModelId)
    if (!modelConfig) {
      console.error('[SherpaASR] No matching streaming model found in', getModelsDir(), 'preferred:', requestedModelId)
      return false
    }

    if (this.recognizer) {
      this.destroy()
    }

    try {
      this.recognizer = new sherpa.OnlineRecognizer(buildRecognizerConfig(modelConfig))
      this.initialized = true
      this.activeModelId = modelConfig.id
      console.info('[SherpaASR] Recognizer initialized with', modelConfig.id)
      return true
    } catch (error) {
      console.error('[SherpaASR] Failed to initialize recognizer:', error)
      this.recognizer = null
      this.initialized = false
      this.activeModelId = null
      return false
    }
  }

  startStream(preferredModelId) {
    const requestedModelId = String(preferredModelId ?? '').trim() || null
    if (!this.init(requestedModelId)) {
      return false
    }

    try {
      this.stream = this.recognizer.createStream()
    } catch (error) {
      console.error('[SherpaASR] Failed to create stream:', error)
      return false
    }

    this.lastPartialText = ''
    this._lastGain = undefined
    return true
  }

  feedAudio(samples, sampleRate = SAMPLE_RATE) {
    if (!this.stream || !this.recognizer) return null

    const normalizedSampleRate = Number.isFinite(sampleRate) && sampleRate > 0
      ? Number(sampleRate)
      : SAMPLE_RATE

    const processed = preprocessAudioChunk(samples, this)
    this.stream.acceptWaveform({ samples: processed, sampleRate: normalizedSampleRate })

    while (this.recognizer.isReady(this.stream)) {
      this.recognizer.decode(this.stream)
    }

    const result = this.recognizer.getResult(this.stream)
    const text = (result.text || '').trim()

    if (text && text !== this.lastPartialText) {
      this.lastPartialText = text
      return text
    }

    return null
  }

  checkEndpoint() {
    if (!this.stream || !this.recognizer) return null

    const isEndpoint = this.recognizer.isEndpoint(this.stream)
    if (!isEndpoint) return null

    const result = this.recognizer.getResult(this.stream)
    const text = (result.text || '').trim()

    try {
      this.recognizer.reset(this.stream)
    } catch (error) {
      console.error('[SherpaASR] Failed to reset stream after endpoint:', error)
    }
    this.lastPartialText = ''

    return text ? addChinesePunctuation(text) : null
  }

  finishStream() {
    if (!this.stream || !this.recognizer) return ''

    const tail = new Float32Array(SAMPLE_RATE * 0.4)
    this.stream.acceptWaveform({ samples: tail, sampleRate: SAMPLE_RATE })
    this.stream.inputFinished()

    while (this.recognizer.isReady(this.stream)) {
      this.recognizer.decode(this.stream)
    }

    const result = this.recognizer.getResult(this.stream)
    const text = (result.text || '').trim()

    this.stream = null
    this.lastPartialText = ''

    return addChinesePunctuation(text)
  }

  abortStream() {
    this.stream = null
    this.lastPartialText = ''
    this._lastGain = undefined
  }

  destroy() {
    this.abortStream()
    this.recognizer = null
    this.initialized = false
    this.activeModelId = null
  }
}

const sherpaAsrService = new SherpaAsrService()

export default sherpaAsrService
