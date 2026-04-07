import { ipcMain } from 'electron'
import sherpaAsrService from '../sherpaAsr.js'
import sherpaKwsService from '../sherpaKws.js'
import sherpaSenseVoiceService from '../sherpaSenseVoice.js'

export function register() {
  ipcMain.handle('sherpa:status', () => {
    return sherpaAsrService.getModelStatus()
  })

  ipcMain.handle('sherpa:start', (_event, payload) => {
    if (!sherpaAsrService.isAvailable()) {
      throw new Error('sherpa-onnx-node 未安装，请先运行 npm install sherpa-onnx-node。')
    }

    const modelId = String(payload?.modelId ?? '').trim() || undefined
    const ok = sherpaAsrService.startStream(modelId)
    if (!ok) {
      const status = sherpaAsrService.getModelStatus(modelId)
      throw new Error(
        status.modelFound
          ? '本地流式识别引擎初始化失败，请检查模型文件完整性。'
          : modelId
            ? `未找到流式语音模型 ${modelId}，请将对应模型放到 ${status.modelsDir} 目录下。`
            : `未找到流式语音模型，请将模型放到 ${status.modelsDir} 目录下。`,
      )
    }

    return {
      ok: true,
      sampleRate: sherpaAsrService.getSampleRate(),
    }
  })

  ipcMain.handle('sherpa:feed', (_event, payload) => {
    const { samples, sampleRate } = payload
    if (!samples || !samples.length) return { partial: null, endpoint: null }

    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    const partial = sherpaAsrService.feedAudio(float32, sampleRate)
    const endpoint = sherpaAsrService.checkEndpoint()

    return { partial, endpoint }
  })

  ipcMain.handle('sherpa:finish', () => {
    const text = sherpaAsrService.finishStream()
    return { text }
  })

  ipcMain.handle('sherpa:abort', () => {
    sherpaAsrService.abortStream()
    return { ok: true }
  })

  ipcMain.handle('kws:status', (_event, payload) => {
    return sherpaKwsService.getStatus(payload)
  })

  ipcMain.handle('kws:start', (_event, payload) => {
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

  ipcMain.handle('kws:feed', (_event, payload) => {
    const { samples, sampleRate } = payload
    if (!samples || !samples.length) return { keyword: null }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    return sherpaKwsService.feed(float32, sampleRate)
  })

  ipcMain.handle('kws:stop', () => {
    sherpaKwsService.stop()
    return { ok: true }
  })

  // ── SenseVoice offline ASR ──

  ipcMain.handle('sensevoice:status', () => {
    return sherpaSenseVoiceService.getStatus()
  })

  ipcMain.handle('sensevoice:start', () => {
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

  ipcMain.handle('sensevoice:feed', (_event, payload) => {
    const { samples } = payload
    if (!samples || !samples.length) return { ok: true }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    sherpaSenseVoiceService.feedAudio(float32)
    return { ok: true }
  })

  ipcMain.handle('sensevoice:finish', () => {
    const text = sherpaSenseVoiceService.finishStream()
    return { text }
  })

  ipcMain.handle('sensevoice:abort', () => {
    sherpaSenseVoiceService.abortStream()
    return { ok: true }
  })

  ipcMain.handle('sensevoice:transcribe', (_event, payload) => {
    const { samples, sampleRate } = payload
    if (!samples || !samples.length) return { text: '' }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    const text = sherpaSenseVoiceService.transcribe(float32, sampleRate || 16000)
    return { text }
  })
}
