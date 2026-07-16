import { randomUUID } from 'node:crypto'

import { performNetworkRequest, readJsonSafe, getVolcengineStatus, buildMultipartBody, normalizeLanguageCode } from '../net.js'
import { isVolcengineSpeechInputProvider, isOpenAiCompatibleSpeechInputProvider, parseVolcengineSpeechCredentials, buildAuthorizationHeaders, createSilentWavBase64, synthesizeRemoteTts } from './ttsService.js'
import {
  SPEECH_CONNECTION_MESSAGE,
  buildSpeechConnectionEvidence,
  buildSpeechConnectionResult,
  classifyOpenAiCompatibleSpeechInputProbe,
  classifySpeechOutputProbe,
  classifyVolcengineSpeechInputProbe,
  redactSpeechConnectionText,
} from './speechConnectionProof.js'

const CONNECTION_TEST_TIMEOUT_MS = 12_000

function releaseSpeechOutputResult(result) {
  if (result?.pcmStream && typeof result.pcmStream.destroy === 'function') {
    try {
      result.pcmStream.destroy()
    } catch {
      // ignore cleanup failures — proof classification already has bytes or not
    }
  }
}

function extractObservedSpeechInputIdentity(data) {
  return {
    observedModelId: String(
      data?.model
      ?? data?.model_id
      ?? data?.result?.model
      ?? '',
    ).trim() || undefined,
    observedProviderId: String(
      data?.provider
      ?? data?.provider_id
      ?? '',
    ).trim() || undefined,
  }
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
    return buildSpeechConnectionResult({
      ok: false,
      messageKey: SPEECH_CONNECTION_MESSAGE.INPUT_UNSUPPORTED,
      code: 'unknown_connection_error',
    })
  }

  const response = await performNetworkRequest(endpoint, {
    allowPrivateNetwork: true,
    method: 'POST',
    headers,
    body,
    timeoutMs: CONNECTION_TEST_TIMEOUT_MS,
    timeoutMessage: '连接测试等了好久，看看地址和网络对不对？',
  })
  const data = await readJsonSafe(response)
  const observed = extractObservedSpeechInputIdentity(data)

  if (isVolcengineSpeechInputProvider(payload.providerId)) {
    const volcStatus = getVolcengineStatus(response, data)
    const classified = classifyVolcengineSpeechInputProbe({ statusCode: volcStatus.code })
    if (!classified.ok) {
      return buildSpeechConnectionResult({
        ok: false,
        messageKey: classified.messageKey,
        code: classified.code,
        // Safe status code only — never raw provider body as the user message.
        messageParams: classified.providerStatusCode
          ? { statusCode: classified.providerStatusCode }
          : undefined,
        diagnosticDetail: volcStatus.message,
      })
    }

    const evidence = buildSpeechConnectionEvidence({
      kind: 'audio-response',
      providerId: payload.providerId,
      modelId: payload.model,
      observedProviderId: observed.observedProviderId,
      observedModelId: observed.observedModelId,
    })

    return buildSpeechConnectionResult({
      ok: true,
      messageKey: classified.messageKey,
      evidence,
      status: evidence.identityMismatch ? 'error' : 'ready',
    })
  }

  if (!response.ok) {
    const classified = classifyOpenAiCompatibleSpeechInputProbe({
      status: response.status,
      data,
    })

    if (classified.ok) {
      const evidence = buildSpeechConnectionEvidence({
        kind: 'audio-response',
        providerId: payload.providerId,
        modelId: payload.model,
        observedProviderId: observed.observedProviderId,
        observedModelId: observed.observedModelId,
      })
      return buildSpeechConnectionResult({
        ok: true,
        messageKey: classified.messageKey,
        evidence,
        status: evidence.identityMismatch ? 'error' : 'ready',
      })
    }

    // Prefer structured code + key; keep a redacted transport fallback only when
    // the provider did not yield a classifiable envelope.
    const redactedDetail = redactSpeechConnectionText(
      data?.error?.message
      ?? data?.detail?.message
      ?? data?.message
      ?? '',
    )

    return buildSpeechConnectionResult({
      ok: false,
      messageKey: classified.messageKey,
      code: classified.code || 'provider_error',
      messageParams: { status: response.status },
      diagnosticDetail: redactedDetail,
    })
  }

  const classified = classifyOpenAiCompatibleSpeechInputProbe({
    status: response.status,
    data,
  })

  if (!classified.ok) {
    return buildSpeechConnectionResult({
      ok: false,
      messageKey: classified.messageKey,
      code: classified.code || 'invalid_probe_response',
    })
  }

  const evidence = buildSpeechConnectionEvidence({
    kind: 'audio-response',
    providerId: payload.providerId,
    modelId: payload.model,
    observedProviderId: observed.observedProviderId,
    observedModelId: observed.observedModelId,
  })

  return buildSpeechConnectionResult({
    ok: true,
    messageKey: classified.messageKey,
    evidence,
    status: evidence.identityMismatch ? 'error' : 'ready',
  })
}

async function runSpeechOutputConnectionSmokeTest(payload, baseUrl) {
  const result = await synthesizeRemoteTts(
    {
      ...payload,
      baseUrl,
    },
    '你好，这是一次语音接口连通性测试。',
  )

  try {
    return classifySpeechOutputProbe(result, {
      providerId: payload.providerId,
      modelId: payload.model,
      voiceId: payload.voice,
    })
  } finally {
    releaseSpeechOutputResult(result)
  }
}

export {
  runSpeechInputConnectionSmokeTest,
  runSpeechOutputConnectionSmokeTest,
}
