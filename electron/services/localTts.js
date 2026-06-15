/**
 * Local offline TTS via sherpa-onnx VITS (MeloTTS zh_en).
 *
 * Zero-config, zero-cost speech output: no API key, no network, no per-
 * character billing — the missing free tier next to the cloud providers.
 * The model is an optional entry in the shared model catalog and downloads
 * through the same in-app installer as the STT models.
 */

import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { findModelDir } from './modelPaths.js'

const require = createRequire(import.meta.url)

let sherpa = null
try {
  sherpa = require('sherpa-onnx-node')
} catch {
  console.warn('[LocalTTS] sherpa-onnx-node is not installed or failed to load.')
}

export const LOCAL_TTS_MODEL_DIR = 'vits-melo-tts-zh_en'

let _tts = null
let _ttsModelDir = null
/** @type {Promise<unknown>|null} */
let _creating = null

export function isLocalTtsAvailable() {
  if (!sherpa?.OfflineTts) return false
  const dir = findModelDir(LOCAL_TTS_MODEL_DIR)
  return Boolean(dir && fs.existsSync(path.join(dir, 'model.onnx')))
}

async function getTts() {
  if (!sherpa?.OfflineTts) {
    throw new Error('本地语音合成组件好像没装好，试试重新安装应用？')
  }
  const dir = findModelDir(LOCAL_TTS_MODEL_DIR)
  if (!dir || !fs.existsSync(path.join(dir, 'model.onnx'))) {
    throw new Error('本地语音模型还没安装，请到 设置 → 本地模型 下载「本地语音合成」。')
  }
  if (_tts && _ttsModelDir === dir) return _tts
  if (_creating) return _creating

  // Chinese text-normalization rule FSTs ship with the model; include the
  // ones that exist so numbers/dates read naturally.
  const ruleFsts = ['date.fst', 'number.fst', 'phone.fst', 'new_heteronym.fst']
    .map((name) => path.join(dir, name))
    .filter((p) => fs.existsSync(p))
    .join(',')

  const config = {
    model: {
      vits: {
        model: path.join(dir, 'model.onnx'),
        lexicon: path.join(dir, 'lexicon.txt'),
        tokens: path.join(dir, 'tokens.txt'),
        dictDir: path.join(dir, 'dict'),
      },
      numThreads: 2,
      provider: 'cpu',
      debug: false,
    },
    maxNumSentences: 1,
    ...(ruleFsts ? { ruleFsts } : {}),
  }

  _creating = sherpa.OfflineTts.createAsync(config)
    .then((tts) => {
      _tts = tts
      _ttsModelDir = dir
      _creating = null
      return tts
    })
    .catch((error) => {
      _creating = null
      throw error
    })
  return _creating
}

/**
 * @param {string} text
 * @param {{ speed?: number }} [options]
 * @returns {Promise<{ samples: Float32Array, sampleRate: number }>}
 */
export async function synthesizeLocalTts(text, options = {}) {
  const tts = await getTts()
  const speed = Math.min(Math.max(Number(options.speed) || 1, 0.5), 2)
  const audio = await tts.generateAsync({ text, sid: 0, speed })
  return { samples: audio.samples, sampleRate: audio.sampleRate ?? tts.sampleRate }
}
