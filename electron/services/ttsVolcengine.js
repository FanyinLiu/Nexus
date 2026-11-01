import { randomUUID } from 'node:crypto'
import { SPEECH_IPC_ERROR_CODES } from '../../shared/speechErrorCodes.js'
import {
  performNetworkRequest,
  readJsonSafe,
  readTextSafe,
  audioFormatToMimeType,
} from '../net.js'
import { buildAuthorizationHeaders, AUDIO_SYNTH_TIMEOUT_MS } from './ttsHelpers.js'
import { mainT } from '../mainMessages.js'

const VOLCENGINE_TTS_DEFAULT_CLUSTER = 'volcano_tts'
const VOLCENGINE_TTS_DEFAULT_VOICE = 'BV001_streaming'

function normalizeVolcengineSpeechOutputCluster(cluster) {
  return String(cluster ?? '').trim() || VOLCENGINE_TTS_DEFAULT_CLUSTER
}

function normalizeVolcengineSpeechOutputVoice(voice) {
  return String(voice ?? '').trim() || VOLCENGINE_TTS_DEFAULT_VOICE
}

export function formatVolcengineSpeechOutputCombo(cluster, voice) {
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
      message: mainT('ttsVolcengine.authFailed'),
    }
  }

  if (isVolcengineSpeechOutputGrantErrorMessage(rawMessage)) {
    return {
      code,
      rawMessage,
      isAuthError: false,
      isGrantError: true,
      isInitError: false,
      message: mainT('ttsVolcengine.voiceNotGranted'),
    }
  }

  if (isVolcengineSpeechOutputInitErrorMessage(rawMessage)) {
    return {
      code,
      rawMessage,
      isAuthError: false,
      isGrantError: false,
      isInitError: true,
      message: mainT('ttsVolcengine.initFailedHint'),
    }
  }

  if (rawMessage) {
    return {
      code,
      rawMessage,
      isAuthError: false,
      isGrantError: false,
      isInitError: false,
      message: code ? mainT('ttsVolcengine.errorWithCode', { code, message: rawMessage }) : rawMessage,
    }
  }

  return {
    code,
    rawMessage,
    isAuthError: false,
    isGrantError: false,
    isInitError: false,
    message: code
      ? mainT('ttsVolcengine.statusCode', { code })
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
      reason: 'current settings',
    },
    {
      cluster: initialCluster,
      voice: VOLCENGINE_TTS_DEFAULT_VOICE,
      reason: 'current cluster + generic female voice',
    },
    {
      cluster: VOLCENGINE_TTS_DEFAULT_CLUSTER,
      voice: VOLCENGINE_TTS_DEFAULT_VOICE,
      reason: 'default cluster + generic female voice',
    },
    {
      cluster: VOLCENGINE_TTS_DEFAULT_CLUSTER,
      voice: 'BV002_streaming',
      reason: 'default cluster + generic male voice',
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
    : mainT('ttsVolcengine.startFailed')
  const retriedMessage = attempts.length > 1
    ? mainT('ttsVolcengine.retriedCombos')
    : mainT('ttsVolcengine.attemptFailed')

  return `${prefix}${retriedMessage}${mainT('ttsVolcengine.failureAdvice')}`
}

function buildVolcengineSpeechOutputGrantFailureMessage(attempts) {
  const retriedMessage = attempts.length > 1
    ? mainT('ttsVolcengine.grantRetried')
    : mainT('ttsVolcengine.grantStillUnavailable')

  return `${mainT('ttsVolcengine.grantFailurePrefix')}${retriedMessage}${mainT('ttsVolcengine.grantAdvice')}`
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
  timeoutMessage = SPEECH_IPC_ERROR_CODES.TTS_TIMEOUT,
}) {
  const response = await performNetworkRequest(`${baseUrl}/v1/tts`, {
    allowPrivateNetwork: true,
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
  let data
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
        mainT('ttsVolcengine.speechStatus', { status: response.status }),
      )
      : null
    const errorMessage =
      details?.message
      || responseText.trim()
      || mainT('ttsVolcengine.speechStatus', { status: response.status })
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
      mainT('ttsVolcengine.apiAbnormal'),
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
      errorMessage: mainT('ttsVolcengine.noAudio'),
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

export async function synthesizeVolcengineSpeechOutputWithFallback(options) {
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
    finalError: lastFailure?.errorMessage ?? mainT('ttsVolcengine.startFailed'),
    finalRawMessage: lastFailure?.rawMessage ?? '',
  })

  return {
    ...(lastFailure ?? {
      ok: false,
      cluster: normalizeVolcengineSpeechOutputCluster(options.cluster),
      voice: normalizeVolcengineSpeechOutputVoice(options.voice),
      errorMessage: mainT('ttsVolcengine.startFailed'),
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
