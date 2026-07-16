import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
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
  isElevenLabsProvider,
  isOpenAiCompatibleSpeechOutputProvider,
  isMiniMaxSpeechOutputProvider,
  isDashScopeSpeechOutputProvider,
  isOmniVoiceSpeechOutputProvider,
  isVolcengineSpeechOutputProvider,
  isVolcengineSpeechInputProvider,
  isOpenAiCompatibleSpeechInputProvider,
  isZhipuSpeechInputProvider,
  resolveSpeechOutputBaseUrl,
  resolveSpeechOutputTimeoutMs,
  resolveSpeechOutputTimeoutMessage,
  assertSpeechOutputCredentials,
  toSpeechVoiceOption,
  extractMiniMaxVoiceOptions,
  buildOpenAiCompatibleSpeechRequestPayload,
  synthesizeVolcengineSpeechOutputWithFallback,
  formatVolcengineSpeechOutputCombo,
  mapLanguageToMiniMaxBoost,
  mapLanguageToDashScopeType,
} from '../services/ttsService.js'
import { synthesizeLocalTts } from '../services/localTts.js'
import { encodeWavFromFloat32 } from '../services/audioEncoding.js'
import { getRedactedErrorMessage, redactSensitiveErrorText } from '../services/errorRedaction.js'
import { extractSpeechInputText } from '../services/speechConnectionProof.js'
import { requireTrustedSender, requireString } from './validate.js'
import { resolveVaultRefsForSender } from '../services/vaultRefs.js'
import {
  validateAudioSynthesisPayload,
  validateAudioTranscriptionPayload,
  validateSpeechVoiceListPayload,
} from './payloadSchemas.js'

export function register({ AUDIO_TRANSCRIBE_TIMEOUT_MS, AUDIO_SYNTH_TIMEOUT_MS, AUDIO_VOICE_LIST_TIMEOUT_MS }) {
  ipcMain.handle('audio:list-voices', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateSpeechVoiceListPayload(payload)
    payload = await resolveVaultRefsForSender(event.sender, payload, ['apiKey'])
    const baseUrl = normalizeBaseUrl(payload.baseUrl)

    if (!baseUrl) {
      throw new Error('请先填写语音输出 API Base URL。')
    }

    if (
      !isMiniMaxSpeechOutputProvider(payload.providerId)
      && payload.providerId !== 'elevenlabs-tts'
    ) {
      return {
        voices: [],
        message: '当前语音提供商暂未内置音色列表接口。',
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
      : {
          url: `${baseUrl}/voices`,
          method: 'GET',
          headers: buildAuthorizationHeaders(payload.providerId, payload.apiKey),
          body: undefined,
        }

    let response
    try {
      response = await performNetworkRequest(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body ? { body: request.body } : {}),
        // Re-check every redirect hop (see chat:* GET probes) — non-streaming
        // voice-list, safe to follow with per-hop SSRF revalidation.
        followRedirectsSafely: true,
        timeoutMs: AUDIO_VOICE_LIST_TIMEOUT_MS,
        timeoutMessage: '音色列表拉了好久都没回来，看看网络对不对？',
      })
    } catch (error) {
      const reason = getRedactedErrorMessage(error)
      throw new Error(`音色列表没能拉到，看看地址和网络对不对？具体原因：${reason}`)
    }

    const data = await readJsonSafe(response)

    if (!response.ok) {
      throw new Error(
        redactSensitiveErrorText(data?.error?.message ?? data?.detail?.message ?? data?.message)
          || `音色列表那边回了个状态码 ${response.status}，不太确定哪里出了问题。`,
      )
    }

    if (isMiniMaxSpeechOutputProvider(payload.providerId)) {
      if (Number(data?.base_resp?.status_code ?? 0) !== 0) {
        throw new Error(
          redactSensitiveErrorText(data?.base_resp?.status_msg ?? data?.message)
            || 'MiniMax 音色接口返回了异常状态。',
        )
      }

      const voices = extractMiniMaxVoiceOptions(data)
      return {
        voices,
        message: voices.length
          ? `已拉取 ${voices.length} 个 MiniMax 音色。`
          : 'MiniMax 音色接口已响应，但当前没有返回可选音色。',
      }
    }

    const voices = Array.isArray(data?.voices)
      ? data.voices
        .map((item) => toSpeechVoiceOption(item))
        .filter(Boolean)
      : []

    return {
      voices,
      message: voices.length
        ? `已拉取 ${voices.length} 个可选音色。`
        : '音色接口已响应，但当前没有返回可选音色。',
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
      throw new Error('请先填写语音输入 API Base URL。')
    }

    if (!payload.audioBase64) {
      throw new Error('没有收到可识别的录音数据。')
    }

    console.info('[audio:transcribe] request', {
      traceId: payload.traceId ?? '',
      providerId: payload.providerId,
      model: payload.model,
      language: payload.language ?? '',
      mimeType: payload.mimeType,
    })

    let endpoint = ''
    let body = null
    let headers = {}

    if (isVolcengineSpeechInputProvider(payload.providerId)) {
      const credentials = parseVolcengineSpeechCredentials(payload.apiKey)
      if (!credentials.appId || !credentials.accessToken) {
        throw new Error('火山语音识别请在 API Key 一栏填写 APP_ID:ACCESS_TOKEN。')
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
      } else if (isOpenAiCompatibleSpeechInputProvider(payload.providerId)) {
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
        throw new Error('当前语音输入提供商暂未接通。')
      }

      const multipart = buildMultipartBody(multipartParts)
      body = multipart.body
      headers = {
        ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
        'Content-Type': multipart.contentType,
        'Content-Length': String(multipart.body.length),
      }
    }

    let response
    try {
      response = await performNetworkRequest(endpoint, {
        method: 'POST',
        headers,
        body,
        // Validate every redirect target so a public provider cannot bounce
        // an audio upload into metadata or a private-network endpoint.
        followRedirectsSafely: true,
        timeoutMs: AUDIO_TRANSCRIBE_TIMEOUT_MS,
        timeoutMessage: '语音识别那边等了好久都没回应，看看网络和代理对不对？',
      })
    } catch (error) {
      const reason = getRedactedErrorMessage(error)
      console.error('[audio:transcribe] network failure', {
        traceId: payload.traceId ?? '',
        providerId: payload.providerId,
        model: payload.model,
        reason,
      })
      throw new Error(`没能连上语音识别接口，看看地址和网络对不对？具体原因：${reason}`)
    }

    const data = await readJsonSafe(response)

    if (isVolcengineSpeechInputProvider(payload.providerId)) {
      const volcStatus = getVolcengineStatus(response, data)
      if (volcStatus.code && volcStatus.code !== '20000000') {
        if (volcStatus.code === '20000003') {
          throw new Error('这次没有听到清晰的人声，可以再说一遍。')
        }

        throw new Error(
          redactSensitiveErrorText(volcStatus.message)
            || `火山语音识别那边回了个状态码 ${volcStatus.code}，不太确定哪里出了问题。`,
        )
      }
    }

    if (!response.ok) {
      throw new Error(
        redactSensitiveErrorText(data?.error?.message ?? data?.detail?.message ?? data?.message)
          || `语音识别那边回了个状态码 ${response.status}，不太确定哪里出了问题。`,
      )
    }

    // Keep real recognition parsing correlated with connection-test proof
    // (text / transcript / nested result.text).
    const text = extractSpeechInputText(data)

    if (!text) {
      throw new Error('语音识别回来了但是没听到什么内容，可以再说一遍试试。')
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
      throw new Error('没有可播报的文本内容。')
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

    const synthTimeoutMs = resolveSpeechOutputTimeoutMs(payload.providerId, content, payload.model)
    const synthTimeoutMessage = resolveSpeechOutputTimeoutMessage(payload.providerId)

    const baseUrl = resolveSpeechOutputBaseUrl(payload.providerId, payload.baseUrl)
    const rate = Number.isFinite(payload.rate) ? payload.rate : 1
    const pitch = Number.isFinite(payload.pitch) ? payload.pitch : 1
    const volume = Number.isFinite(payload.volume) ? payload.volume : 1

    if (!baseUrl) {
      throw new Error('请先填写语音输出 API Base URL。')
    }
    assertSpeechOutputCredentials(payload.providerId, payload.apiKey)

    let endpoint = ''
    let requestBody = ''
    let headers = {}

    if (payload.providerId === 'elevenlabs-tts') {
      if (!payload.voice) {
        throw new Error('请先填写 ElevenLabs 的 voice_id，或先完成语音克隆。')
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
        throw new Error('火山语音合成请在 API Key 一栏填写 APP_ID:ACCESS_TOKEN。')
      }

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
        throw new Error(`没能连上语音播报接口，看看地址和网络对不对？具体原因：${reason}`)
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
        model: payload.model || 'qwen3-tts-instruct-flash',
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
    } else if (isOpenAiCompatibleSpeechOutputProvider(payload.providerId)) {
      endpoint = `${baseUrl}/audio/speech`
      requestBody = JSON.stringify(buildOpenAiCompatibleSpeechRequestPayload(payload, content))
      headers = {
        'Content-Type': 'application/json',
        ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
      }
    } else {
      throw new Error('当前语音输出提供商暂未接通。')
    }

    let response
    try {
      response = await performNetworkRequest(endpoint, {
        method: 'POST',
        headers,
        body: requestBody,
        followRedirectsSafely: true,
        timeoutMs: synthTimeoutMs,
        timeoutMessage: synthTimeoutMessage,
      })
    } catch (error) {
      const reason = getRedactedErrorMessage(error)
      throw new Error(`没能连上语音播报接口，看看地址和网络对不对？具体原因：${reason}`)
    }

    if (!response.ok) {
      throw new Error(
        await extractResponseErrorMessage(response, '语音播报那边回了个状态码 ' + response.status + '，不太确定哪里出了问题。'),
      )
    }

    if (isMiniMaxSpeechOutputProvider(payload.providerId)) {
      const data = await readJsonSafe(response)

      if (Number(data?.base_resp?.status_code ?? 0) !== 0) {
        throw new Error(
          redactSensitiveErrorText(data?.base_resp?.status_msg ?? data?.message)
            || 'MiniMax 语音接口返回了异常状态。',
        )
      }

      const audioHex = String(data?.data?.audio ?? '').trim()
      if (!audioHex) {
        throw new Error('MiniMax 语音接口没有返回可播放音频。')
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
        throw new Error('百炼语音接口没有返回音频地址。')
      }

      let audioResponse
      try {
        audioResponse = await performNetworkRequest(audioUrl, {
          method: 'GET',
          followRedirectsSafely: true,
          timeoutMs: synthTimeoutMs,
          timeoutMessage: '语音文件下载有点久，看看网络或者稍后再试试？',
        })
      } catch (error) {
        const reason = getRedactedErrorMessage(error)
        throw new Error(`百炼音频文件没下下来，具体原因：${reason}`)
      }

      if (!audioResponse.ok) {
        throw new Error(
          await extractResponseErrorMessage(audioResponse, '百炼音频那边回了个状态码 ' + audioResponse.status + '，不太确定哪里出了问题。'),
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
