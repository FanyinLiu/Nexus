/**
 * Paraformer streaming ASR service for Electron main process.
 *
 * Uses sherpa-onnx OnlineRecognizer with a Paraformer streaming model.
 * Unlike SenseVoice (offline), Paraformer returns partial results on
 * every feedAudio() call, enabling real-time live transcript display.
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
  console.warn('[Paraformer] sherpa-onnx-node not available')
}

const SAMPLE_RATE = 16000

function getModelsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'sherpa-models')
    : path.join(app.getAppPath(), 'sherpa-models')
}

const PARAFORMER_CANDIDATES = [
  {
    id: 'paraformer-trilingual',
    directory: 'sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en',
    files: {
      encoder: 'encoder.int8.onnx',
      decoder: 'decoder.int8.onnx',
      tokens: 'tokens.txt',
    },
  },
  {
    id: 'paraformer-zh-en',
    directory: 'sherpa-onnx-streaming-paraformer-bilingual-zh-en',
    files: {
      encoder: 'encoder.int8.onnx',
      decoder: 'decoder.int8.onnx',
      tokens: 'tokens.txt',
    },
  },
]

class SherpaParaformerService {
  constructor() {
    this.recognizer = null
    this.stream = null
    this.initialized = false
    this.activeModelId = null
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
      modelsDir: getModelsDir(),
      currentModelId: this.activeModelId,
    }
  }

  _findModel() {
    const modelsDir = getModelsDir()
    for (const candidate of PARAFORMER_CANDIDATES) {
      const dir = path.join(modelsDir, candidate.directory)
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
          paraformer: {
            encoder: path.join(model.dir, model.files.encoder),
            decoder: path.join(model.dir, model.files.decoder),
          },
          tokens: path.join(model.dir, model.files.tokens),
          numThreads: 2,
          debug: 0,
          provider: 'cpu',
        },
        enableEndpoint: 1,
        rule1MinTrailingSilence: 2.4,
        rule2MinTrailingSilence: 1.2,
        rule3MinUtteranceLength: 20,
      }

      this.recognizer = new sherpa.OnlineRecognizer(config)
      this.initialized = true
      this.activeModelId = model.id
      console.info('[Paraformer] OnlineRecognizer initialized with', model.id)
      return true
    } catch (error) {
      console.error('[Paraformer] Init failed:', error)
      this.recognizer = null
      this.initialized = false
      return false
    }
  }

  startStream() {
    if (!this.init()) return false
    this.stream = this.recognizer.createStream()
    return true
  }

  /** Feed audio and return partial text + endpoint flag. */
  feedAudio(samples, _sampleRate = SAMPLE_RATE) {
    if (!this.recognizer || !this.stream) {
      return { text: '', isEndpoint: false }
    }

    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    this.stream.acceptWaveform({ samples: float32, sampleRate: SAMPLE_RATE })

    while (this.recognizer.isReady(this.stream)) {
      this.recognizer.decode(this.stream)
    }

    const text = (this.recognizer.getResult(this.stream).text || '').trim()
    const isEndpoint = this.recognizer.isEndpoint(this.stream)

    if (isEndpoint) {
      this.recognizer.reset(this.stream)
    }

    return { text, isEndpoint }
  }

  /** Finish the stream and return any remaining text. */
  finishStream() {
    if (!this.recognizer || !this.stream) return ''

    // Flush any remaining audio
    const tailSamples = new Float32Array(SAMPLE_RATE * 0.8)
    this.stream.acceptWaveform({ samples: tailSamples, sampleRate: SAMPLE_RATE })

    while (this.recognizer.isReady(this.stream)) {
      this.recognizer.decode(this.stream)
    }

    const text = (this.recognizer.getResult(this.stream).text || '').trim()
    this.stream = null
    return text
  }

  abortStream() {
    this.stream = null
  }

  destroy() {
    this.abortStream()
    this.recognizer = null
    this.initialized = false
    this.activeModelId = null
  }
}

const sherpaParaformerService = new SherpaParaformerService()
export default sherpaParaformerService
