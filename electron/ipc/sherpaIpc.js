import { ipcMain } from 'electron'
import sherpaKwsService from '../sherpaKws.js'
import sherpaVadService from '../sherpaVad.js'
import sherpaSenseVoiceService from '../sherpaSenseVoice.js'
import sherpaParaformerService from '../sherpaParaformer.js'
import {
  getInventory as getModelInventory,
  downloadModel as downloadModelById,
  downloadMissingRequired,
  getNetworkProbe,
} from '../services/modelManager.js'
import { ensurePythonRuntimeStatus } from '../services/pythonRuntime.js'
import { requireTrustedSender } from './validate.js'

export function register() {
  ipcMain.handle('kws:status', (event, payload) => {
    requireTrustedSender(event)
    return sherpaKwsService.getStatus(payload)
  })

  ipcMain.handle('kws:start', (event, payload) => {
    requireTrustedSender(event)
    const status = sherpaKwsService.getStatus(payload)
    if (!status.modelFound) {
      throw new Error(status.reason || '唤醒词模型未安装，请在设置 → 本地模型向导里下载。')
    }
    const ok = sherpaKwsService.start(payload)
    if (!ok) {
      throw new Error('唤醒词引擎初始化失败。')
    }
    return { ok: true, sampleRate: 16000 }
  })

  ipcMain.handle('kws:feed', (event, payload) => {
    requireTrustedSender(event)
    const { samples, sampleRate } = payload
    if (!samples || !samples.length) return { keyword: null }
    if (!Array.isArray(samples) && !(samples instanceof Float32Array)) return { keyword: null }
    if (samples.length > 320000) return { keyword: null }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    return sherpaKwsService.feed(float32, sampleRate)
  })

  ipcMain.handle('kws:stop', (event) => {
    requireTrustedSender(event)
    sherpaKwsService.stop()
    return { ok: true }
  })

  // ── Silero VAD (main-process) ──

  ipcMain.handle('vad:status', (event) => {
    requireTrustedSender(event)
    return sherpaVadService.getStatus()
  })

  ipcMain.handle('vad:start', (event, payload) => {
    requireTrustedSender(event)
    return sherpaVadService.start(payload ?? {})
  })

  ipcMain.handle('vad:feed', (event, payload) => {
    requireTrustedSender(event)
    const { samples } = payload || {}
    if (!samples || !samples.length) {
      return { speechDetected: false, speechStarted: false, speechEnded: false, segments: [] }
    }
    if (!Array.isArray(samples) && !(samples instanceof Float32Array)) {
      return { speechDetected: false, speechStarted: false, speechEnded: false, segments: [] }
    }
    if (samples.length > 320000) {
      return { speechDetected: false, speechStarted: false, speechEnded: false, segments: [] }
    }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    return sherpaVadService.feed(float32)
  })

  ipcMain.handle('vad:flush', (event) => {
    requireTrustedSender(event)
    return { segments: sherpaVadService.flush() }
  })

  ipcMain.handle('vad:stop', (event) => {
    requireTrustedSender(event)
    sherpaVadService.stop()
    return { ok: true }
  })

  // ── SenseVoice offline ASR ──

  ipcMain.handle('sensevoice:status', (event) => {
    requireTrustedSender(event)
    return sherpaSenseVoiceService.getStatus()
  })

  ipcMain.handle('sensevoice:start', (event) => {
    requireTrustedSender(event)
    if (!sherpaSenseVoiceService.isAvailable()) {
      const status = sherpaSenseVoiceService.getStatus()
      throw new Error(
        status.installed
          ? 'SenseVoice 模型未安装，请在设置 → 本地模型向导里点击下载。'
          : 'sherpa-onnx-node 原生模块未加载，请检查安装是否完整。',
      )
    }
    const ok = sherpaSenseVoiceService.startStream()
    if (!ok) throw new Error('SenseVoice 初始化失败。')
    return { ok: true, sampleRate: 16000 }
  })

  ipcMain.handle('sensevoice:feed', (event, payload) => {
    requireTrustedSender(event)
    const { samples } = payload
    if (!samples || !samples.length) return { ok: true }
    if (!Array.isArray(samples) && !(samples instanceof Float32Array)) return { ok: true }
    if (samples.length > 320000) return { ok: true }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    sherpaSenseVoiceService.feedAudio(float32)
    return { ok: true }
  })

  ipcMain.handle('sensevoice:finish', (event) => {
    requireTrustedSender(event)
    const result = sherpaSenseVoiceService.finishStream()
    // Backwards-compat shape: callers used `result.text`. New `voiceEmotion`
    // field is opt-in — older renderers ignore it harmlessly.
    return { text: result.text, voiceEmotion: result.voiceEmotion }
  })

  ipcMain.handle('sensevoice:abort', (event) => {
    requireTrustedSender(event)
    sherpaSenseVoiceService.abortStream()
    return { ok: true }
  })

  ipcMain.handle('sensevoice:transcribe', (event, payload) => {
    requireTrustedSender(event)
    const { samples, sampleRate } = payload
    if (!samples || !samples.length) return { text: '', voiceEmotion: null }
    if (!Array.isArray(samples) && !(samples instanceof Float32Array)) return { text: '', voiceEmotion: null }
    if (samples.length > 320000) return { text: '', voiceEmotion: null }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    const result = sherpaSenseVoiceService.transcribe(float32, sampleRate || 16000)
    return { text: result.text, voiceEmotion: result.voiceEmotion }
  })

  // ── Paraformer streaming ASR ──

  ipcMain.handle('paraformer:status', (event) => {
    requireTrustedSender(event)
    return sherpaParaformerService.getStatus()
  })

  ipcMain.handle('paraformer:start', (event) => {
    requireTrustedSender(event)
    if (!sherpaParaformerService.isAvailable()) {
      const status = sherpaParaformerService.getStatus()
      throw new Error(
        status.installed
          ? 'Paraformer 模型未安装，请在设置 → 本地模型向导里下载（可选模型，默认使用 SenseVoice）。'
          : 'sherpa-onnx-node 原生模块未加载，请检查安装是否完整。',
      )
    }
    const ok = sherpaParaformerService.startStream()
    if (!ok) throw new Error('Paraformer 初始化失败。')
    return { ok: true, sampleRate: 16000 }
  })

  ipcMain.handle('paraformer:feed', (event, payload) => {
    requireTrustedSender(event)
    const { samples } = payload
    if (!samples || !samples.length) return { text: '', isEndpoint: false }
    if (!Array.isArray(samples) && !(samples instanceof Float32Array)) return { text: '', isEndpoint: false }
    if (samples.length > 320000) return { text: '', isEndpoint: false }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    return sherpaParaformerService.feedAudio(float32)
  })

  ipcMain.handle('paraformer:finish', (event) => {
    requireTrustedSender(event)
    const text = sherpaParaformerService.finishStream()
    return { text }
  })

  ipcMain.handle('paraformer:abort', (event) => {
    requireTrustedSender(event)
    sherpaParaformerService.abortStream()
    return { ok: true }
  })

  // ── Model manager (first-launch setup wizard) ──
  //
  // Progress events for in-flight downloads are pushed to every BrowserWindow
  // via 'models:download-progress' (see electron/services/modelManager.js).

  ipcMain.handle('models:inventory', (event) => {
    requireTrustedSender(event)
    return getModelInventory()
  })

  ipcMain.handle('models:download', async (event, payload) => {
    requireTrustedSender(event)
    const modelId = payload?.modelId
    if (!modelId || typeof modelId !== 'string') {
      throw new Error('modelId required')
    }
    await downloadModelById(modelId)
    return getModelInventory()
  })

  ipcMain.handle('models:download-missing', async (event) => {
    requireTrustedSender(event)
    return downloadMissingRequired()
  })

  ipcMain.handle('models:network-probe', async (event) => {
    requireTrustedSender(event)
    return getNetworkProbe()
  })

  ipcMain.handle('python:status', async (event) => {
    requireTrustedSender(event)
    return ensurePythonRuntimeStatus()
  })
}
