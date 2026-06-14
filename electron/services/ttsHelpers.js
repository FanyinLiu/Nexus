import { normalizeBaseUrl, normalizeLanguageCode } from '../net.js'
import {
  isEdgeTtsSpeechOutputProvider,
  isElevenLabsProvider,
  isOmniVoiceSpeechOutputProvider,
  isVolcengineSpeechOutputProvider,
  parseVolcengineSpeechCredentials,
} from './ttsProviders.js'

export const AUDIO_SYNTH_TIMEOUT_MS = 25_000

export function resolveSpeechOutputBaseUrl(providerId, baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl)

  if (isOmniVoiceSpeechOutputProvider(providerId)) {
    return normalized || 'http://127.0.0.1:8000/v1'
  }

  // Edge TTS talks to a fixed Microsoft WebSocket endpoint and doesn't
  // use an HTTP baseUrl, but the !baseUrl gate in ttsService.js rejects
  // empty strings for every provider. Return a marker so that gate passes
  // — the actual Edge TTS branch never reads this value. Without it,
  // selecting Edge TTS (no URL needed) triggers
  // "请先填写语音输出 API Base URL。" and no audio plays.
  if (isEdgeTtsSpeechOutputProvider(providerId)) {
    return normalized || 'wss://speech.platform.bing.com'
  }

  return normalized
}

export function resolveSpeechOutputTimeoutMs() {
  return AUDIO_SYNTH_TIMEOUT_MS
}

export function resolveSpeechOutputTimeoutMessage() {
  return '语音播报等了好久都没回应，看看网络和代理对不对？'
}

export function buildOpenAiCompatibleSpeechRequestPayload(payload, content, options = {}) {
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

export function buildAuthorizationHeaders(providerId, apiKey) {
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

export function toSpeechVoiceOption(item) {
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

export function extractMiniMaxVoiceOptions(data) {
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

export function createSilentWavBase64(durationMs = 450, sampleRate = 16000) {
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

export function mapLanguageToMiniMaxBoost(language) {
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

export function mapLanguageToDashScopeType(language) {
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
