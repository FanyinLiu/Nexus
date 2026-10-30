import { SPEECH_IPC_ERROR_CODES } from '../../shared/speechErrorCodes.js'
import { Readable } from 'node:stream'
import {
  performNetworkRequestWithRetry,
  readJsonSafe,
  readResponseBufferWithLimit,
  extractResponseErrorMessage,
  normalizeLanguageCode,
  audioFormatToMimeType,
} from '../net.js'
import { synthesizeEdgeTts } from './edgeTts.js'
import { getRedactedErrorMessage } from './errorRedaction.js'
import {
  isVolcengineSpeechInputProvider,
  isVolcengineSpeechOutputProvider,
  isMiniMaxSpeechOutputProvider,
  isDashScopeSpeechOutputProvider,
  isOmniVoiceSpeechOutputProvider,
  isQwen3TtsSpeechOutputProvider,
  isEdgeTtsSpeechOutputProvider,
  isOpenAiCompatibleSpeechInputProvider,
  isZhipuSpeechInputProvider,
  isXaiSpeechInputProvider,
  isXaiSpeechOutputProvider,
  isOpenAiCompatibleSpeechOutputProvider,
  parseVolcengineSpeechCredentials,
  assertSpeechOutputCredentials,
} from './ttsProviders.js'
import {
  buildAuthorizationHeaders,
  buildOpenAiCompatibleSpeechRequestPayload,
  createSilentWavBase64,
  extractMiniMaxVoiceOptions,
  mapLanguageToDashScopeType,
  resolveDashScopeTtsModel,
  mapLanguageToMiniMaxBoost,
  resolveSpeechOutputBaseUrl,
  resolveSpeechOutputTimeoutMessage,
  resolveSpeechOutputTimeoutMs,
  toSpeechVoiceOption,
  QWEN3_TTS_WARMUP_TIMEOUT_MS,
} from './ttsHelpers.js'
import {
  formatVolcengineSpeechOutputCombo,
  synthesizeVolcengineSpeechOutputWithFallback,
} from './ttsVolcengine.js'
import { synthesizeLocalTts } from './localTts.js'
import { buildQwen3TtsSpeechRequestPayload } from './qwen3TtsPayload.js'
import { resolveOmniVoiceSeed } from './ttsSeed.js'
import {
  buildXaiSttMultipartParts,
  buildXaiTtsRequestBody,
  mapLanguageToXaiStt,
} from './xaiSpeech.js'
import { float32ToInt16PcmBuffer } from './audioEncoding.js'

function logTtsRetry({ attempt, reason, url, error }) {
  const host = (() => {
    try { return new URL(url).host } catch { return url }
  })()
  console.warn(
    `[TTS-Retry] attempt=${attempt} reason=${reason} host=${host}`,
    error ? `error=${getRedactedErrorMessage(error)}` : '',
  )
}

function formatSpeechTextLogMeta(text) {
  return `chars=${String(text ?? '').length}`
}

/** Per-base-URL warm-up cache so each sentence does not re-probe the sidecar. */
const qwen3TtsReadyPromises = new Map()

/**
 * Make sure the local Qwen3-TTS sidecar is up and its model is loaded.
 *
 * `/health` is cheap; when the model is still cold the first sentence pays the
 * checkpoint load, which is far longer than the 20 s first-audio budget. So
 * warm up explicitly (180 s ceiling) before the streaming request starts.
 */
export async function warmupQwen3Tts(baseUrl, signal) {
  const existing = qwen3TtsReadyPromises.get(baseUrl)
  if (existing) return existing

  const promise = (async () => {
    const health = await performNetworkRequestWithRetry(`${baseUrl}/health`, {
      allowPrivateNetwork: true,
      method: 'GET',
      timeoutMs: 5_000,
      timeoutMessage: SPEECH_IPC_ERROR_CODES.TTS_TIMEOUT,
      signal,
      // The supervisor starts Python on selection; give the port a few
      // seconds to appear instead of treating a still-starting sidecar as a
      // hard failure on the very first reply.
      maxAttempts: 4,
    })
    if (!health.ok) {
      throw new Error(`本地 Qwen3 语音服务还没准备好（${health.status}）。`)
    }
    const status = await readJsonSafe(health)
    if (status?.loaded === true) return status

    const warm = await performNetworkRequestWithRetry(`${baseUrl}/v1/warmup`, {
      allowPrivateNetwork: true,
      method: 'POST',
      timeoutMs: QWEN3_TTS_WARMUP_TIMEOUT_MS,
      timeoutMessage: SPEECH_IPC_ERROR_CODES.TTS_TIMEOUT,
      signal,
      maxAttempts: 1,
    })
    if (!warm.ok) {
      throw new Error(`本地 Qwen3 语音模型没能加载（${warm.status}）。`)
    }
    return readJsonSafe(warm)
  })().catch((error) => {
    // A failed warm-up must not poison every later reply — let the next turn
    // retry once the user has fixed the Python env or freed memory.
    qwen3TtsReadyPromises.delete(baseUrl)
    throw error
  })

  qwen3TtsReadyPromises.set(baseUrl, promise)
  return promise
}

/**
 * Warm the local sidecar before the renderer arms its first-audio watchdog.
 * Non-Qwen providers resolve immediately.
 *
 * @param {Record<string, unknown>} sessionPayload
 * @param {AbortSignal} [signal]
 */
export async function warmupRemoteTtsSession(sessionPayload, signal) {
  if (!isQwen3TtsSpeechOutputProvider(sessionPayload?.providerId)) return
  const baseUrl = resolveSpeechOutputBaseUrl(
    sessionPayload.providerId,
    sessionPayload.baseUrl,
  )
  await warmupQwen3Tts(baseUrl, signal)
}

/**
 * Synthesize text via a remote TTS API provider, returning PCM-decodable audio.
 * Used by the streaming TTS service to convert each text chunk into audio.
 * For OpenAI-compatible providers, requests raw PCM (int16 24kHz) for lower latency.
 * For others, returns the standard audioBase64/mimeType result.
 */
async function synthesizeRemoteTts(sessionPayload, text, signal) {
  const payload = { ...sessionPayload, text }
  const content = text.trim()
  if (!content) throw new Error('没有可播报的文本内容。')

  // Local sherpa VITS: no base URL, no credentials, returns PCM directly.
  if (payload.providerId === 'local-tts') {
    const speed = Number.isFinite(payload.rate) ? payload.rate : 1
    const { samples, sampleRate } = await synthesizeLocalTts(content, { speed })
    return { pcmBuffer: float32ToInt16PcmBuffer(samples), pcmSampleRate: sampleRate }
  }

  const synthTimeoutMs = resolveSpeechOutputTimeoutMs()
  const synthTimeoutMessage = resolveSpeechOutputTimeoutMessage()

  const baseUrl = resolveSpeechOutputBaseUrl(payload.providerId, payload.baseUrl)
  const rate = Number.isFinite(payload.rate) ? payload.rate : 1
  const pitch = Number.isFinite(payload.pitch) ? payload.pitch : 1
  const volume = Number.isFinite(payload.volume) ? payload.volume : 1

  if (!baseUrl) throw new Error('请先填写语音输出 API Base URL。')
  assertSpeechOutputCredentials(payload.providerId, payload.apiKey)

  // Local Qwen3-TTS: the sidecar streams 16-bit PCM sentence by sentence, so
  // return the response body as a Node stream and let playback start on the
  // first sentence instead of waiting for the whole reply.
  if (isQwen3TtsSpeechOutputProvider(payload.providerId)) {
    await warmupQwen3Tts(baseUrl, signal)
    const endpoint = `${baseUrl}/audio/speech`
    const requestBody = JSON.stringify(buildQwen3TtsSpeechRequestPayload(payload, content))
    const response = await performNetworkRequestWithRetry(endpoint, {
      allowPrivateNetwork: true,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
      timeoutMs: synthTimeoutMs,
      timeoutMessage: synthTimeoutMessage,
      signal,
      // Retrying a speech POST would synthesize the sentence twice; playback
      // would then repeat the first clause. Reconnect happens one level up.
      maxAttempts: 1,
    })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(
        response,
        '本地 Qwen3 语音服务返回了状态码 ' + response.status + '。',
      ))
    }
    if (!response.body) {
      throw new Error('本地 Qwen3 语音服务没有返回音频流。')
    }
    return {
      pcmStream: Readable.fromWeb(response.body),
      pcmSampleRate: 24000,
    }
  }

  // OpenAI-compatible: request raw PCM for streaming
  if (isOpenAiCompatibleSpeechOutputProvider(payload.providerId)) {
    const endpoint = `${baseUrl}/audio/speech`
    const openAiPayload = buildOpenAiCompatibleSpeechRequestPayload(
      payload,
      content,
      { responseFormat: 'pcm' },
    )
    // OmniVoice's diffusion sampler has no speaker reference — the initial
    // random noise IS the speaker identity latent. A per-reply seed fixes the
    // timbre inside one reply but still re-rolls it on the next one. Key the
    // seed on the character + voice instead, so the same persona keeps the
    // same speaker across replies. Non-OmniVoice OpenAI-compat providers
    // ignore the extra field.
    if (isOmniVoiceSpeechOutputProvider(payload.providerId)) {
      openAiPayload.seed = resolveOmniVoiceSeed(payload.characterId, openAiPayload.voice)
    }
    const requestBody = JSON.stringify(openAiPayload)
    const headers = {
      'Content-Type': 'application/json',
      ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
    }

    const response = await performNetworkRequestWithRetry(endpoint, {
      allowPrivateNetwork: true,
      method: 'POST',
      headers,
      body: requestBody,
      timeoutMs: synthTimeoutMs,
      timeoutMessage: synthTimeoutMessage,
      signal,
      onRetry: logTtsRetry,
    })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response, '语音播报那边回了个状态码 ' + response.status + '，不太确定哪里出了问题。'))
    }

    const pcmBuffer = await readResponseBufferWithLimit(response, { label: '语音音频' })
    return { pcmBuffer, pcmSampleRate: 24000 }
  }

  // ElevenLabs: request pcm_16000 for streaming
  if (payload.providerId === 'elevenlabs-tts') {
    if (!payload.voice) throw new Error('请先填写 ElevenLabs 的 voice_id。')

    const endpoint = `${baseUrl}/text-to-speech/${encodeURIComponent(payload.voice)}?output_format=pcm_16000`
    const requestBody = JSON.stringify({
      text: content,
      model_id: payload.model || 'eleven_multilingual_v2',
      ...(normalizeLanguageCode(payload.language) ? { language_code: normalizeLanguageCode(payload.language) } : {}),
    })
    const headers = {
      Accept: 'audio/pcm',
      'Content-Type': 'application/json',
      ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
    }

    const response = await performNetworkRequestWithRetry(endpoint, {
      allowPrivateNetwork: true,
      method: 'POST',
      headers,
      body: requestBody,
      timeoutMs: synthTimeoutMs,
      timeoutMessage: synthTimeoutMessage,
      signal,
      onRetry: logTtsRetry,
    })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response, '语音播报那边回了个状态码 ' + response.status + '，不太确定哪里出了问题。'))
    }

    const pcmBuffer = await readResponseBufferWithLimit(response, { label: '语音音频' })
    return { pcmBuffer, pcmSampleRate: 16000 }
  }

  if (isXaiSpeechOutputProvider(payload.providerId)) {
    const endpoint = `${baseUrl}/tts`
    const requestBody = JSON.stringify(buildXaiTtsRequestBody(payload, content, {
      codec: 'pcm',
      sampleRate: 24000,
    }))
    const headers = {
      'Content-Type': 'application/json',
      ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
    }

    const response = await performNetworkRequestWithRetry(endpoint, {
      allowPrivateNetwork: true,
      method: 'POST',
      headers,
      body: requestBody,
      timeoutMs: synthTimeoutMs,
      timeoutMessage: synthTimeoutMessage,
      signal,
      onRetry: logTtsRetry,
    })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response, '语音播报那边回了个状态码 ' + response.status + '，不太确定哪里出了问题。'))
    }

    const pcmBuffer = await readResponseBufferWithLimit(response, { label: '语音音频' })
    return { pcmBuffer, pcmSampleRate: 24000 }
  }

  // Volcengine
  if (isVolcengineSpeechOutputProvider(payload.providerId)) {
    const credentials = parseVolcengineSpeechCredentials(payload.apiKey)
    if (!credentials.appId || !credentials.accessToken) {
      throw new Error('火山语音合成请在 API Key 一栏填写 APP_ID:ACCESS_TOKEN。')
    }

    const result = await synthesizeVolcengineSpeechOutputWithFallback({
      baseUrl,
      apiKey: payload.apiKey,
      credentials,
      cluster: payload.model,
      voice: payload.voice,
      text: content,
      rate,
      volume,
      pitch,
      timeoutMs: synthTimeoutMs,
      timeoutMessage: synthTimeoutMessage,
      signal,
    })

    if (!result.ok) throw new Error(result.errorMessage)
    return {
      audioBase64: result.audioBase64,
      mimeType: result.mimeType,
      resolvedVoice: result.voice,
      resolvedCluster: result.cluster,
      usedFallback: Boolean(result.usedFallback),
    }
  }

  // MiniMax
  if (isMiniMaxSpeechOutputProvider(payload.providerId)) {
    const endpoint = `${baseUrl}/t2a_v2`
    const requestBody = JSON.stringify({
      model: payload.model || 'speech-2.8-turbo',
      text: content,
      stream: false,
      voice_setting: {
        voice_id: payload.voice || 'female-shaonv',
        speed: Number(Math.min(Math.max(rate, 0.5), 2).toFixed(1)),
        vol: Math.round(Math.min(Math.max(volume * 10, 1), 10)),
        pitch: Math.round(Math.min(Math.max((pitch - 1) * 12, -12), 12)),
        ...(typeof payload.emotion === 'string' && payload.emotion.trim()
          ? { emotion: payload.emotion.trim() }
          : {}),
      },
      audio_setting: {
        format: 'wav',
        sample_rate: 24000,
        bitrate: 128000,
        channel: 1,
      },
      language_boost: mapLanguageToMiniMaxBoost(payload.language),
    })
    const headers = {
      'Content-Type': 'application/json',
      ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
    }

    const response = await performNetworkRequestWithRetry(endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
      timeoutMs: synthTimeoutMs,
      timeoutMessage: synthTimeoutMessage,
      signal,
      onRetry: logTtsRetry,
    })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response, '语音播报那边回了个状态码 ' + response.status + '，不太确定哪里出了问题。'))
    }

    const data = await readJsonSafe(response)
    if (Number(data?.base_resp?.status_code ?? 0) !== 0) {
      throw new Error(data?.base_resp?.status_msg ?? data?.message ?? 'MiniMax 语音接口返回了异常状态。')
    }
    const audioHex = String(data?.data?.audio ?? '').trim()
    if (!audioHex) throw new Error('MiniMax 语音接口没有返回可播放音频。')

    return {
      audioBase64: Buffer.from(audioHex, 'hex').toString('base64'),
      mimeType: audioFormatToMimeType(data?.extra_info?.audio_format ?? 'wav'),
    }
  }

  // DashScope
  if (isDashScopeSpeechOutputProvider(payload.providerId)) {
    const endpoint = `${baseUrl}/services/aigc/multimodal-generation/generation`
    const requestBody = JSON.stringify({
      model: resolveDashScopeTtsModel(payload.model),
      input: {
        text: content,
        voice: payload.voice || 'Cherry',
        language_type: mapLanguageToDashScopeType(payload.language),
      },
    })
    const headers = {
      'Content-Type': 'application/json',
      ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
    }

    const response = await performNetworkRequestWithRetry(endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
      timeoutMs: synthTimeoutMs,
      timeoutMessage: synthTimeoutMessage,
      signal,
      onRetry: logTtsRetry,
    })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response, '语音播报那边回了个状态码 ' + response.status + '，不太确定哪里出了问题。'))
    }

    const data = await readJsonSafe(response)
    const audioUrl = String(data?.output?.audio?.url ?? data?.output?.audio_url ?? '').trim()
    if (!audioUrl) throw new Error('百炼语音接口没有返回音频地址。')

    const audioResponse = await performNetworkRequestWithRetry(audioUrl, {
      method: 'GET',
      timeoutMs: synthTimeoutMs,
      timeoutMessage: SPEECH_IPC_ERROR_CODES.TTS_TIMEOUT,
      signal,
      onRetry: logTtsRetry,
    })

    if (!audioResponse.ok) {
      throw new Error(await extractResponseErrorMessage(audioResponse, '百炼音频那边回了个状态码 ' + audioResponse.status + '，不太确定哪里出了问题。'))
    }

    return {
      audioBase64: Buffer.from(await audioResponse.arrayBuffer()).toString('base64'),
      mimeType: audioResponse.headers.get('content-type') ?? 'audio/wav',
    }
  }

  // Edge TTS: Microsoft Edge Read Aloud, free, ultra-low latency
  if (isEdgeTtsSpeechOutputProvider(payload.providerId)) {
    console.info(
      '[Edge-TTS] synthesize:',
      formatSpeechTextLogMeta(content),
      'voice:',
      payload.voice || 'zh-CN-XiaoxiaoNeural',
    )
    return synthesizeEdgeTts(content, {
      voice: payload.voice || 'zh-CN-XiaoxiaoNeural',
      rate: Number.isFinite(payload.rate) ? payload.rate : undefined,
      pitch: Number.isFinite(payload.pitch) ? payload.pitch : undefined,
      volume: Number.isFinite(payload.volume) ? payload.volume : undefined,
    })
  }

  throw new Error('当前语音输出提供商暂未接通流式播放。')
}

export {
  synthesizeRemoteTts,
  buildQwen3TtsSpeechRequestPayload,
  buildAuthorizationHeaders,
  parseVolcengineSpeechCredentials,
  isOpenAiCompatibleSpeechOutputProvider,
  isQwen3TtsSpeechOutputProvider,
  isMiniMaxSpeechOutputProvider,
  isDashScopeSpeechOutputProvider,
  isVolcengineSpeechOutputProvider,
  isVolcengineSpeechInputProvider,
  isOpenAiCompatibleSpeechInputProvider,
  isZhipuSpeechInputProvider,
  isXaiSpeechInputProvider,
  isXaiSpeechOutputProvider,
  assertSpeechOutputCredentials,
  resolveSpeechOutputBaseUrl,
  resolveSpeechOutputTimeoutMs,
  resolveSpeechOutputTimeoutMessage,
  toSpeechVoiceOption,
  extractMiniMaxVoiceOptions,
  buildOpenAiCompatibleSpeechRequestPayload,
  buildXaiTtsRequestBody,
  buildXaiSttMultipartParts,
  mapLanguageToXaiStt,
  synthesizeVolcengineSpeechOutputWithFallback,
  formatVolcengineSpeechOutputCombo,
  createSilentWavBase64,
  mapLanguageToMiniMaxBoost,
  mapLanguageToDashScopeType,
  resolveDashScopeTtsModel,
}
