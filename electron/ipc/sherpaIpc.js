import { ipcMain } from 'electron'
import sherpaKwsService from '../sherpaKws.js'
import sherpaSenseVoiceService from '../sherpaSenseVoice.js'
import sherpaParaformerService from '../sherpaParaformer.js'
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
      throw new Error(status.reason || '唤醒词模型未安装，请运行 setup.bat 下载模型。')
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
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    return sherpaKwsService.feed(float32, sampleRate)
  })

  ipcMain.handle('kws:stop', (event) => {
    requireTrustedSender(event)
    sherpaKwsService.stop()
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
          ? `SenseVoice 模型未安装，请将 sherpa-onnx-sense-voice-zh-en-2024-07-17 目录放到 ${status.modelsDir} 下。`
          : 'sherpa-onnx-node 未安装，请先运行 npm install sherpa-onnx-node。',
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
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    sherpaSenseVoiceService.feedAudio(float32)
    return { ok: true }
  })

  ipcMain.handle('sensevoice:finish', (event) => {
    requireTrustedSender(event)
    const text = sherpaSenseVoiceService.finishStream()
    return { text }
  })

  ipcMain.handle('sensevoice:abort', (event) => {
    requireTrustedSender(event)
    sherpaSenseVoiceService.abortStream()
    return { ok: true }
  })

  ipcMain.handle('sensevoice:transcribe', (event, payload) => {
    requireTrustedSender(event)
    const { samples, sampleRate } = payload
    if (!samples || !samples.length) return { text: '' }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    const text = sherpaSenseVoiceService.transcribe(float32, sampleRate || 16000)
    return { text }
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
          ? `Paraformer 模型未安装，请将 sherpa-onnx-streaming-paraformer 目录放到 ${status.modelsDir} 下。`
          : 'sherpa-onnx-node 未安装，请先运行 npm install sherpa-onnx-node。',
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
}
