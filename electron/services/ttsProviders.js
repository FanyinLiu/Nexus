export const SPEECH_PROVIDER_IDS = Object.freeze({
  volcengineSTT:  'volcengine-stt',
  volcengineTTS:  'volcengine-tts',
  minimax:        'minimax-tts',
  dashscope:      'dashscope-tts',
  omnivoice:      'omnivoice-tts',
  edgeTts:        'edge-tts',
  openaiSTT:      'openai-stt',
  zhipuSTT:       'zhipu-stt',
  glmAsrLocal:    'glm-asr-local',
  customOpenaiSTT:'custom-openai-stt',
  openaiTTS:      'openai-tts',
  customOpenaiTTS:'custom-openai-tts',
})

export const isElevenLabsProvider             = (id) => String(id ?? '').startsWith('elevenlabs')
export const isVolcengineSpeechInputProvider  = (id) => id === SPEECH_PROVIDER_IDS.volcengineSTT
export const isVolcengineSpeechOutputProvider = (id) => id === SPEECH_PROVIDER_IDS.volcengineTTS
export const isMiniMaxSpeechOutputProvider    = (id) => id === SPEECH_PROVIDER_IDS.minimax
export const isDashScopeSpeechOutputProvider  = (id) => id === SPEECH_PROVIDER_IDS.dashscope
export const isOmniVoiceSpeechOutputProvider  = (id) => id === SPEECH_PROVIDER_IDS.omnivoice
export const isEdgeTtsSpeechOutputProvider    = (id) => id === SPEECH_PROVIDER_IDS.edgeTts

const OPENAI_COMPATIBLE_STT_IDS = new Set([
  SPEECH_PROVIDER_IDS.openaiSTT,
  SPEECH_PROVIDER_IDS.zhipuSTT,
  SPEECH_PROVIDER_IDS.glmAsrLocal,
  SPEECH_PROVIDER_IDS.customOpenaiSTT,
])
export const isOpenAiCompatibleSpeechInputProvider = (id) => OPENAI_COMPATIBLE_STT_IDS.has(id)
export const isZhipuSpeechInputProvider = (id) => id === SPEECH_PROVIDER_IDS.zhipuSTT

const OPENAI_COMPATIBLE_TTS_IDS = new Set([
  SPEECH_PROVIDER_IDS.openaiTTS,
  SPEECH_PROVIDER_IDS.customOpenaiTTS,
  SPEECH_PROVIDER_IDS.omnivoice,
])
export const isOpenAiCompatibleSpeechOutputProvider = (id) => OPENAI_COMPATIBLE_TTS_IDS.has(id)

export function parseVolcengineSpeechCredentials(apiKey) {
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

export function getSpeechOutputCredentialError(providerId, apiKey) {
  const normalizedKey = String(apiKey ?? '').trim()

  if (
    isEdgeTtsSpeechOutputProvider(providerId)
    || isOmniVoiceSpeechOutputProvider(providerId)
    || providerId === SPEECH_PROVIDER_IDS.customOpenaiTTS
  ) {
    return ''
  }

  if (isVolcengineSpeechOutputProvider(providerId)) {
    const credentials = parseVolcengineSpeechCredentials(normalizedKey)
    return credentials.appId && credentials.accessToken
      ? ''
      : '火山语音合成请在 API Key 一栏填写 APP_ID:ACCESS_TOKEN。'
  }

  if (!normalizedKey) {
    if (isMiniMaxSpeechOutputProvider(providerId)) return 'MiniMax 语音合成请先填写 API Key。'
    if (isDashScopeSpeechOutputProvider(providerId)) return '百炼语音合成请先填写 API Key。'
    if (isElevenLabsProvider(providerId)) return 'ElevenLabs 语音合成请先填写 API Key。'
    if (isOpenAiCompatibleSpeechOutputProvider(providerId)) return 'OpenAI 语音合成请先填写 API Key。'
  }

  return ''
}

export function assertSpeechOutputCredentials(providerId, apiKey) {
  const error = getSpeechOutputCredentialError(providerId, apiKey)
  if (error) throw new Error(error)
}
