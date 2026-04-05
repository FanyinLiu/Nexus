import { randomUUID } from 'node:crypto'

import { performNetworkRequest, readJsonSafe, getVolcengineStatus, buildMultipartBody, normalizeLanguageCode } from '../net.js'
import { isVolcengineSpeechInputProvider, isOpenAiCompatibleSpeechInputProvider, parseVolcengineSpeechCredentials, buildAuthorizationHeaders, createSilentWavBase64, synthesizeRemoteTts } from './ttsService.js'

const CONNECTION_TEST_TIMEOUT_MS = 12_000

function isSpeechInputNoSpeechMessage(message) {
  return /no[\s-]?speech|silence|empty transcript|no transcript|speech not detected|didn['']?t contain speech|未检测到语音|没有听到|静音|无语音|空文本/i.test(
    String(message ?? '').trim(),
  )
}

function buildSpeechInputConnectionSuccessMessage(data) {
  const text = String(data?.text ?? data?.transcript ?? data?.result?.text ?? '').trim()
  if (text) {
    return `连接成功，识别接口已返回文本：${text}`
  }

  return '连接成功，接口已收到测试音频；静音样本没有识别出文本，这属于预期现象。'
}

function buildSpeechOutputConnectionSuccessMessage(result) {
  if (result?.pcmStream) {
    return '连接成功，已拿到流式测试音频。'
  }

  if (result?.pcmBuffer instanceof Buffer) {
    const sampleRate = Number(result.pcmSampleRate ?? 0)
    const durationSeconds = sampleRate > 0
      ? Number((result.pcmBuffer.length / (sampleRate * 2)).toFixed(1))
      : 0
    return durationSeconds > 0
      ? `连接成功，已拿到测试音频（约 ${durationSeconds} 秒）。`
      : '连接成功，已拿到测试音频。'
  }

  if (typeof result?.audioBase64 === 'string' && result.audioBase64.trim()) {
    return '连接成功，已拿到测试音频。'
  }

  return '连接成功，语音接口已正常响应。'
}

async function runSpeechInputConnectionSmokeTest(payload, baseUrl) {
  const testAudioBase64 = createSilentWavBase64(1_200)
  let endpoint = ''
  let body = null
  let headers = {}

  if (isVolcengineSpeechInputProvider(payload.providerId)) {
    const credentials = parseVolcengineSpeechCredentials(payload.apiKey)
    endpoint = `${baseUrl}/recognize/flash`
    body = JSON.stringify({
      user: {
        uid: credentials.appId || 'nexus',
      },
      audio: {
        data: testAudioBase64,
      },
      request: {
        model_name: payload.model || 'bigmodel',
      },
    })
    headers = {
      'Content-Type': 'application/json',
      'X-Api-App-Key': credentials.appId,
      'X-Api-Access-Key': credentials.accessToken,
      'X-Api-Resource-Id': 'volc.bigasr.auc_turbo',
      'X-Api-Request-Id': randomUUID(),
      'X-Api-Sequence': '-1',
    }
  } else if (payload.providerId === 'elevenlabs-stt' || isOpenAiCompatibleSpeechInputProvider(payload.providerId)) {
    const multipartParts = [
      {
        type: 'file',
        name: 'file',
        data: Buffer.from(testAudioBase64, 'base64'),
        fileName: 'nexus-connection-test.wav',
        mimeType: 'audio/wav',
      },
    ]

    if (payload.providerId === 'elevenlabs-stt') {
      endpoint = `${baseUrl}/speech-to-text`
      multipartParts.push({
        type: 'field',
        name: 'model_id',
        value: payload.model || 'scribe_v1',
      })

      const languageCode = normalizeLanguageCode(payload.language)
      if (languageCode) {
        multipartParts.push({
          type: 'field',
          name: 'language_code',
          value: languageCode,
        })
      }
    } else {
      endpoint = `${baseUrl}/audio/transcriptions`
      multipartParts.push({
        type: 'field',
        name: 'model',
        value: payload.model || 'gpt-4o-mini-transcribe',
      })

      const languageCode = normalizeLanguageCode(payload.language)
      if (languageCode) {
        multipartParts.push({
          type: 'field',
          name: 'language',
          value: languageCode,
        })
      }
    }

    const multipart = buildMultipartBody(multipartParts)
    body = multipart.body
    headers = {
      ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
      'Content-Type': multipart.contentType,
      'Content-Length': String(multipart.body.length),
    }
  } else {
    return {
      ok: false,
      message: '当前语音输入提供商暂未接通连接测试。',
    }
  }

  const response = await performNetworkRequest(endpoint, {
    method: 'POST',
    headers,
    body,
    timeoutMs: CONNECTION_TEST_TIMEOUT_MS,
    timeoutMessage: '服务连接测试超时，请检查 URL、网络、代理或服务状态。',
  })
  const data = await readJsonSafe(response)

  if (isVolcengineSpeechInputProvider(payload.providerId)) {
    const volcStatus = getVolcengineStatus(response, data)
    if (volcStatus.code && !['20000000', '20000003'].includes(volcStatus.code)) {
      return {
        ok: false,
        message: volcStatus.message || `火山语音识别接口返回异常状态：${volcStatus.code}`,
      }
    }

    return {
      ok: true,
      message: buildSpeechInputConnectionSuccessMessage(data),
    }
  }

  if (!response.ok) {
    const message =
      data?.error?.message
      ?? data?.detail?.message
      ?? data?.message
      ?? `语音识别请求失败（状态码：${response.status}）`

    if (isSpeechInputNoSpeechMessage(message)) {
      return {
        ok: true,
        message: '连接成功，接口已收到测试音频；静音样本没有识别出文本，这属于预期现象。',
      }
    }

    return {
      ok: false,
      message,
    }
  }

  return {
    ok: true,
    message: buildSpeechInputConnectionSuccessMessage(data),
  }
}

async function runSpeechOutputConnectionSmokeTest(payload, baseUrl) {
  const result = await synthesizeRemoteTts(
    {
      ...payload,
      baseUrl,
    },
    '你好，这是一次语音接口连通性测试。',
  )

  if (result?.pcmStream && typeof result.pcmStream.destroy === 'function') {
    result.pcmStream.destroy()
  }

  return {
    ok: true,
    message: buildSpeechOutputConnectionSuccessMessage(result),
  }
}

export {
  isSpeechInputNoSpeechMessage,
  buildSpeechInputConnectionSuccessMessage,
  buildSpeechOutputConnectionSuccessMessage,
  runSpeechInputConnectionSmokeTest,
  runSpeechOutputConnectionSmokeTest,
}
