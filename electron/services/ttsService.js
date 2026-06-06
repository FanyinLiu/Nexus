import {
  performNetworkRequest,
  performNetworkRequestWithRetry,
  readJsonSafe,
  readResponseBufferWithLimit,
  extractResponseErrorMessage,
  normalizeLanguageCode,
  audioFormatToMimeType,
} from '../net.js'
import { synthesizeEdgeTts } from './edgeTts.js'
import {
  SPEECH_PROVIDER_IDS,
  isElevenLabsProvider,
  isVolcengineSpeechInputProvider,
  isVolcengineSpeechOutputProvider,
  isMiniMaxSpeechOutputProvider,
  isDashScopeSpeechOutputProvider,
  isOmniVoiceSpeechOutputProvider,
  isEdgeTtsSpeechOutputProvider,
  isOpenAiCompatibleSpeechInputProvider,
  isZhipuSpeechInputProvider,
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
  mapLanguageToMiniMaxBoost,
  resolveSpeechOutputBaseUrl,
  resolveSpeechOutputTimeoutMessage,
  resolveSpeechOutputTimeoutMs,
  toSpeechVoiceOption,
} from './ttsHelpers.js'
import {
  formatVolcengineSpeechOutputCombo,
  synthesizeVolcengineSpeechOutputWithFallback,
} from './ttsVolcengine.js'

// FNV-1a 32-bit hash of the requestId, clamped to non-zero positive int32 so
// it's safe to pass straight into torch.manual_seed on the Python server.
function stableSeedFromRequestId(requestId) {
  let hash = 0x811c9dc5
  for (let i = 0; i < requestId.length; i += 1) {
    hash ^= requestId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  const positive = hash & 0x7fffffff
  return positive === 0 ? 1 : positive
}

function logTtsRetry({ attempt, reason, url, error }) {
  const host = (() => {
    try { return new URL(url).host } catch { return url }
  })()
  console.warn(
    `[TTS-Retry] attempt=${attempt} reason=${reason} host=${host}`,
    error?.message ? `error=${error.message}` : '',
  )
}

/**
 * Synthesize text via a remote TTS API provider, returning PCM-decodable audio.
 * Used by the streaming TTS service to convert each text chunk into audio.
 * For OpenAI-compatible providers, requests raw PCM (int16 24kHz) for lower latency.
 * For others, returns the standard audioBase64/mimeType result.
 */
async function synthesizeRemoteTts(sessionPayload, text) {
  const payload = { ...sessionPayload, text }
  const content = text.trim()
  if (!content) throw new Error('没有可播报的文本内容。')
  const synthTimeoutMs = resolveSpeechOutputTimeoutMs()
  const synthTimeoutMessage = resolveSpeechOutputTimeoutMessage()

  const baseUrl = resolveSpeechOutputBaseUrl(payload.providerId, payload.baseUrl)
  const rate = Number.isFinite(payload.rate) ? payload.rate : 1
  const pitch = Number.isFinite(payload.pitch) ? payload.pitch : 1
  const volume = Number.isFinite(payload.volume) ? payload.volume : 1

  if (!baseUrl) throw new Error('请先填写语音输出 API Base URL。')
  assertSpeechOutputCredentials(payload.providerId, payload.apiKey)

  // OpenAI-compatible: request raw PCM for streaming
  if (isOpenAiCompatibleSpeechOutputProvider(payload.providerId)) {
    const endpoint = `${baseUrl}/audio/speech`
    const openAiPayload = buildOpenAiCompatibleSpeechRequestPayload(
      payload,
      content,
      { responseFormat: 'pcm' },
    )
    // OmniVoice's diffusion sampler has no speaker reference — the initial
    // random noise IS the speaker identity latent. Without a pinned seed,
    // every segment in a multi-sentence reply draws a fresh timbre, which
    // users hear as "第一句对，第二句换人了". Derive a stable seed from the
    // streaming session's requestId so all segments in the same reply reuse
    // the same latent and the voice stays consistent. Non-OmniVoice
    // OpenAI-compat providers ignore the extra field.
    if (isOmniVoiceSpeechOutputProvider(payload.providerId) && payload.requestId) {
      openAiPayload.seed = stableSeedFromRequestId(String(payload.requestId))
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
      onRetry: logTtsRetry,
    })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response, '语音播报请求失败（状态码：' + response.status + '）'))
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
      onRetry: logTtsRetry,
    })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response, '语音播报请求失败（状态码：' + response.status + '）'))
    }

    const pcmBuffer = await readResponseBufferWithLimit(response, { label: '语音音频' })
    return { pcmBuffer, pcmSampleRate: 16000 }
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
      onRetry: logTtsRetry,
    })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response, '语音播报请求失败（状态码：' + response.status + '）'))
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
      model: payload.model || 'qwen3-tts-instruct-flash',
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
      onRetry: logTtsRetry,
    })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response, '语音播报请求失败（状态码：' + response.status + '）'))
    }

    const data = await readJsonSafe(response)
    const audioUrl = String(data?.output?.audio?.url ?? data?.output?.audio_url ?? '').trim()
    if (!audioUrl) throw new Error('百炼语音接口没有返回音频地址。')

    const audioResponse = await performNetworkRequestWithRetry(audioUrl, {
      method: 'GET',
      timeoutMs: synthTimeoutMs,
      timeoutMessage: '语音文件下载超时，请检查网络或稍后重试。',
      onRetry: logTtsRetry,
    })

    if (!audioResponse.ok) {
      throw new Error(await extractResponseErrorMessage(audioResponse, '百炼音频下载失败（状态码：' + audioResponse.status + '）'))
    }

    return {
      audioBase64: Buffer.from(await audioResponse.arrayBuffer()).toString('base64'),
      mimeType: audioResponse.headers.get('content-type') ?? 'audio/wav',
    }
  }

  // Edge TTS: Microsoft Edge Read Aloud, free, ultra-low latency
  if (isEdgeTtsSpeechOutputProvider(payload.providerId)) {
    console.log('[Edge-TTS] synthesize:', content.slice(0, 40), 'voice:', payload.voice || 'zh-CN-XiaoxiaoNeural')
    return synthesizeEdgeTts(content, {
      voice: payload.voice || 'zh-CN-XiaoxiaoNeural',
      rate: Number.isFinite(payload.rate) ? payload.rate : undefined,
      pitch: Number.isFinite(payload.pitch) ? payload.pitch : undefined,
      volume: Number.isFinite(payload.volume) ? payload.volume : undefined,
    })
  }

  throw new Error('当前语音输出提供商暂未接通流式播放。')
}

async function warmupRemoteTtsSession(_sessionPayload) {
  // No-op: previously used for local Qwen3-TTS service warm-up.
}

export {
  SPEECH_PROVIDER_IDS,
  synthesizeRemoteTts,
  warmupRemoteTtsSession,
  buildAuthorizationHeaders,
  parseVolcengineSpeechCredentials,
  isElevenLabsProvider,
  isOpenAiCompatibleSpeechOutputProvider,
  isMiniMaxSpeechOutputProvider,
  isDashScopeSpeechOutputProvider,
  isOmniVoiceSpeechOutputProvider,
  isVolcengineSpeechOutputProvider,
  isVolcengineSpeechInputProvider,
  isOpenAiCompatibleSpeechInputProvider,
  isZhipuSpeechInputProvider,
  assertSpeechOutputCredentials,
  resolveSpeechOutputBaseUrl,
  resolveSpeechOutputTimeoutMs,
  resolveSpeechOutputTimeoutMessage,
  toSpeechVoiceOption,
  extractMiniMaxVoiceOptions,
  buildOpenAiCompatibleSpeechRequestPayload,
  synthesizeVolcengineSpeechOutputWithFallback,
  formatVolcengineSpeechOutputCombo,
  createSilentWavBase64,
  mapLanguageToMiniMaxBoost,
  mapLanguageToDashScopeType,
}
