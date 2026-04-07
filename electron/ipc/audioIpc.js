import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
let _sherpaTtsService = null
function getSherpaTtsService() {
  if (!_sherpaTtsService) {
    _sherpaTtsService = import('../sherpaTts.js')
  }
  return _sherpaTtsService
}
import { decodePcm16LeBufferToFloat32, encodeFloat32ToWav, enhanceSpeechSamples } from '../audioPostprocess.js'
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
  isLocalQwen3TtsSpeechOutputProvider,
  isPiperSpeechOutputProvider,
  isCoquiSpeechOutputProvider,
  isLocalCliSpeechOutputProvider,
  isElevenLabsProvider,
  isOpenAiCompatibleSpeechOutputProvider,
  isMiniMaxSpeechOutputProvider,
  isDashScopeSpeechOutputProvider,
  isCosyVoiceSpeechOutputProvider,
  isFishSpeechSpeechOutputProvider,
  isVolcengineSpeechOutputProvider,
  isVolcengineSpeechInputProvider,
  isOpenAiCompatibleSpeechInputProvider,
  resolveSpeechOutputBaseUrl,
  resolveSpeechOutputTimeoutMs,
  resolveSpeechOutputTimeoutMessage,
  ensureLocalQwen3TtsService,
  toSpeechVoiceOption,
  extractMiniMaxVoiceOptions,
  buildOpenAiCompatibleSpeechRequestPayload,
  synthesizePiperSpeechOutput,
  synthesizeCoquiSpeechOutput,
  synthesizeVolcengineSpeechOutputWithFallback,
  formatVolcengineSpeechOutputCombo,
  mapLanguageToMiniMaxBoost,
  mapLanguageToDashScopeType,
} from '../services/ttsService.js'

export function register({ AUDIO_TRANSCRIBE_TIMEOUT_MS, AUDIO_SYNTH_TIMEOUT_MS, AUDIO_VOICE_LIST_TIMEOUT_MS, VOICE_CLONE_TIMEOUT_MS }) {
  ipcMain.handle('audio:list-voices', async (_event, payload) => {
    if (payload.providerId === 'local-sherpa-tts') {
      const sherpaTtsService = await getSherpaTtsService()
      if (!sherpaTtsService.isAvailable()) {
        return {
          voices: [],
          message: '本地 Sherpa TTS 当前不可用，请先确认模型目录完整。',
        }
      }

      const voices = await sherpaTtsService.listVoices()
      return {
        voices,
        message: voices.length
          ? `已识别到 ${voices.length} 个本地 Sherpa speaker。`
          : '本地 Sherpa TTS 当前没有返回可用 speaker。',
      }
    }

    if (isLocalCliSpeechOutputProvider(payload.providerId)) {
      return {
        voices: [],
        message: 'This local CLI provider does not expose a voice list API. Fill the speaker / voice field manually if your Piper or Coqui model supports it.',
      }
    }

    if (isFishSpeechSpeechOutputProvider(payload.providerId)) {
      const fishBaseUrl = normalizeBaseUrl(payload.baseUrl) || 'http://127.0.0.1:8080'
      let fishResponse
      try {
        fishResponse = await performNetworkRequest(`${fishBaseUrl}/v1/models`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          timeoutMs: AUDIO_VOICE_LIST_TIMEOUT_MS,
          timeoutMessage: 'Fish Speech 音色列表拉取超时，请检查服务是否已启动。',
        })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`Fish Speech 音色列表请求失败：${reason}`)
      }

      const fishData = await readJsonSafe(fishResponse)

      if (!fishResponse.ok) {
        throw new Error(
          fishData?.detail ?? fishData?.message ?? `Fish Speech 音色列表请求失败（状态码：${fishResponse.status}）`,
        )
      }

      const fishVoices = Array.isArray(fishData)
        ? fishData.map((item) => ({
            id: String(item?.id ?? item?.name ?? ''),
            label: String(item?.name ?? item?.id ?? ''),
            description: item?.description || '',
          })).filter((v) => v.id)
        : Array.isArray(fishData?.data)
          ? fishData.data.map((item) => ({
              id: String(item?.id ?? item?.name ?? ''),
              label: String(item?.name ?? item?.id ?? ''),
              description: item?.description || '',
            })).filter((v) => v.id)
          : []

      return {
        voices: fishVoices,
        message: fishVoices.length
          ? `已拉取 ${fishVoices.length} 个 Fish Speech 参考音色。`
          : 'Fish Speech 服务已响应，但当前没有返回可用参考音色。可在 voice 栏留空使用默认音色。',
      }
    }

    const baseUrl = isLocalQwen3TtsSpeechOutputProvider(payload.providerId)
      ? await ensureLocalQwen3TtsService(payload.baseUrl, payload.model)
      : normalizeBaseUrl(payload.baseUrl)

    if (!baseUrl) {
      throw new Error('请先填写语音输出 API Base URL。')
    }

    if (
      !isMiniMaxSpeechOutputProvider(payload.providerId)
      && payload.providerId !== 'elevenlabs-tts'
      && payload.providerId !== 'local-qwen3-tts'
    ) {
      return {
        voices: [],
        message: '当前语音提供商暂未内置音色列表接口。',
      }
    }

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
        timeoutMs: AUDIO_VOICE_LIST_TIMEOUT_MS,
        timeoutMessage: '音色列表拉取超时，请检查网络或稍后重试。',
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`音色列表请求失败，请检查 URL、网络或代理设置。原始错误：${reason}`)
    }

    const data = await readJsonSafe(response)

    if (!response.ok) {
      throw new Error(
        data?.error?.message
          ?? data?.detail?.message
          ?? data?.message
          ?? `音色列表请求失败（状态码：${response.status}）`,
      )
    }

    if (isMiniMaxSpeechOutputProvider(payload.providerId)) {
      if (Number(data?.base_resp?.status_code ?? 0) !== 0) {
        throw new Error(
          data?.base_resp?.status_msg
          ?? data?.message
          ?? 'MiniMax 音色接口返回了异常状态。',
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

  ipcMain.handle('audio:transcribe', async (_event, payload) => {
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
      baseUrl,
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
        timeoutMs: AUDIO_TRANSCRIBE_TIMEOUT_MS,
        timeoutMessage: '语音识别响应超时，请检查网络、代理或当前语音服务状态。',
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.error('[audio:transcribe] network failure', {
        traceId: payload.traceId ?? '',
        providerId: payload.providerId,
        baseUrl,
        model: payload.model,
        reason,
      })
      throw new Error(`语音识别接口连接失败，请检查 URL、网络或代理设置。原始错误：${reason}`)
    }

    const data = await readJsonSafe(response)

    if (isVolcengineSpeechInputProvider(payload.providerId)) {
      const volcStatus = getVolcengineStatus(response, data)
      if (volcStatus.code && volcStatus.code !== '20000000') {
        if (volcStatus.code === '20000003') {
          throw new Error('这次没有听到清晰的人声，可以再说一遍。')
        }

        throw new Error(
          volcStatus.message || `火山语音识别请求失败（状态码：${volcStatus.code}）`,
        )
      }
    }

    if (!response.ok) {
      throw new Error(
        data?.error?.message
          ?? data?.detail?.message
          ?? data?.message
          ?? `语音识别请求失败（状态码：${response.status}）`,
      )
    }

    const text = String(data?.text ?? data?.transcript ?? '').trim()

    if (!text) {
      throw new Error('语音识别返回了空文本，请检查录音内容或模型设置。')
    }

    console.info('[audio:transcribe] success', {
      traceId: payload.traceId ?? '',
      providerId: payload.providerId,
      model: payload.model,
      textLength: text.length,
    })

    return { text }
  })

  ipcMain.handle('audio:synthesize', async (_event, payload) => {
    const content = String(payload.text ?? '').trim()

    if (!content) {
      throw new Error('没有可播报的文本内容。')
    }

    const synthTimeoutMs = resolveSpeechOutputTimeoutMs(payload.providerId, content, payload.model)
    const synthTimeoutMessage = resolveSpeechOutputTimeoutMessage(payload.providerId)

    if (payload.providerId === 'local-sherpa-tts') {
      const sherpaTtsService = await getSherpaTtsService()
      const rate = Number.isFinite(payload.rate) ? payload.rate : 1
      try {
        return await sherpaTtsService.synthesize(content, {
          speed: rate,
          sid: payload.voice,
        })
      } catch (err) {
        console.error('[SherpaTTS] synthesize error:', err)
        throw new Error(`本地 TTS 合成失败：${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (isPiperSpeechOutputProvider(payload.providerId)) {
      return synthesizePiperSpeechOutput(payload, content, synthTimeoutMs, synthTimeoutMessage)
    }

    if (isCoquiSpeechOutputProvider(payload.providerId)) {
      return synthesizeCoquiSpeechOutput(payload, content, synthTimeoutMs, synthTimeoutMessage)
    }

    const baseUrl = isLocalQwen3TtsSpeechOutputProvider(payload.providerId)
      ? await ensureLocalQwen3TtsService(payload.baseUrl, payload.model)
      : resolveSpeechOutputBaseUrl(payload.providerId, payload.baseUrl)
    const rate = Number.isFinite(payload.rate) ? payload.rate : 1
    const pitch = Number.isFinite(payload.pitch) ? payload.pitch : 1
    const volume = Number.isFinite(payload.volume) ? payload.volume : 1

    if (!baseUrl) {
      throw new Error('请先填写语音输出 API Base URL。')
    }

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
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`语音播报接口连接失败，请检查 URL、网络或代理设置。原始错误：${reason}`)
      }

      if (!result.ok) {
        throw new Error(result.errorMessage)
      }

      if (result.usedFallback) {
        console.warn(
          `[Volcengine TTS] 已自动回退到兼容组合 ${formatVolcengineSpeechOutputCombo(result.cluster, result.voice)} (${result.reason})`,
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
    } else if (isCosyVoiceSpeechOutputProvider(payload.providerId)) {
      const http = await import('node:http')
      const rawMode = payload.model || 'sft'
      const mode = (rawMode === 'sft' || rawMode === 'instruct') ? rawMode : 'sft'
      const cosyEndpoint = `${baseUrl}/inference_${mode}`
      const formData = new URLSearchParams()
      formData.append('tts_text', content)
      formData.append('spk_id', payload.voice || '中文女')
      if (mode === 'instruct') {
        formData.append('instruct_text', payload.instructions?.trim() || '用自然亲切的语气说')
      }
      console.log('[CosyVoice] synthesize:', mode, 'voice:', payload.voice || '中文女', 'text:', content.slice(0, 40))

      const cosyBodyStr = formData.toString()
      const cosyUrl = new URL(cosyEndpoint)
      const pcmBuffer = await new Promise((resolve, reject) => {
        const req = http.default.request({
          hostname: cosyUrl.hostname,
          port: cosyUrl.port,
          path: cosyUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(cosyBodyStr),
          },
          timeout: synthTimeoutMs,
        }, (res) => {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            if (res.statusCode !== 200) {
              const body = Buffer.concat(chunks).toString('utf-8').slice(0, 500)
              console.error('[CosyVoice] 合成失败:', res.statusCode, body)
              reject(new Error('CosyVoice2 合成失败（状态码：' + res.statusCode + '）' + body))
              return
            }
            resolve(Buffer.concat(chunks))
          })
        })
        req.on('error', (err) => reject(new Error('CosyVoice2 服务连接失败：' + err.message)))
        req.on('timeout', () => { req.destroy(); reject(new Error('语音播报响应超时，请检查 CosyVoice2 服务是否已启动。')) })
        req.write(cosyBodyStr)
        req.end()
      })
      const sampleRate = 24000
      const wavBuffer = encodeFloat32ToWav(
        enhanceSpeechSamples(
          decodePcm16LeBufferToFloat32(pcmBuffer),
          sampleRate,
          {
            prependSilenceMs: 18,
            fadeInMs: 12,
            fadeOutMs: 8,
          },
        ),
        sampleRate,
      )

      return {
        audioBase64: wavBuffer.toString('base64'),
        mimeType: 'audio/wav',
      }
    } else if (isFishSpeechSpeechOutputProvider(payload.providerId)) {
      const fishBaseUrl = normalizeBaseUrl(payload.baseUrl) || 'http://127.0.0.1:8080'
      const endpoint = `${fishBaseUrl}/v1/tts`

      const fishRequestBody = JSON.stringify({
        text: content,
        reference_id: payload.voice || undefined,
        format: 'wav',
        streaming: false,
      })

      let fishResponse
      try {
        fishResponse = await performNetworkRequest(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: fishRequestBody,
          timeoutMs: synthTimeoutMs,
          timeoutMessage: 'Fish Speech 合成超时，请检查服务是否已启动。',
        })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`Fish Speech 连接失败：${reason}`)
      }

      if (!fishResponse.ok) {
        throw new Error(await extractResponseErrorMessage(fishResponse, `Fish Speech 合成失败（状态码：${fishResponse.status}）`))
      }

      const audioBase64 = Buffer.from(await fishResponse.arrayBuffer()).toString('base64')
      return { audioBase64, mimeType: 'audio/wav' }
    } else {
      throw new Error('当前语音输出提供商暂未接通。')
    }

    let response
    try {
      response = await performNetworkRequest(endpoint, {
        method: 'POST',
        headers,
        body: requestBody,
        timeoutMs: synthTimeoutMs,
        timeoutMessage: synthTimeoutMessage,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`语音播报接口连接失败，请检查 URL、网络或代理设置。原始错误：${reason}`)
    }

    if (!response.ok) {
      throw new Error(
        await extractResponseErrorMessage(response, '语音播报请求失败（状态码：' + response.status + '）'),
      )
    }

    if (isMiniMaxSpeechOutputProvider(payload.providerId)) {
      const data = await readJsonSafe(response)

      if (Number(data?.base_resp?.status_code ?? 0) !== 0) {
        throw new Error(
          data?.base_resp?.status_msg
          ?? data?.message
          ?? 'MiniMax 语音接口返回了异常状态。',
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
          timeoutMs: synthTimeoutMs,
          timeoutMessage: '语音文件下载超时，请检查网络或稍后重试。',
        })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`百炼音频文件下载失败。原始错误：${reason}`)
      }

      if (!audioResponse.ok) {
        throw new Error(
          await extractResponseErrorMessage(audioResponse, '百炼音频下载失败（状态码：' + audioResponse.status + '）'),
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

  ipcMain.handle('voice:clone', async (_event, payload) => {
    const baseUrl = normalizeBaseUrl(payload.baseUrl)

    if (!baseUrl) {
      throw new Error('请先填写语音克隆 API Base URL。')
    }

    if (payload.providerId !== 'elevenlabs-ivc') {
      throw new Error('当前语音克隆提供商暂未接通。')
    }

    if (!payload.name?.trim()) {
      throw new Error('请先填写克隆音色名称。')
    }

    if (!Array.isArray(payload.files) || payload.files.length === 0) {
      throw new Error('请至少上传一段语音样本。')
    }

    const multipartParts = [
      {
        type: 'field',
        name: 'name',
        value: payload.name.trim(),
      },
    ]

    if (payload.description?.trim()) {
      multipartParts.push({
        type: 'field',
        name: 'description',
        value: payload.description.trim(),
      })
    }

    multipartParts.push({
      type: 'field',
      name: 'remove_background_noise',
      value: String(payload.removeBackgroundNoise ?? true),
    })

    for (const file of payload.files) {
      multipartParts.push({
        type: 'file',
        name: 'files',
        data: Buffer.from(file.dataBase64, 'base64'),
        fileName: file.name || 'sample.wav',
        mimeType: file.mimeType,
      })
    }

    const multipart = buildMultipartBody(multipartParts)

    let response
    try {
      response = await performNetworkRequest(`${baseUrl}/voices/add`, {
        method: 'POST',
        headers: {
          ...buildAuthorizationHeaders(payload.providerId, payload.apiKey),
          'Content-Type': multipart.contentType,
          'Content-Length': String(multipart.body.length),
        },
        body: multipart.body,
        timeoutMs: VOICE_CLONE_TIMEOUT_MS,
        timeoutMessage: '语音克隆上传超时，请检查网络、样本大小或稍后重试。',
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`语音克隆接口连接失败，请检查 URL、网络或代理设置。原始错误：${reason}`)
    }

    const data = await readJsonSafe(response)

    if (!response.ok) {
      throw new Error(
        data?.error?.message
          ?? data?.detail?.message
          ?? data?.message
          ?? `语音克隆请求失败（状态码：${response.status}）`,
      )
    }

    const voiceId = String(data?.voice_id ?? '').trim()

    if (!voiceId) {
      throw new Error('语音克隆已返回成功状态，但没有拿到 voice_id。')
    }

    return {
      voiceId,
      message: `克隆成功，新的 voice_id: ${voiceId}`,
    }
  })
}
