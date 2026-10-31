import { ipcMain } from 'electron'
import sherpaKwsService from '../sherpaKws.js'
import sherpaVadService from '../sherpaVad.js'
import sherpaSenseVoiceService from '../sherpaSenseVoice.js'
import sherpaParaformerService from '../sherpaParaformer.js'
import smartTurnService from '../smartTurn.js'
import {
  getInventory as getModelInventory,
  downloadModel as downloadModelById,
  downloadMissingRequired,
  getNetworkProbe,
} from '../services/modelManager.js'
import { SPEECH_IPC_ERROR_CODES } from '../../shared/speechErrorCodes.js'
import { requireTrustedSender } from './validate.js'
import {
  validateKwsOptionsPayload,
  validateModelDownloadMissingPayload,
  validateModelDownloadPayload,
  validateTurnEndSessionPayload,
  validateVadStartPayload,
} from './payloadSchemas.js'

export function register() {
  ipcMain.handle('kws:status', (event, payload) => {
    requireTrustedSender(event)
    payload = validateKwsOptionsPayload('kws:status', payload)
    return sherpaKwsService.getStatus(payload)
  })

  ipcMain.handle('kws:start', (event, payload) => {
    requireTrustedSender(event)
    payload = validateKwsOptionsPayload('kws:start', payload)
    const status = sherpaKwsService.getStatus(payload)
    if (!status.modelFound) {
      if (status.reason) console.warn('[KWS] model unavailable:', status.reason)
      throw new Error(SPEECH_IPC_ERROR_CODES.SHERPA_MODEL_MISSING)
    }
    const ok = sherpaKwsService.start(payload)
    if (!ok) {
      throw new Error(SPEECH_IPC_ERROR_CODES.SHERPA_START_FAILED)
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
    payload = validateVadStartPayload(payload)
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
    smartTurnService.feed(float32)
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
          ? SPEECH_IPC_ERROR_CODES.SHERPA_MODEL_MISSING
          : SPEECH_IPC_ERROR_CODES.SHERPA_ENGINE_MISSING,
      )
    }
    const ok = sherpaSenseVoiceService.startStream()
    if (!ok) throw new Error(SPEECH_IPC_ERROR_CODES.SHERPA_START_FAILED)
    return { ok: true, sampleRate: 16000 }
  })

  ipcMain.handle('sensevoice:feed', (event, payload) => {
    requireTrustedSender(event)
    const { samples } = payload
    if (!samples || !samples.length) return { ok: true }
    if (!Array.isArray(samples) && !(samples instanceof Float32Array)) return { ok: true }
    if (samples.length > 320000) return { ok: true }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    smartTurnService.feed(float32)
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
          ? SPEECH_IPC_ERROR_CODES.SHERPA_MODEL_MISSING
          : SPEECH_IPC_ERROR_CODES.SHERPA_ENGINE_MISSING,
      )
    }
    const ok = sherpaParaformerService.startStream()
    if (!ok) throw new Error(SPEECH_IPC_ERROR_CODES.SHERPA_START_FAILED)
    return { ok: true, sampleRate: 16000 }
  })

  ipcMain.handle('paraformer:feed', (event, payload) => {
    requireTrustedSender(event)
    const { samples } = payload
    if (!samples || !samples.length) return { text: '', isEndpoint: false }
    if (!Array.isArray(samples) && !(samples instanceof Float32Array)) return { text: '', isEndpoint: false }
    if (samples.length > 320000) return { text: '', isEndpoint: false }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    smartTurnService.feed(float32)
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

  // ── Smart Turn v3 end-of-turn probe (main-process audio) ──
  //
  // Audio never crosses this boundary a second time: start/stop open and close
  // the in-memory ring, while the existing feed handlers append to it.

  ipcMain.handle('voice-turn:start', (event) => {
    requireTrustedSender(event)
    return smartTurnService.startSession()
  })

  ipcMain.handle('voice-turn:probe', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateTurnEndSessionPayload(payload)
    return smartTurnService.probe(payload?.sessionId)
  })

  ipcMain.handle('voice-turn:stop', (event, payload) => {
    requireTrustedSender(event)
    payload = validateTurnEndSessionPayload(payload)
    return smartTurnService.stopSession(payload?.sessionId)
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
    payload = validateModelDownloadPayload(payload)
    const modelId = payload?.modelId
    await downloadModelById(modelId)
    return getModelInventory()
  })

  ipcMain.handle('models:download-missing', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateModelDownloadMissingPayload(payload)
    return downloadMissingRequired(payload.speechInputProviderId)
  })

  ipcMain.handle('models:network-probe', async (event) => {
    requireTrustedSender(event)
    return getNetworkProbe()
  })
}
