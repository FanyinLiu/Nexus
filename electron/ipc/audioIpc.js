// @ts-check
import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { SPEECH_IPC_ERROR_CODES } from '../../shared/speechErrorCodes.js'
import {
  normalizeBaseUrl,
  performNetworkRequest,
  readJsonSafe,
  extractResponseErrorMessage,
  getVolcengineStatus,
  buildMultipartBody,
  createAudioFileName,
  normalizeLanguageCode,
  audioFormatToMimeType,
} from '../net.js'
import {
  buildAuthorizationHeaders,
  parseVolcengineSpeechCredentials,
  isOpenAiCompatibleSpeechOutputProvider,
  isOmniVoiceSpeechOutputProvider,
  isQwen3TtsSpeechOutputProvider,
  isMiniMaxSpeechOutputProvider,
  isDashScopeSpeechOutputProvider,
  isVolcengineSpeechOutputProvider,
  isVolcengineSpeechInputProvider,
  isOpenAiCompatibleSpeechInputProvider,
  isZhipuSpeechInputProvider,
  isXaiSpeechInputProvider,
  isXaiSpeechOutputProvider,
  resolveSpeechOutputBaseUrl,
  resolveSpeechOutputTimeoutMs,
  resolveSpeechOutputTimeoutMessage,
  assertSpeechOutputCredentials,
  toSpeechVoiceOption,
  extractMiniMaxVoiceOptions,
  buildOpenAiCompatibleSpeechRequestPayload,
  buildXaiSttMultipartParts,
  buildXaiTtsRequestBody,
  synthesizeVolcengineSpeechOutputWithFallback,
  formatVolcengineSpeechOutputCombo,
  mapLanguageToMiniMaxBoost,
  mapLanguageToDashScopeType,
  resolveDashScopeTtsModel,
} from '../services/ttsService.js'
import { synthesizeLocalTts } from '../services/localTts.js'
import { withSidecarAuth } from '../services/localServiceSecurity.js'
import { encodeWavFromFloat32 } from '../services/audioEncoding.js'
import { getRedactedErrorMessage, redactSensitiveErrorText } from '../services/errorRedaction.js'
import { extractSpeechInputText } from '../services/speechConnectionProof.js'
import { requireTrustedSender, requireString } from './validate.js'
import { mainT } from '../mainMessages.js'
import { resolveVaultRefsForSender } from '../services/vaultRefs.js'
import {
  validateAudioSynthesisPayload,
  validateAudioTranscriptionPayload,
  validateSpeechVoiceListPayload,
} from './payloadSchemas.js'

/**
 * @typedef {Object} MultipartPart
 * @property {string} type
 * @property {string} name
 * @property {Buffer} [data]
 * @property {string} [fileName]
 * @property {string} [mimeType]
 * @property {string} [value]
 */

/**
 * @typedef {Object} VolcengineSynthResult
 * @property {boolean} ok
 * @property {boolean} [usedFallback]
 * @property {string} [reason]
 * @property {string} [errorMessage]
 * @property {string} [audioBase64]
 * @property {string} [mimeType]
 * @property {string} [cluster]
 * @property {string} [voice]
 */

/**
 * @param {{ AUDIO_TRANSCRIBE_TIMEOUT_MS: number, AUDIO_VOICE_LIST_TIMEOUT_MS: number }} deps
 */
export function register({ AUDIO_TRANSCRIBE_TIMEOUT_MS, AUDIO_VOICE_LIST_TIMEOUT_MS }) {
  ipcMain.handle('audio:list-voices', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateSpeechVoiceListPayload(payload)
    payload = await resolveVaultRefsForSender(event.sender, payload, ['apiKey'])
    const baseUrl = normalizeBaseUrl(payload.baseUrl)

    if (!baseUrl) {
      throw new Error(mainT('audio.outputBaseUrlMissing'))
    }

    if (
      !isMiniMaxSpeechOutputProvider(payload.providerId)
      && payload.providerId !== 'elevenlabs-tts'
      && !isXaiSpeechOutputProvider(payload.providerId)
    ) {
      return {
        voices: [],
        message: mainT('audio.voiceListUnsupported'),
      }
    }
    assertSpeechOutputCredentials(payload.providerId, payload.apiKey)

    const request = isMiniMaxSpeechOutputProvider(payload.providerId)
      ? {
          url: `${baseUrl}/get_voice`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
          },
          body: JSON.stringify({
            voice_type: 'all',
          }),
        }
      : isXaiSpeechOutputProvider(payload.providerId)
        ? {
            url: `${baseUrl}/tts/voices`,
            method: 'GET',
            headers: buildAuthorizationHeaders(payload.providerId, payload.apiKey),
            body: undefined,
          }
        : {
            url: `${baseUrl}/voices`,
            method: 'GET',
            headers: buildAuthorizationHeaders(payload.providerId, payload.apiKey),
            body: undefined,
          }

    if (
      isOmniVoiceSpeechOutputProvider(payload.providerId)
      || isQwen3TtsSpeechOutputProvider(payload.providerId)
    ) {
      request.headers = withSidecarAuth(request.url, request.headers)
    }

    let response
    try {
      response = await performNetworkRequest(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body ? { body: request.body } : {}),
        allowPrivateNetwork: true,
        // Re-check every redirect hop (see chat:* GET probes) — non-streaming
        // voice-list, safe to follow with per-hop SSRF revalidation.
        followRedirectsSafely: true,
        timeoutMs: AUDIO_VOICE_LIST_TIMEOUT_MS,
        timeoutMessage: SPEECH_IPC_ERROR_CODES.TTS_TIMEOUT,
      })
    } catch (error) {
      const reason = getRedactedErrorMessage(error)
      throw new Error(mainT('audio.voiceListFetchFailed', { reason }), { cause: error })
    }

    const data = await readJsonSafe(response)

    if (!response.ok) {
      throw new Error(
        redactSensitiveErrorText(data?.error?.message ?? data?.detail?.message ?? data?.message)
          || mainT('audio.voiceListStatus', { status: response.status }),
      )
    }

    if (isMiniMaxSpeechOutputProvider(payload.providerId)) {
      if (Number(data?.base_resp?.status_code ?? 0) !== 0) {
        throw new Error(
          redactSensitiveErrorText(data?.base_resp?.status_msg ?? data?.message)
            || mainT('audio.minimaxVoiceListError'),
        )
      }

      const voices = extractMiniMaxVoiceOptions(data)
      return {
        voices,
        message: voices.length
          ? mainT('audio.minimaxVoicesFetched', { count: voices.length })
          : mainT('audio.minimaxVoiceListEmpty'),
      }
    }

    const voices = Array.isArray(data?.voices)
      ? data.voices
        .map((/** @type {unknown} */ item) => toSpeechVoiceOption(item))
        .filter(Boolean)
      : []

    return {
      voices,
      message: voices.length
        ? mainT('audio.voicesFetched', { count: voices.length })
        : mainT('audio.voiceListEmpty'),
    }
  })

  ipcMain.handle('audio:transcribe', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateAudioTranscriptionPayload(payload)
    payload = await resolveVaultRefsForSender(event.sender, payload, ['apiKey'])
    requireString(payload?.audioBase64, 'payload.audioBase64')

    if (payload.audioBase64.length > 50_000_000) {
      throw new Error('Audio payload exceeds 50MB limit.')
    }

    const baseUrl = normalizeBaseUrl(payload.baseUrl)

    if (!baseUrl) {
      throw new Error(mainT('audio.inputBaseUrlMissing'))
    }

    if (!payload.audioBase64) {
      throw new Error(mainT('audio.transcribeAudioMissing'))
    }

    console.info('[audio:transcribe] request', {
      traceId: payload.traceId ?? '',
      providerId: payload.providerId,
      model: payload.model,
      language: payload.language ?? '',
      mimeType: payload.mimeType,
    })

    let endpoint
    let body
    let headers

    if (isVolcengineSpeechInputProvider(payload.providerId)) {
      const credentials = parseVolcengineSpeechCredentials(payload.apiKey)
      if (!credentials.appId || !credentials.accessToken) {
        throw new Error(mainT('audio.volcengineInputCredentials'))
      }

      endpoint = `${baseUrl}/recognize/flash`
      body = JSON.stringify({
        user: {
          uid: credentials.appId || 'nexus',
        },
        audio: {
          data: payload.audioBase64,
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
    } else {
      /** @type {MultipartPart[]} */
      const multipartParts = [
        {
          type: 'file',
          name: 'file',
          data: Buffer.from(payload.audioBase64, 'base64'),
          fileName: createAudioFileName(payload.fileName, payload.mimeType),
          mimeType: payload.mimeType,
        },
      ]

      if (payload.providerId === 'elevenlabs-stt') {
        endpoint = `${baseUrl}/speech-to-text`
        multipartParts.push({
          type: 'field',
          name: 'model_id',
          value: payload.model || 'scribe_v2',
        })

        const languageCode = normalizeLanguageCode(payload.language)
        if (languageCode) {
          multipartParts.push({
            type: 'field',
            name: 'language_code',
            value: languageCode,
          })
        }
      } else if (isXaiSpeechInputProvider(payload.providerId)) {
        endpoint = `${baseUrl}/stt`
        multipartParts.length = 0
        multipartParts.push(...buildXaiSttMultipartParts({
          audioBuffer: Buffer.from(payload.audioBase64, 'base64'),
          fileName: createAudioFileName(payload.fileName, payload.mimeType),
          mimeType: payload.mimeType,
          language: payload.language,
          model: payload.model,
        }))
      } else if (isOpenAiCompatibleSpeechInputProvider(payload.providerId)) {
        endpoint = `${baseUrl}/audio/transcriptions`
        multipartParts.push({
          type: 'field',
          name: 'model',
          value: payload.model || (payload.providerId === 'openai-stt' || payload.providerId === 'custom-openai-stt' ? 'gpt-transcribe' : 'gpt-4o-mini-transcribe'),
        })

        const languageCode = normalizeLanguageCode(payload.language)
        if (languageCode) {
          multipartParts.push({
            type: 'field',
            name: 'language',
            value: languageCode,
          })
        }

        // ZhipuAI hotwords — improves recognition of names, terms, etc.
        if (isZhipuSpeechInputProvider(payload.providerId) && payload.hotwords) {
          const hotwordList = String(payload.hotwords)
            .split(/[,，\n]/)
            .map((w) => w.trim())
            .filter(Boolean)
          if (hotwordList.length > 0) {
            multipartParts.push({
              type: 'field',
              name: 'hotwords',
              value: JSON.stringify(hotwordList),
            })
          }
        }
      } else {
        throw new Error(mainT('audio.inputProviderUnsupported'))
      }

      const multipart = buildMultipartBody(multipartParts)
      body = multipart.body
      headers = {
        ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
        'Content-Type': multipart.contentType,
        'Content-Length': String(multipart.body.length),
      }
    }

    if (payload.providerId === 'glm-asr-local' && headers) {
      headers = withSidecarAuth(endpoint, headers)
    }

    let response
    try {
      response = await performNetworkRequest(endpoint, {
        method: 'POST',
        headers,
        body,
        allowPrivateNetwork: true,
        // Validate every redirect target so a public provider cannot bounce
        // an audio upload into metadata or a private-network endpoint.
        followRedirectsSafely: true,
        timeoutMs: AUDIO_TRANSCRIBE_TIMEOUT_MS,
        timeoutMessage: SPEECH_IPC_ERROR_CODES.STT_TIMEOUT,
      })
    } catch (error) {
      const reason = getRedactedErrorMessage(error)
      console.error('[audio:transcribe] network failure', {
        traceId: payload.traceId ?? '',
        providerId: payload.providerId,
        model: payload.model,
        reason,
      })
      throw new Error(mainT('audio.transcribeFetchFailed', { reason }), { cause: error })
    }

    const data = await readJsonSafe(response)

    if (isVolcengineSpeechInputProvider(payload.providerId)) {
      const volcStatus = getVolcengineStatus(response, data)
      if (volcStatus.code && volcStatus.code !== '20000000') {
        if (volcStatus.code === '20000003') {
          throw new Error(mainT('audio.transcribeNoSpeechDetected'))
        }

        throw new Error(
          redactSensitiveErrorText(volcStatus.message)
            || mainT('audio.volcengineTranscribeStatus', { status: volcStatus.code }),
        )
      }
    }

    if (!response.ok) {
      throw new Error(
        redactSensitiveErrorText(data?.error?.message ?? data?.detail?.message ?? data?.message)
          || mainT('audio.transcribeStatus', { status: response.status }),
      )
    }

    // Keep real recognition parsing correlated with connection-test proof
    // (text / transcript / nested result.text).
    const text = extractSpeechInputText(data)

    if (!text) {
      throw new Error(mainT('audio.transcribeEmpty'))
    }

    console.info('[audio:transcribe] success', {
      traceId: payload.traceId ?? '',
      providerId: payload.providerId,
      model: payload.model,
      textLength: text.length,
    })

    return { text }
  })

  ipcMain.handle('audio:synthesize', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateAudioSynthesisPayload(payload)
    payload = await resolveVaultRefsForSender(event.sender, payload, ['apiKey'])
    const content = String(payload.text ?? '').trim()

    if (!content) {
      throw new Error(mainT('audio.emptyText'))
    }

    // Local sherpa VITS: no base URL, no credentials; WAV out.
    if (payload.providerId === 'local-tts') {
      const speed = Number.isFinite(payload.rate) ? payload.rate : 1
      const { samples, sampleRate } = await synthesizeLocalTts(content, { speed })
      return {
        audioBase64: encodeWavFromFloat32(samples, sampleRate).toString('base64'),
        mimeType: 'audio/wav',
      }
    }

    const synthTimeoutMs = resolveSpeechOutputTimeoutMs()
    const synthTimeoutMessage = resolveSpeechOutputTimeoutMessage()

    const baseUrl = resolveSpeechOutputBaseUrl(payload.providerId, payload.baseUrl)
    const rate = Number.isFinite(payload.rate) ? payload.rate : 1
    const pitch = Number.isFinite(payload.pitch) ? payload.pitch : 1
    const volume = Number.isFinite(payload.volume) ? payload.volume : 1

    if (!baseUrl) {
      throw new Error(mainT('audio.outputBaseUrlMissing'))
    }
    assertSpeechOutputCredentials(payload.providerId, payload.apiKey)

    let endpoint
    let requestBody
    let headers

    if (payload.providerId === 'elevenlabs-tts') {
      if (!payload.voice) {
        throw new Error(mainT('audio.elevenLabsVoiceMissing'))
      }

      endpoint = `${baseUrl}/text-to-speech/${encodeURIComponent(payload.voice)}`
      requestBody = JSON.stringify({
        text: content,
        model_id: payload.model || 'eleven_multilingual_v2',
        ...(normalizeLanguageCode(payload.language)
          ? { language_code: normalizeLanguageCode(payload.language) }
          : {}),
      })
      headers = {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
      }
    } else if (isMiniMaxSpeechOutputProvider(payload.providerId)) {
      endpoint = `${baseUrl}/t2a_v2`
      requestBody = JSON.stringify({
        model: payload.model || 'speech-2.8-turbo',
        text: content,
        stream: false,
        voice_setting: {
          voice_id: payload.voice || 'female-shaonv',
          speed: Math.min(Math.max(rate, 0.5), 2),
          vol: Math.min(Math.max(volume, 0.1), 2),
          pitch: Number((pitch - 1).toFixed(2)),
        },
        audio_setting: {
          format: 'mp3',
          sample_rate: 32000,
          bitrate: 128000,
          channel: 1,
        },
        language_boost: mapLanguageToMiniMaxBoost(payload.language),
      })
      headers = {
        'Content-Type': 'application/json',
        ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
      }
    } else if (isVolcengineSpeechOutputProvider(payload.providerId)) {
      const credentials = parseVolcengineSpeechCredentials(payload.apiKey)
      if (!credentials.appId || !credentials.accessToken) {
        throw new Error(mainT('audio.volcengineOutputCredentials'))
      }

      /** @type {VolcengineSynthResult} */
      let result
      try {
        result = await synthesizeVolcengineSpeechOutputWithFallback({
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
      } catch (error) {
        const reason = getRedactedErrorMessage(error)
        throw new Error(mainT('audio.speechFetchFailed', { reason }), { cause: error })
      }

      if (!result.ok) {
        throw new Error(redactSensitiveErrorText(result.errorMessage))
      }

      if (result.usedFallback) {
        console.warn(
          `[Volcengine TTS] Automatically fell back to compatible combo ${formatVolcengineSpeechOutputCombo(result.cluster, result.voice)} (${redactSensitiveErrorText(result.reason)})`,
        )
      }

      return {
        audioBase64: result.audioBase64,
        mimeType: result.mimeType,
      }
    } else if (isDashScopeSpeechOutputProvider(payload.providerId)) {
      endpoint = `${baseUrl}/services/aigc/multimodal-generation/generation`
      requestBody = JSON.stringify({
        model: resolveDashScopeTtsModel(payload.model),
        input: {
          text: content,
          voice: payload.voice || 'Cherry',
          language_type: mapLanguageToDashScopeType(payload.language),
        },
      })
      headers = {
        'Content-Type': 'application/json',
        ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
      }
    } else if (isXaiSpeechOutputProvider(payload.providerId)) {
      endpoint = `${baseUrl}/tts`
      requestBody = JSON.stringify(buildXaiTtsRequestBody(payload, content))
      headers = {
        'Content-Type': 'application/json',
        ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
      }
    } else if (isOpenAiCompatibleSpeechOutputProvider(payload.providerId)) {
      endpoint = `${baseUrl}/audio/speech`
      requestBody = JSON.stringify(buildOpenAiCompatibleSpeechRequestPayload(payload, content))
      headers = {
        'Content-Type': 'application/json',
        ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
      }
    } else {
      throw new Error(mainT('audio.outputProviderUnsupported'))
    }

    if (
      headers
      && endpoint
      && (isOmniVoiceSpeechOutputProvider(payload.providerId)
        || isQwen3TtsSpeechOutputProvider(payload.providerId))
    ) {
      headers = withSidecarAuth(endpoint, headers)
    }

    let response
    try {
      response = await performNetworkRequest(endpoint, {
        method: 'POST',
        headers,
        body: requestBody,
        allowPrivateNetwork: true,
        followRedirectsSafely: true,
        timeoutMs: synthTimeoutMs,
        timeoutMessage: synthTimeoutMessage,
      })
    } catch (error) {
      const reason = getRedactedErrorMessage(error)
      throw new Error(mainT('audio.speechFetchFailed', { reason }), { cause: error })
    }

    if (!response.ok) {
      throw new Error(
        await extractResponseErrorMessage(response, mainT('audio.speechStatus', { status: response.status })),
      )
    }

    if (isMiniMaxSpeechOutputProvider(payload.providerId)) {
      const data = await readJsonSafe(response)

      if (Number(data?.base_resp?.status_code ?? 0) !== 0) {
        throw new Error(
          redactSensitiveErrorText(data?.base_resp?.status_msg ?? data?.message)
            || mainT('audio.minimaxSpeechError'),
        )
      }

      const audioHex = String(data?.data?.audio ?? '').trim()
      if (!audioHex) {
        throw new Error(mainT('audio.minimaxNoAudio'))
      }

      return {
        audioBase64: Buffer.from(audioHex, 'hex').toString('base64'),
        mimeType: audioFormatToMimeType(data?.extra_info?.audio_format ?? 'mp3'),
      }
    }

    if (isDashScopeSpeechOutputProvider(payload.providerId)) {
      const data = await readJsonSafe(response)
      const audioUrl = String(data?.output?.audio?.url ?? data?.output?.audio_url ?? '').trim()

      if (!audioUrl) {
        throw new Error(mainT('audio.dashscopeNoAudioUrl'))
      }

      let audioResponse
      try {
        audioResponse = await performNetworkRequest(audioUrl, {
          method: 'GET',
          followRedirectsSafely: true,
          timeoutMs: synthTimeoutMs,
          timeoutMessage: SPEECH_IPC_ERROR_CODES.TTS_TIMEOUT,
        })
      } catch (error) {
        const reason = getRedactedErrorMessage(error)
        throw new Error(mainT('audio.dashscopeDownloadFailed', { reason }), { cause: error })
      }

      if (!audioResponse.ok) {
        throw new Error(
          await extractResponseErrorMessage(audioResponse, mainT('audio.dashscopeStatus', { status: audioResponse.status })),
        )
      }

      return {
        audioBase64: Buffer.from(await audioResponse.arrayBuffer()).toString('base64'),
        mimeType: audioResponse.headers.get('content-type') ?? 'audio/wav',
      }
    }

    const audioBase64 = Buffer.from(await response.arrayBuffer()).toString('base64')
    const mimeType = response.headers.get('content-type') ?? 'audio/mpeg'

    return {
      audioBase64,
      mimeType,
    }
  })
}
