import {
  normalizeBaseUrl,
  normalizeCosyVoiceBaseUrl,
  performNetworkRequest,
  readJsonSafe,
  readTextSafe,
  extractResponseErrorMessage,
  normalizeLanguageCode,
  audioFormatToMimeType,
} from '../net.js'
import { randomUUID } from 'node:crypto'
import http from 'node:http'

const cosyVoiceAgent = new http.Agent({ keepAlive: false, maxSockets: 2 })
import { synthesizeEdgeTts } from './edgeTts.js'

// ── Constants ──

const AUDIO_SYNTH_TIMEOUT_MS = 25_000
const VOLCENGINE_TTS_DEFAULT_CLUSTER = 'volcano_tts'
const VOLCENGINE_TTS_DEFAULT_VOICE = 'BV001_streaming'

// ── Provider detection ──

const SPEECH_PROVIDER_IDS = Object.freeze({
  volcengineSTT:  'volcengine-stt',
  volcengineTTS:  'volcengine-tts',
  minimax:        'minimax-tts',
  dashscope:      'dashscope-tts',
  cosyvoice:      'cosyvoice-tts',
  edgeTts:        'edge-tts',
  openaiSTT:      'openai-stt',
  customOpenaiSTT:'custom-openai-stt',
  openaiTTS:      'openai-tts',
  customOpenaiTTS:'custom-openai-tts',
})

const isElevenLabsProvider                = (id) => String(id ?? '').startsWith('elevenlabs')
const isVolcengineSpeechInputProvider     = (id) => id === SPEECH_PROVIDER_IDS.volcengineSTT
const isVolcengineSpeechOutputProvider    = (id) => id === SPEECH_PROVIDER_IDS.volcengineTTS
const isMiniMaxSpeechOutputProvider       = (id) => id === SPEECH_PROVIDER_IDS.minimax
const isDashScopeSpeechOutputProvider     = (id) => id === SPEECH_PROVIDER_IDS.dashscope
const isCosyVoiceSpeechOutputProvider     = (id) => id === SPEECH_PROVIDER_IDS.cosyvoice
const isEdgeTtsSpeechOutputProvider       = (id) => id === SPEECH_PROVIDER_IDS.edgeTts

const OPENAI_COMPATIBLE_STT_IDS = new Set([SPEECH_PROVIDER_IDS.openaiSTT, SPEECH_PROVIDER_IDS.customOpenaiSTT])
const isOpenAiCompatibleSpeechInputProvider = (id) => OPENAI_COMPATIBLE_STT_IDS.has(id)

const OPENAI_COMPATIBLE_TTS_IDS = new Set([SPEECH_PROVIDER_IDS.openaiTTS, SPEECH_PROVIDER_IDS.customOpenaiTTS])
const isOpenAiCompatibleSpeechOutputProvider = (id) => OPENAI_COMPATIBLE_TTS_IDS.has(id)

// ── URL / timeout resolution ──

function resolveSpeechOutputBaseUrl(providerId, baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl)

  if (isCosyVoiceSpeechOutputProvider(providerId)) {
    return normalizeCosyVoiceBaseUrl(normalized || 'http://127.0.0.1:50000')
  }

  return normalized
}

function resolveSpeechOutputTimeoutMs() {
  return AUDIO_SYNTH_TIMEOUT_MS
}

function resolveSpeechOutputTimeoutMessage() {
  return '语音播报响应超时，请检查网络、代理或当前语音服务状态。'
}

function buildOpenAiCompatibleSpeechRequestPayload(payload, content, options = {}) {
  const responseFormat = String(options.responseFormat ?? '').trim()

  // OpenAI speed: 0.25-4.0 (Nexus rate is 0.5-2.0, direct map)
  const speed = Number.isFinite(payload.rate) ? Math.min(Math.max(payload.rate, 0.25), 4.0) : undefined

  return {
    model: payload.model || 'gpt-4o-mini-tts',
    voice: String(payload.voice ?? '').trim() || 'alloy',
    input: content,
    ...(speed != null ? { speed } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(payload.instructions?.trim() ? { instructions: payload.instructions.trim() } : {}),
  }
}

// ── Authorization ──

function buildAuthorizationHeaders(providerId, apiKey) {
  if (!apiKey) return {}

  if (isElevenLabsProvider(providerId)) {
    return {
      'xi-api-key': apiKey,
    }
  }

  if (isVolcengineSpeechOutputProvider(providerId)) {
    const credentials = parseVolcengineSpeechCredentials(apiKey)
    return {
      Authorization: `Bearer;${credentials.accessToken || apiKey}`,
    }
  }

  return {
    Authorization: `Bearer ${apiKey}`,
  }
}

// ── Voice helpers ──

function toSpeechVoiceOption(item) {
  const id = String(
    item?.voice_id
    ?? item?.voiceId
    ?? item?.voice_name
    ?? item?.voiceName
    ?? item?.name
    ?? '',
  ).trim()

  if (!id) return null

  const rawLabel = String(
    item?.voice_name
    ?? item?.voiceName
    ?? item?.name
    ?? id,
  ).trim()

  const description = [
    item?.language,
    item?.accent,
    item?.gender,
    item?.age,
    item?.style,
    item?.emotion,
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' · ')

  return {
    id,
    label: rawLabel,
    ...(description ? { description } : {}),
  }
}

function extractMiniMaxVoiceOptions(data) {
  const sources = [
    ...(Array.isArray(data?.system_voice) ? data.system_voice : []),
    ...(Array.isArray(data?.voice_cloning) ? data.voice_cloning : []),
    ...(Array.isArray(data?.voice_generation) ? data.voice_generation : []),
    ...(Array.isArray(data?.voice_list) ? data.voice_list : []),
    ...(Array.isArray(data?.data?.system_voice) ? data.data.system_voice : []),
    ...(Array.isArray(data?.data?.voice_cloning) ? data.data.voice_cloning : []),
    ...(Array.isArray(data?.data?.voice_generation) ? data.data.voice_generation : []),
    ...(Array.isArray(data?.data?.voice_list) ? data.data.voice_list : []),
    ...(Array.isArray(data?.data?.voices) ? data.data.voices : []),
    ...(Array.isArray(data?.voices) ? data.voices : []),
  ]

  const seen = new Set()
  const voices = []

  for (const item of sources) {
    const mapped = toSpeechVoiceOption(item)
    if (!mapped || seen.has(mapped.id)) continue
    seen.add(mapped.id)
    voices.push(mapped)
  }

  return voices.sort((left, right) => left.label.localeCompare(right.label, 'zh-Hans-CN', {
    sensitivity: 'base',
  }))
}

// ── Volcengine TTS ──

function parseVolcengineSpeechCredentials(apiKey) {
  const raw = String(apiKey ?? '').trim()
  if (!raw) {
    return {
      appId: '',
      accessToken: '',
    }
  }

  const directMatch = raw.match(/^\s*([0-9]{6,})\s*[:|：]\s*(.+?)\s*$/s)
  if (directMatch) {
    return {
      appId: String(directMatch[1] ?? '').trim(),
      accessToken: String(directMatch[2] ?? '').trim(),
    }
  }

  const appIdMatch = raw.match(/(?:app[\s_-]*id|appid)\s*[:：=]\s*([0-9]{6,})/i)
  const accessTokenMatch = raw.match(/(?:access[\s_-]*token|token)\s*[:：=]\s*([A-Za-z0-9._\-+/=]+)/i)
  if (appIdMatch || accessTokenMatch) {
    return {
      appId: String(appIdMatch?.[1] ?? '').trim(),
      accessToken: String(accessTokenMatch?.[1] ?? '').trim(),
    }
  }

  const separator = raw.includes(':') ? ':' : raw.includes('|') ? '|' : ''
  if (!separator) {
    return {
      appId: '',
      accessToken: raw,
    }
  }

  const [appId, ...tokenParts] = raw.split(separator)
  return {
    appId: String(appId ?? '').trim(),
    accessToken: tokenParts.join(separator).trim(),
  }
}

function normalizeVolcengineSpeechOutputCluster(cluster) {
  return String(cluster ?? '').trim() || VOLCENGINE_TTS_DEFAULT_CLUSTER
}

function normalizeVolcengineSpeechOutputVoice(voice) {
  return String(voice ?? '').trim() || VOLCENGINE_TTS_DEFAULT_VOICE
}

function formatVolcengineSpeechOutputCombo(cluster, voice) {
  return `${normalizeVolcengineSpeechOutputCluster(cluster)} + ${normalizeVolcengineSpeechOutputVoice(voice)}`
}

function isVolcengineSpeechOutputAuthErrorMessage(message) {
  const normalizedMessage = String(message ?? '').trim().toLowerCase()

  return (
    normalizedMessage.includes('requested grant not found')
    || normalizedMessage.includes('authenticate request')
    || normalizedMessage.includes('invalid token')
  )
}

function isVolcengineSpeechOutputGrantErrorMessage(message) {
  const normalizedMessage = String(message ?? '').trim().toLowerCase()

  return (
    normalizedMessage.includes('requested resource not granted')
    || normalizedMessage.includes('resource not granted')
    || normalizedMessage.includes('requested resource')
    || normalizedMessage.includes('access denied')
  )
}

function isVolcengineSpeechOutputInitErrorMessage(message) {
  const normalizedMessage = String(message ?? '').trim().toLowerCase()

  return (
    normalizedMessage.includes('init engine instance failed')
    || normalizedMessage.includes('voice_type')
    || normalizedMessage.includes('cluster')
  )
}

function getVolcengineSpeechOutputErrorDetails(data, fallbackMessage) {
  const code = String(data?.code ?? '').trim()
  const rawMessage = String(data?.message ?? data?.msg ?? '').trim()

  if (isVolcengineSpeechOutputAuthErrorMessage(rawMessage)) {
    return {
      code,
      rawMessage,
      isAuthError: true,
      isGrantError: false,
      isInitError: false,
      message: '火山语音鉴权失败，请确认 API Key 填的是 APP_ID:ACCESS_TOKEN，并且当前账号已开通豆包语音服务。',
    }
  }

  if (isVolcengineSpeechOutputGrantErrorMessage(rawMessage)) {
    return {
      code,
      rawMessage,
      isAuthError: false,
      isGrantError: true,
      isInitError: false,
      message: '当前火山音色还没授权到你的账号，请先在控制台服务页为这个音色下单/授权；如果只是想先能播报，建议改回 BV001_streaming 或 BV002_streaming。',
    }
  }

  if (isVolcengineSpeechOutputInitErrorMessage(rawMessage)) {
    return {
      code,
      rawMessage,
      isAuthError: false,
      isGrantError: false,
      isInitError: true,
      message: '火山语音初始化失败，请检查业务集群和音色是否匹配，建议先用 volcano_tts + BV001_streaming。',
    }
  }

  if (rawMessage) {
    return {
      code,
      rawMessage,
      isAuthError: false,
      isGrantError: false,
      isInitError: false,
      message: code ? `火山语音合成失败（${code}）：${rawMessage}` : rawMessage,
    }
  }

  return {
    code,
    rawMessage,
    isAuthError: false,
    isGrantError: false,
    isInitError: false,
    message: code
      ? `火山语音合成接口返回异常状态：${code}`
      : fallbackMessage,
  }
}

function buildVolcengineSpeechOutputRequestBody({
  credentials,
  cluster,
  voice,
  text,
  rate = 1,
  volume = 1,
  pitch = 1,
}) {
  return JSON.stringify({
    app: {
      appid: credentials.appId,
      token: credentials.accessToken,
      cluster: normalizeVolcengineSpeechOutputCluster(cluster),
    },
    user: {
      uid: credentials.appId || 'nexus',
    },
    audio: {
      voice_type: normalizeVolcengineSpeechOutputVoice(voice),
      encoding: 'wav',
      speed_ratio: Number(Math.min(Math.max(rate, 0.2), 3).toFixed(2)),
      volume_ratio: Number(Math.min(Math.max(volume, 0.1), 3).toFixed(2)),
      pitch_ratio: Number(Math.min(Math.max(pitch, 0.1), 3).toFixed(2)),
      rate: 24000,
    },
    request: {
      reqid: randomUUID(),
      text: String(text ?? ''),
      text_type: 'plain',
      operation: 'query',
      with_frontend: 1,
      frontend_type: 'unitTson',
    },
  })
}

function buildVolcengineSpeechOutputAttemptPlan({ cluster, voice }) {
  const initialCluster = normalizeVolcengineSpeechOutputCluster(cluster)
  const initialVoice = normalizeVolcengineSpeechOutputVoice(voice)
  const candidates = [
    {
      cluster: initialCluster,
      voice: initialVoice,
      reason: '当前设置',
    },
    {
      cluster: initialCluster,
      voice: VOLCENGINE_TTS_DEFAULT_VOICE,
      reason: '当前集群 + 通用女声',
    },
    {
      cluster: VOLCENGINE_TTS_DEFAULT_CLUSTER,
      voice: VOLCENGINE_TTS_DEFAULT_VOICE,
      reason: '默认集群 + 通用女声',
    },
    {
      cluster: VOLCENGINE_TTS_DEFAULT_CLUSTER,
      voice: 'BV002_streaming',
      reason: '默认集群 + 通用男声',
    },
  ]
  const seen = new Set()

  return candidates.filter((candidate) => {
    const key = `${candidate.cluster}::${candidate.voice}`
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function summarizeVolcengineSpeechOutputAttempts(attempts) {
  return attempts.map((attempt) => formatVolcengineSpeechOutputCombo(attempt.cluster, attempt.voice))
}

function buildVolcengineSpeechOutputFailureMessage(attempts, fallbackMessage) {
  const prefix = fallbackMessage && !isVolcengineSpeechOutputInitErrorMessage(fallbackMessage)
    ? fallbackMessage
    : '火山语音初始化失败。'
  const retriedMessage = attempts.length > 1
    ? ' 已自动尝试兼容组合，但仍然失败。'
    : ' 这次请求仍然失败。'

  return `${prefix}${retriedMessage}请确认业务集群和音色匹配；想先稳定播报，建议先改成 volcano_tts + BV001_streaming。`
}

function buildVolcengineSpeechOutputGrantFailureMessage(attempts) {
  const retriedMessage = attempts.length > 1
    ? '已自动尝试兼容音色，但仍然失败。'
    : '当前音色仍然不可用。'

  return `当前火山音色还没授权到你的账号，${retriedMessage}请到火山控制台语音服务页为目标音色做 0 元下单或授权；如果只是想先稳定播报，建议直接用 BV001_streaming 或 BV002_streaming。`
}

async function performVolcengineSpeechOutputAttempt({
  baseUrl,
  apiKey,
  credentials,
  cluster,
  voice,
  text,
  rate = 1,
  volume = 1,
  pitch = 1,
  timeoutMs = AUDIO_SYNTH_TIMEOUT_MS,
  timeoutMessage = '语音播报响应超时，请检查网络、代理或当前语音服务状态。',
}) {
  const response = await performNetworkRequest(`${baseUrl}/v1/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthorizationHeaders('volcengine-tts', apiKey),
    },
    body: buildVolcengineSpeechOutputRequestBody({
      credentials,
      cluster,
      voice,
      text,
      rate,
      volume,
      pitch,
    }),
    timeoutMs,
    timeoutMessage,
  })
  const contentType = response.headers.get('content-type') ?? ''
  let data = null
  let responseText = ''

  if (contentType.includes('application/json')) {
    data = await readJsonSafe(response)
  } else {
    responseText = await readTextSafe(response)
    try {
      data = JSON.parse(responseText)
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    const details = data
      ? getVolcengineSpeechOutputErrorDetails(
        data,
        `火山语音播报请求失败（状态码：${response.status}）`,
      )
      : null
    const errorMessage =
      details?.message
      || responseText.trim()
      || `火山语音播报请求失败（状态码：${response.status}）`
    const rawMessage = details?.rawMessage || responseText

    return {
      ok: false,
      cluster: normalizeVolcengineSpeechOutputCluster(cluster),
      voice: normalizeVolcengineSpeechOutputVoice(voice),
      responseStatus: response.status,
      data,
      errorMessage,
      rawMessage,
      isGrantError:
        details?.isGrantError
        || isVolcengineSpeechOutputGrantErrorMessage(rawMessage)
        || isVolcengineSpeechOutputGrantErrorMessage(errorMessage),
      isInitError:
        details?.isInitError
        || isVolcengineSpeechOutputInitErrorMessage(rawMessage)
        || isVolcengineSpeechOutputInitErrorMessage(errorMessage),
    }
  }

  const volcengineData = data ?? {}
  if (Number(volcengineData?.code ?? 0) !== 3000) {
    const details = getVolcengineSpeechOutputErrorDetails(
      volcengineData,
      '火山语音接口返回了异常状态。',
    )

    return {
      ok: false,
      cluster: normalizeVolcengineSpeechOutputCluster(cluster),
      voice: normalizeVolcengineSpeechOutputVoice(voice),
      responseStatus: response.status,
      data: volcengineData,
      errorMessage: details.message,
      rawMessage: details.rawMessage,
      isGrantError: details.isGrantError,
      isInitError: details.isInitError,
    }
  }

  const audioBase64 = String(volcengineData?.data ?? '').trim()
  if (!audioBase64) {
    return {
      ok: false,
      cluster: normalizeVolcengineSpeechOutputCluster(cluster),
      voice: normalizeVolcengineSpeechOutputVoice(voice),
      responseStatus: response.status,
      data: volcengineData,
      errorMessage: '火山语音接口没有返回可播放音频。',
      rawMessage: '',
      isGrantError: false,
      isInitError: false,
    }
  }

  return {
    ok: true,
    cluster: normalizeVolcengineSpeechOutputCluster(cluster),
    voice: normalizeVolcengineSpeechOutputVoice(voice),
    responseStatus: response.status,
    data: volcengineData,
    audioBase64,
    mimeType: audioFormatToMimeType(volcengineData?.addition?.audio_format ?? 'mp3'),
  }
}

async function synthesizeVolcengineSpeechOutputWithFallback(options) {
  const attempts = buildVolcengineSpeechOutputAttemptPlan(options)
  let lastFailure = null

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]
    const result = await performVolcengineSpeechOutputAttempt({
      ...options,
      cluster: attempt.cluster,
      voice: attempt.voice,
    })

    if (result.ok) {
      return {
        ...result,
        usedFallback: index > 0,
        attempts,
        reason: attempt.reason,
      }
    }

    lastFailure = result
    if (!result.isInitError && !result.isGrantError) {
      return {
        ...result,
        attempts,
      }
    }
  }

  console.warn('[Volcengine TTS] all fallback attempts failed', {
    attempts: summarizeVolcengineSpeechOutputAttempts(attempts),
    finalError: lastFailure?.errorMessage ?? '火山语音初始化失败。',
    finalRawMessage: lastFailure?.rawMessage ?? '',
  })

  return {
    ...(lastFailure ?? {
      ok: false,
      cluster: normalizeVolcengineSpeechOutputCluster(options.cluster),
      voice: normalizeVolcengineSpeechOutputVoice(options.voice),
      errorMessage: '火山语音初始化失败。',
      rawMessage: '',
      isGrantError: false,
      isInitError: true,
    }),
    attempts,
    errorMessage: lastFailure?.isGrantError
      ? buildVolcengineSpeechOutputGrantFailureMessage(attempts)
      : buildVolcengineSpeechOutputFailureMessage(
        attempts,
        lastFailure?.errorMessage,
      ),
  }
}

// ── Silent WAV ──

function createSilentWavBase64(durationMs = 450, sampleRate = 16000) {
  const channelCount = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const sampleCount = Math.max(1, Math.round(sampleRate * durationMs / 1000))
  const dataSize = sampleCount * channelCount * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channelCount, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28)
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  return buffer.toString('base64')
}

// ── Language mapping ──

function mapLanguageToMiniMaxBoost(language) {
  switch (normalizeLanguageCode(language)) {
    case 'zh':
      return 'Chinese'
    case 'yue':
      return 'Cantonese'
    case 'en':
      return 'English'
    case 'ja':
      return 'Japanese'
    case 'ko':
      return 'Korean'
    default:
      return 'auto'
  }
}

function mapLanguageToDashScopeType(language) {
  switch (normalizeLanguageCode(language)) {
    case 'zh':
      return 'Chinese'
    case 'en':
      return 'English'
    case 'de':
      return 'German'
    case 'fr':
      return 'French'
    case 'ru':
      return 'Russian'
    case 'it':
      return 'Italian'
    case 'es':
      return 'Spanish'
    case 'pt':
      return 'Portuguese'
    case 'ja':
      return 'Japanese'
    case 'ko':
      return 'Korean'
    default:
      return 'Auto'
  }
}

// ── Main synthesizer ──

/**
 * Synthesize text via a remote TTS API provider, returning PCM-decodable audio.
 * Used by the streaming TTS service to convert each text chunk into audio.
 * For OpenAI-compatible providers, requests raw PCM (int16 24kHz) for lower latency.
 * For others, returns the standard audioBase64/mimeType result.
 *
 * @param {object} sessionPayload - The session payload from tts:stream-start (providerId, baseUrl, apiKey, model, voice, etc.)
 * @param {string} text - The text to synthesize
 * @returns {Promise<{ audioBase64?: string, mimeType?: string, pcmBuffer?: Buffer, pcmSampleRate?: number }>}
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

  // ── OpenAI-compatible: request raw PCM for streaming ──
  if (isOpenAiCompatibleSpeechOutputProvider(payload.providerId)) {
    const endpoint = `${baseUrl}/audio/speech`
    const requestBody = JSON.stringify(buildOpenAiCompatibleSpeechRequestPayload(
      payload,
      content,
      { responseFormat: 'pcm' },
    ))
    const headers = {
      'Content-Type': 'application/json',
      ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
    }

    const response = await performNetworkRequest(endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
      timeoutMs: synthTimeoutMs,
      timeoutMessage: synthTimeoutMessage,
    })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response, '语音播报请求失败（状态码：' + response.status + '）'))
    }

    const pcmBuffer = Buffer.from(await response.arrayBuffer())
    return { pcmBuffer, pcmSampleRate: 24000 }
  }

  // ── ElevenLabs: request pcm_16000 for streaming ──
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

    const response = await performNetworkRequest(endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
      timeoutMs: synthTimeoutMs,
      timeoutMessage: synthTimeoutMessage,
    })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response, '语音播报请求失败（状态码：' + response.status + '）'))
    }

    const pcmBuffer = Buffer.from(await response.arrayBuffer())
    return { pcmBuffer, pcmSampleRate: 16000 }
  }

  // ── Volcengine ──
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
    return { audioBase64: result.audioBase64, mimeType: result.mimeType }
  }

  // ── MiniMax ──
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

    const response = await performNetworkRequest(endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
      timeoutMs: synthTimeoutMs,
      timeoutMessage: synthTimeoutMessage,
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

  // ── DashScope ──
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

    const response = await performNetworkRequest(endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
      timeoutMs: synthTimeoutMs,
      timeoutMessage: synthTimeoutMessage,
    })

    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response, '语音播报请求失败（状态码：' + response.status + '）'))
    }

    const data = await readJsonSafe(response)
    const audioUrl = String(data?.output?.audio?.url ?? data?.output?.audio_url ?? '').trim()
    if (!audioUrl) throw new Error('百炼语音接口没有返回音频地址。')

    const audioResponse = await performNetworkRequest(audioUrl, {
      method: 'GET',
      timeoutMs: synthTimeoutMs,
      timeoutMessage: '语音文件下载超时，请检查网络或稍后重试。',
    })

    if (!audioResponse.ok) {
      throw new Error(await extractResponseErrorMessage(audioResponse, '百炼音频下载失败（状态码：' + audioResponse.status + '）'))
    }

    return {
      audioBase64: Buffer.from(await audioResponse.arrayBuffer()).toString('base64'),
      mimeType: audioResponse.headers.get('content-type') ?? 'audio/wav',
    }
  }

  // ── CosyVoice2: stream PCM response for low first-chunk latency ──
  if (isCosyVoiceSpeechOutputProvider(payload.providerId)) {
    const rawMode = payload.model || 'sft'
    const mode = (rawMode === 'sft' || rawMode === 'instruct') ? rawMode : 'sft'
    const formBody = new URLSearchParams()
    formBody.append('tts_text', content)
    formBody.append('spk_id', payload.voice || '中文女')
    if (mode === 'instruct') {
      formBody.append('instruct_text', payload.instructions?.trim() || '用自然亲切的语气说')
    }
    const bodyStr = formBody.toString()
    console.log('[CosyVoice] streaming synthesize:', mode, 'voice:', payload.voice || '中文女', 'text:', content.slice(0, 40))

    const url = new URL(`${baseUrl}/inference_${mode}`)
    const pcmStream = await new Promise((resolve, reject) => {
      let settled = false
      const settle = (fn, value) => { if (!settled) { settled = true; fn(value) } }

      const hardTimeout = setTimeout(() => {
        req.destroy()
        settle(reject, new Error('CosyVoice2 响应超时（硬超时）'))
      }, AUDIO_SYNTH_TIMEOUT_MS + 5_000)

      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        agent: cosyVoiceAgent,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
        timeout: AUDIO_SYNTH_TIMEOUT_MS,
      }, (res) => {
        clearTimeout(hardTimeout)
        if (res.statusCode !== 200) {
          const errorChunks = []
          res.on('data', (c) => errorChunks.push(c))
          res.on('end', () => {
            const body = Buffer.concat(errorChunks).toString('utf-8').slice(0, 500)
            console.error('[CosyVoice] 合成失败:', res.statusCode, body)
            settle(reject, new Error('CosyVoice2 合成失败（状态码：' + res.statusCode + '）' + body))
          })
          return
        }
        // Hand the live response stream back — ttsStreamService.emitStreamedPcmResult
        // will decode PCM chunks as they arrive, giving near-instant first-chunk playback.
        settle(resolve, res)
      })
      req.on('error', (err) => { clearTimeout(hardTimeout); settle(reject, new Error('CosyVoice2 服务连接失败：' + err.message)) })
      req.on('timeout', () => { req.destroy(); clearTimeout(hardTimeout); settle(reject, new Error('CosyVoice2 响应超时')) })
      req.write(bodyStr)
      req.end()
    })

    return { pcmStream, pcmSampleRate: 24000 }
  }

  // ── Edge TTS: Microsoft Edge Read Aloud, free, ultra-low latency ──
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

// ── Exports ──

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
  isCosyVoiceSpeechOutputProvider,
  isVolcengineSpeechOutputProvider,
  isVolcengineSpeechInputProvider,
  isOpenAiCompatibleSpeechInputProvider,
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
