import { app, BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import sherpaAsrService from './sherpaAsr.js'
import sherpaKwsService from './sherpaKws.js'
import * as sherpaTtsService from './sherpaTts.js'
import { decodePcm16LeBufferToFloat32, encodeFloat32ToWav, enhanceSpeechSamples } from './audioPostprocess.js'
import { inspectIntegrationRuntime, splitCommandLine } from './integrationRuntime.js'
import * as mcpHost from './services/mcpHost.js'
import { mcpClientService } from './services/mcpClient.js'
import * as memoryVectorStore from './services/memoryVectorStore.js'
import * as pluginHost from './services/pluginHost.js'
import * as funasrStream from './services/funasrStream.js'
import * as minecraftGateway from './services/minecraftGateway.js'
import * as factorioRcon from './services/factorioRcon.js'
import * as realtimeVoice from './services/realtimeVoice.js'
import {
  buildChatConnectionTestRequest,
  buildChatRequest,
  chatProviderRequiresApiKey,
  extractChatResponseContent,
  extractChatStreamingDeltaContent,
  isChatStreamingPayloadTerminal,
  normalizeChatProviderId,
  trimRepeatedStreamingDelta as trimChatStreamingDelta,
} from './chatRuntime.js'
import {
  controlSystemMediaSession,
  getSystemMediaSessionSnapshot,
} from './mediaSessionRuntime.js'
import { createTtsStreamService } from './ttsStreamService.js'
import {
  normalizeBaseUrl,
  performNetworkRequest,
  readJsonSafe,
  extractResponseErrorMessage,
  formatConnectionFailureMessage,
  buildMultipartBody,
  createAudioFileName,
  normalizeLanguageCode,
  audioFormatToMimeType,
} from './net.js'
import {
  synthesizeRemoteTts,
  warmupRemoteTtsSession,
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
} from './services/ttsService.js'
import {
  runSpeechInputConnectionSmokeTest,
  runSpeechOutputConnectionSmokeTest,
} from './services/sttService.js'
import {
  listAvailablePetModels,
  importPetModelFromDialog,
  saveTextFileFromDialog,
  openTextFileFromDialog,
} from './services/petModelService.js'
import {
  captureActiveWindowContext,
  captureScreenshotContext,
  normalizeDesktopContextPolicy,
  clipboard,
} from './services/desktopContextService.js'
import {
  vaultStore,
  vaultRetrieve,
  vaultDelete,
  vaultListSlots,
  vaultStoreMany,
  vaultRetrieveMany,
  vaultIsAvailable,
} from './services/keyVault.js'
import { invokeRegisteredTool } from './tools/toolRegistry.js'
import {
  mainWindow,
  panelWindow,
  panelWindowState,
  petWindowState,
  panelSection,
  runtimeState,
  runtimeClientHeartbeat,
  buildRuntimeStateSnapshot,
  syncRuntimeState,
  syncPetWindowState,
  updateRuntimeState,
  updateHeartbeat,
  updatePetWindowState,
  updatePanelWindowState,
  showPanelWindow,
  showPetContextMenu,
  getLaunchOnStartupState,
  setLaunchOnStartupState,
  dragWindowBy,
  probeLocalServiceTarget,
  getViewKind,
} from './windowManager.js'

const CHAT_REQUEST_TIMEOUT_MS = 25_000
const CONNECTION_TEST_TIMEOUT_MS = 12_000
const AUDIO_TRANSCRIBE_TIMEOUT_MS = 20_000
const AUDIO_SYNTH_TIMEOUT_MS = 25_000
const AUDIO_VOICE_LIST_TIMEOUT_MS = 15_000
const VOICE_CLONE_TIMEOUT_MS = 60_000

const ttsStreamService = createTtsStreamService({
  sherpaTtsService,
  synthesizeRemote: synthesizeRemoteTts,
  warmupRemote: warmupRemoteTtsSession,
})

// Inline helpers used only in IPC handlers

function extractMessageContent(content) {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part?.text === 'string') return part.text
        return ''
      })
      .join('\n')
      .trim()
  }

  return ''
}

export function registerIpc() {
  ipcMain.handle('pet-window:get-state', () => petWindowState)

  ipcMain.handle('pet-window:update-state', (_event, state) => {
    return updatePetWindowState(state)
  })

  ipcMain.handle('window:open-panel', (_event, section) => {
    showPanelWindow(section)
  })

  ipcMain.handle('window:open-pet-menu', (event) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    showPetContextMenu(sourceWindow)
  })

  ipcMain.handle('window:close-panel', () => {
    panelWindow?.hide()
  })

  ipcMain.handle('panel-window:get-state', () => panelWindowState)

  ipcMain.handle('panel-window:set-state', (_event, state) => {
    return updatePanelWindowState(state)
  })

  ipcMain.handle('window:drag-by', (event, delta) => {
    dragWindowBy(event, delta)
  })

  ipcMain.on('window:get-view-kind', (event) => {
    event.returnValue = getViewKind(event)
  })

  ipcMain.handle('runtime-state:get', () => {
    return buildRuntimeStateSnapshot()
  })

  ipcMain.handle('runtime-state:heartbeat', (_event, payload) => {
    const view = payload?.view === 'panel' ? 'panel' : 'pet'
    updateHeartbeat(view)
    return buildRuntimeStateSnapshot()
  })

  ipcMain.handle('runtime-state:update', (_event, partialState) => {
    updateRuntimeState(partialState)
  })

  ipcMain.handle('app:get-launch-on-startup', () => {
    return getLaunchOnStartupState()
  })

  ipcMain.handle('app:set-launch-on-startup', (_event, value) => {
    return setLaunchOnStartupState(Boolean(value))
  })

  ipcMain.handle('pet-model:list', async () => {
    return listAvailablePetModels()
  })

  ipcMain.handle('pet-model:import', async () => {
    return importPetModelFromDialog()
  })

  ipcMain.handle('file:save-text', async (event, payload) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) ?? panelWindow ?? mainWindow ?? undefined
    return saveTextFileFromDialog(sourceWindow, payload)
  })

  ipcMain.handle('file:open-text', async (event, payload) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) ?? panelWindow ?? mainWindow ?? undefined
    return openTextFileFromDialog(sourceWindow, payload)
  })

  ipcMain.handle('tool:web-search', async (event, payload = {}) => {
    return invokeRegisteredTool(event, 'web_search', payload)
  })

  ipcMain.handle('tool:get-weather', async (event, payload = {}) => {
    return invokeRegisteredTool(event, 'weather_lookup', payload)
  })

  ipcMain.handle('tool:open-external', async (event, payload = {}) => {
    return invokeRegisteredTool(event, 'open_external_link', payload)
  })

  ipcMain.handle('desktop-context:get', async (_event, request = {}) => {
    const contextPolicy = normalizeDesktopContextPolicy(request?.policy)
    const snapshot = {
      capturedAt: new Date().toISOString(),
    }
    const tasks = []

    if (request.includeActiveWindow && contextPolicy.activeWindow) {
      tasks.push(
        captureActiveWindowContext().then((activeWindowSnapshot) => {
          if (activeWindowSnapshot) {
            Object.assign(snapshot, activeWindowSnapshot)
          }
        }),
      )
    }

    if (request.includeClipboard && contextPolicy.clipboard) {
      const clipboardText = clipboard.readText().trim()
      if (clipboardText) {
        snapshot.clipboardText = clipboardText.slice(0, 2_400)
      }
    }

    if (request.includeScreenshot && contextPolicy.screenshot) {
      tasks.push(
        captureScreenshotContext().then((screenSnapshot) => {
          if (screenSnapshot) {
            Object.assign(snapshot, screenSnapshot)
          }
        }),
      )
    }

    if (tasks.length) {
      await Promise.all(tasks)
    }

    return snapshot
  })

  ipcMain.handle('media-session:get', async () => {
    return getSystemMediaSessionSnapshot()
  })

  ipcMain.handle('media-session:control', async (_event, payload = {}) => {
    return controlSystemMediaSession(payload?.action)
  })

  ipcMain.handle('chat:complete', async (_event, payload) => {
    const baseUrl = normalizeBaseUrl(payload.baseUrl)
    const providerId = normalizeChatProviderId(payload.providerId, baseUrl)
    const requestSpec = buildChatRequest(payload, { stream: false })

    console.info('[chat:complete] request', {
      traceId: payload.traceId ?? '',
      providerId,
      baseUrl,
      model: payload.model,
      messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
      temperature: payload.temperature ?? 0.8,
      maxTokens: payload.maxTokens ?? 500,
    })

    let response
    try {
      response = await performNetworkRequest(requestSpec.endpoint, {
        method: 'POST',
        headers: requestSpec.headers,
        body: requestSpec.body,
        timeoutMs: CHAT_REQUEST_TIMEOUT_MS,
        timeoutMessage: '模型响应超时，请检查网络、代理或当前模型服务状态。',
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.error('[chat:complete] network failure', {
        traceId: payload.traceId ?? '',
        providerId,
        baseUrl,
        model: payload.model,
        reason,
      })
      throw new Error(`模型接口连接失败，请检查 API Base URL、网络或代理设置。原始错误：${reason}`)
    }

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      console.warn('[chat:complete] request failed', {
        traceId: payload.traceId ?? '',
        providerId,
        baseUrl,
        model: payload.model,
        status: response.status,
        message: data?.error?.message ?? data?.message ?? '',
      })
      if (response.status === 401) {
        throw new Error(
          payload.apiKey || !chatProviderRequiresApiKey(providerId)
            ? '模型接口鉴权失败，请检查 API Key 是否有效。'
            : '还没有填写 API Key，所以现在还不能对话。请先在设置里填入可用的 API Key。',
        )
      }

      throw new Error(
        data?.error?.message ??
          data?.message ??
          `模型请求失败（状态码：${response.status}）`,
      )
    }

    const content = extractChatResponseContent(requestSpec.protocol, data)

    if (!content) {
      throw new Error('模型返回了空内容，请检查接口兼容性。')
    }

    console.info('[chat:complete] success', {
      traceId: payload.traceId ?? '',
      baseUrl,
      model: payload.model,
      contentLength: content.length,
    })

    return { content }
  })

  ipcMain.handle('chat:complete-stream', async (event, payload) => {
    const { requestId, ...chatPayload } = payload
    const baseUrl = normalizeBaseUrl(chatPayload.baseUrl)
    const providerId = normalizeChatProviderId(chatPayload.providerId, baseUrl)
    const requestSpec = buildChatRequest(chatPayload, { stream: true })

    console.info('[chat:stream] request', {
      requestId,
      providerId,
      baseUrl,
      model: chatPayload.model,
      messageCount: Array.isArray(chatPayload.messages) ? chatPayload.messages.length : 0,
    })

    let response
    try {
      response = await performNetworkRequest(requestSpec.endpoint, {
        method: 'POST',
        headers: requestSpec.headers,
        body: requestSpec.body,
        timeoutMs: CHAT_REQUEST_TIMEOUT_MS,
        timeoutMessage: '模型响应超时，请检查网络、代理或当前模型服务状态。',
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.error('[chat:stream] network failure', { requestId, reason })
      throw new Error(`模型接口连接失败，请检查 API Base URL、网络或代理设置。原始错误：${reason}`)
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      if (response.status === 401) {
        throw new Error(
          chatPayload.apiKey || !chatProviderRequiresApiKey(providerId)
            ? '模型接口鉴权失败，请检查 API Key 是否有效。'
            : '还没有填写 API Key，所以现在还不能对话。请先在设置里填入可用的 API Key。',
        )
      }
      throw new Error(
        data?.error?.message ?? data?.message ?? `模型请求失败（状态码：${response.status}）`,
      )
    }

    let fullContent = ''
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let sseBuffer = ''
    let streamCompleted = false

    const processSseLine = (line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) {
        return false
      }

      const jsonStr = trimmed.slice(5).trim()
      if (jsonStr === '[DONE]') {
        return true
      }

      try {
        const parsed = JSON.parse(jsonStr)
        const rawDelta = extractChatStreamingDeltaContent(requestSpec.protocol, parsed)
        const delta = trimChatStreamingDelta(fullContent, rawDelta)
        if (delta) {
          fullContent += delta
          event.sender.send('chat:stream-delta', { requestId, delta })
        }
        return isChatStreamingPayloadTerminal(requestSpec.protocol, parsed)
      } catch {
        return false
      }
    }

    try {
      while (!streamCompleted) {
        const { done, value } = await reader.read()
        if (done) break

        sseBuffer += decoder.decode(value, { stream: true })
        const lines = sseBuffer.split('\n')
        sseBuffer = lines.pop() ?? ''

        for (const line of lines) {
          if (processSseLine(line)) {
            streamCompleted = true
            break
          }
        }
      }

      if (!streamCompleted && sseBuffer.trim()) {
        streamCompleted = processSseLine(sseBuffer)
      }
    } finally {
      reader.releaseLock()
    }

    event.sender.send('chat:stream-delta', { requestId, delta: '', done: true })

    const content = extractChatResponseContent(requestSpec.protocol, { content: fullContent })
    if (!content) {
      throw new Error('模型返回了空内容，请检查接口兼容性。')
    }

    console.info('[chat:stream] success', {
      requestId,
      model: chatPayload.model,
      contentLength: content.length,
    })

    return { content }
  })

  ipcMain.handle('chat:test-connection', async (_event, payload) => {
    const baseUrl = normalizeBaseUrl(payload.baseUrl)
    const providerId = normalizeChatProviderId(payload.providerId, baseUrl)

    if (!baseUrl) {
      return {
        ok: false,
        message: '请先填写 API Base URL。',
      }
    }

    const requestSpec = buildChatConnectionTestRequest({
      providerId,
      baseUrl,
      apiKey: payload.apiKey,
      model: payload.model,
    })

    try {
      const response = await performNetworkRequest(requestSpec.endpoint, {
        ...requestSpec.request,
        timeoutMs: CONNECTION_TEST_TIMEOUT_MS,
        timeoutMessage: '模型接口测试超时，请检查 URL、网络、代理或服务状态。',
      })

      const data = await response.json().catch(() => ({}))

      if (response.ok) {
        const firstModels = requestSpec.successKind === 'model_list' && Array.isArray(data?.data)
          ? data.data.slice(0, 3).map((item) => item?.id).filter(Boolean)
          : []

        return {
          ok: true,
          message: requestSpec.successKind === 'message'
            ? '连接成功，已收到模型响应。'
            : firstModels.length
            ? `连接成功，可用模型示例：${firstModels.join(', ')}`
            : '连接成功，接口已正常响应。',
        }
      }

      if (response.status === 401) {
        return {
          ok: false,
          message: payload.apiKey || !chatProviderRequiresApiKey(providerId)
            ? 'URL 可访问，但 API Key 无效或已失效。'
            : 'URL 可访问，但还没有填写 API Key。',
        }
      }

      return {
        ok: false,
        message:
          data?.error?.message
          ?? data?.message
          ?? `接口返回异常状态：${response.status}`,
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        message: formatConnectionFailureMessage(reason),
      }
    }
  })

  ipcMain.handle('service:test-connection', async (_event, payload) => {
    const baseUrl = payload.capability === 'speech-output'
      ? (
        isLocalQwen3TtsSpeechOutputProvider(payload.providerId)
          ? await ensureLocalQwen3TtsService(payload.baseUrl, payload.model)
          : isLocalCliSpeechOutputProvider(payload.providerId)
            ? normalizeBaseUrl(payload.baseUrl)
          : resolveSpeechOutputBaseUrl(payload.providerId, payload.baseUrl)
      )
      : normalizeBaseUrl(payload.baseUrl)

    if (!baseUrl && !(payload.capability === 'speech-output' && isLocalCliSpeechOutputProvider(payload.providerId))) {
      return {
        ok: false,
        message: '请先填写 API Base URL。',
      }
    }

    if (isVolcengineSpeechInputProvider(payload.providerId) || isVolcengineSpeechOutputProvider(payload.providerId)) {
      const credentials = parseVolcengineSpeechCredentials(payload.apiKey)
      if (!credentials.appId || !credentials.accessToken) {
        return {
          ok: false,
          message: isVolcengineSpeechInputProvider(payload.providerId)
            ? '火山语音识别请在 API Key 一栏填写 APP_ID:ACCESS_TOKEN。'
            : '火山语音合成请在 API Key 一栏填写 APP_ID:ACCESS_TOKEN。',
        }
      }
    }

    if (payload.capability === 'speech-output') {
      try {
        return await runSpeechOutputConnectionSmokeTest(payload, baseUrl)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)

        return {
          ok: false,
          message: formatConnectionFailureMessage(reason),
        }
      }
    }

    try {
      return await runSpeechInputConnectionSmokeTest(payload, baseUrl)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        message: formatConnectionFailureMessage(reason),
      }
    }
  })

  ipcMain.handle('doctor:probe-local-services', async (_event, payload) => {
    if (!Array.isArray(payload) || !payload.length) {
      return []
    }

    return Promise.all(payload.map((target) => probeLocalServiceTarget(target)))
  })

  ipcMain.handle('integrations:inspect', async (_event, payload) => {
    return inspectIntegrationRuntime(payload)
  })

  ipcMain.handle('audio:list-voices', async (_event, payload) => {
    if (payload.providerId === 'local-sherpa-tts') {
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
        ...(request.body
          ? {
              body: request.body,
            }
          : {}),
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
      const { getVolcengineStatus } = await import('./net.js')
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

  ipcMain.handle('tts:stream-start', (event, payload) => {
    return ttsStreamService.start(event.sender, payload)
  })

  ipcMain.handle('tts:stream-push-text', (event, payload) => {
    return ttsStreamService.pushText(event.sender, payload)
  })

  ipcMain.handle('tts:stream-finish', async (event, payload) => {
    return ttsStreamService.finish(event.sender, payload)
  })

  ipcMain.handle('tts:stream-abort', (event, payload) => {
    return ttsStreamService.abort(event.sender, payload)
  })

  ipcMain.handle('sherpa:status', () => {
    return sherpaAsrService.getModelStatus()
  })

  ipcMain.handle('sherpa:start', (_event, payload) => {
    if (!sherpaAsrService.isAvailable()) {
      throw new Error('sherpa-onnx-node 未安装，请先运行 npm install sherpa-onnx-node。')
    }

    const modelId = String(payload?.modelId ?? '').trim() || undefined
    const ok = sherpaAsrService.startStream(modelId)
    if (!ok) {
      const status = sherpaAsrService.getModelStatus(modelId)
      throw new Error(
        status.modelFound
          ? '本地流式识别引擎初始化失败，请检查模型文件完整性。'
          : modelId
            ? `未找到流式语音模型 ${modelId}，请将对应模型放到 ${status.modelsDir} 目录下。`
            : `未找到流式语音模型，请将模型放到 ${status.modelsDir} 目录下。`,
      )
    }

    return {
      ok: true,
      sampleRate: sherpaAsrService.getSampleRate(),
    }
  })

  ipcMain.handle('sherpa:feed', (_event, payload) => {
    const { samples, sampleRate } = payload
    if (!samples || !samples.length) return { partial: null, endpoint: null }

    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    const partial = sherpaAsrService.feedAudio(float32, sampleRate)
    const endpoint = sherpaAsrService.checkEndpoint()

    return { partial, endpoint }
  })

  ipcMain.handle('sherpa:finish', () => {
    const text = sherpaAsrService.finishStream()
    return { text }
  })

  ipcMain.handle('sherpa:abort', () => {
    sherpaAsrService.abortStream()
    return { ok: true }
  })

  ipcMain.handle('kws:status', (_event, payload) => {
    return sherpaKwsService.getStatus(payload)
  })

  ipcMain.handle('kws:start', (_event, payload) => {
    const status = sherpaKwsService.getStatus(payload)
    if (!status.modelFound) {
      throw new Error(status.reason || '唤醒词模型未安装，请运行 setup.bat 下载模型。')
    }
    const ok = sherpaKwsService.start(payload)
    if (!ok) {
      throw new Error('唤醒词引擎初始化失败。')
    }
    return { ok: true, sampleRate: 16000 }
  })

  ipcMain.handle('kws:feed', (_event, payload) => {
    const { samples, sampleRate } = payload
    if (!samples || !samples.length) return { keyword: null }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    return sherpaKwsService.feed(float32, sampleRate)
  })

  ipcMain.handle('kws:stop', () => {
    sherpaKwsService.stop()
    return { ok: true }
  })

  // ── MCP stdio client (new) ──

  ipcMain.handle('mcp-client:connect', async (_event, config) => {
    return mcpClientService.connect(config)
  })

  ipcMain.handle('mcp-client:disconnect', (_event, serverId) => {
    mcpClientService.disconnect(serverId)
    return { ok: true }
  })

  ipcMain.handle('mcp-client:call-tool', async (_event, serverId, toolName, args) => {
    return mcpClientService.callTool(serverId, toolName, args)
  })

  ipcMain.handle('mcp-client:list-tools', (_event, serverId) => {
    return serverId
      ? mcpClientService.listTools(serverId)
      : mcpClientService.listAllTools()
  })

  ipcMain.handle('mcp-client:status', (_event, serverId) => {
    return serverId
      ? mcpClientService.getStatus(serverId)
      : mcpClientService.getAllStatuses()
  })

  // ── Key vault (safeStorage encryption) ──

  ipcMain.handle('vault:is-available', () => vaultIsAvailable())

  ipcMain.handle('vault:store', (_event, slot, plaintext) => vaultStore(slot, plaintext))

  ipcMain.handle('vault:retrieve', (_event, slot) => vaultRetrieve(slot))

  ipcMain.handle('vault:delete', (_event, slot) => vaultDelete(slot))

  ipcMain.handle('vault:list-slots', () => vaultListSlots())

  ipcMain.handle('vault:store-many', (_event, entries) => vaultStoreMany(entries))

  ipcMain.handle('vault:retrieve-many', (_event, slots) => vaultRetrieveMany(slots))

  // ── MCP Host (multi-server) ──

  ipcMain.handle('mcp:start', async (_event, payload) => {
    const id = String(payload?.id ?? '').trim()
    const command = String(payload?.command ?? '').trim()
    const args = splitCommandLine(payload?.args ?? '')
    await mcpHost.start(id, command, args)
    return mcpHost.getStatus(id)
  })

  ipcMain.handle('mcp:stop', async (_event, payload) => {
    const id = String(payload?.id ?? '').trim()
    await mcpHost.stop(id)
    return { ok: true }
  })

  ipcMain.handle('mcp:restart', async (_event, payload) => {
    const id = String(payload?.id ?? '').trim()
    const command = String(payload?.command ?? '').trim()
    const args = splitCommandLine(payload?.args ?? '')
    await mcpHost.restart(id, command, args)
    return mcpHost.getStatus(id)
  })

  ipcMain.handle('mcp:status', (_event, payload) => {
    const id = payload?.id ? String(payload.id).trim() : null
    return id ? mcpHost.getStatus(id) : mcpHost.getAllStatuses()
  })

  ipcMain.handle('mcp:list-tools', (_event, payload) => {
    const id = payload?.id ? String(payload.id).trim() : null
    return id ? mcpHost.listTools(id) : mcpHost.listAllTools()
  })

  ipcMain.handle('mcp:call-tool', async (_event, payload) => {
    const id = payload?.serverId ? String(payload.serverId).trim() : null
    const name = String(payload?.name ?? '')
    const toolArgs = payload?.arguments ?? {}
    return id
      ? mcpHost.callTool(id, name, toolArgs)
      : mcpHost.callToolByName(name, toolArgs)
  })

  // ── Plugin Host ──

  ipcMain.handle('plugin:scan', async () => {
    return pluginHost.scanPlugins()
  })

  ipcMain.handle('plugin:list', () => {
    return pluginHost.listPlugins()
  })

  ipcMain.handle('plugin:start', async (_event, payload) => {
    return pluginHost.startPlugin(String(payload?.id ?? ''))
  })

  ipcMain.handle('plugin:stop', async (_event, payload) => {
    await pluginHost.stopPlugin(String(payload?.id ?? ''))
    return { ok: true }
  })

  ipcMain.handle('plugin:restart', async (_event, payload) => {
    return pluginHost.restartPlugin(String(payload?.id ?? ''))
  })

  ipcMain.handle('plugin:enable', (_event, payload) => {
    return pluginHost.enablePlugin(String(payload?.id ?? ''))
  })

  ipcMain.handle('plugin:disable', (_event, payload) => {
    return pluginHost.disablePlugin(String(payload?.id ?? ''))
  })

  ipcMain.handle('plugin:status', (_event, payload) => {
    return pluginHost.getPluginStatus(String(payload?.id ?? ''))
  })

  ipcMain.handle('plugin:dir', () => {
    return pluginHost.getPluginsDir_()
  })

  // ── Memory Vector Store ──

  ipcMain.handle('memory:vector-index', async (_event, payload) => {
    const { id, content, embedding, layer } = payload ?? {}
    await memoryVectorStore.indexMemory(id, content, embedding, layer)
    return { ok: true }
  })

  ipcMain.handle('memory:vector-index-batch', async (_event, payload) => {
    if (!Array.isArray(payload)) return { ok: false }
    await memoryVectorStore.indexBatch(payload)
    return { ok: true, count: payload.length }
  })

  ipcMain.handle('memory:vector-search', async (_event, payload) => {
    const { queryEmbedding, limit, threshold, layer } = payload ?? {}
    return memoryVectorStore.searchSimilar(queryEmbedding, { limit, threshold, layer })
  })

  ipcMain.handle('memory:vector-remove', async (_event, payload) => {
    if (Array.isArray(payload?.ids)) {
      const count = await memoryVectorStore.removeMemories(payload.ids)
      return { ok: true, count }
    }
    const deleted = await memoryVectorStore.removeMemory(String(payload?.id ?? ''))
    return { ok: deleted }
  })

  ipcMain.handle('memory:vector-stats', async () => {
    return memoryVectorStore.getStats()
  })

  // ── FunASR Streaming STT ──

  ipcMain.handle('funasr:connect', async (_event, payload) => {
    const baseUrl = String(payload?.baseUrl ?? '').trim()
    await funasrStream.connect(baseUrl)
    return funasrStream.getStatus()
  })

  ipcMain.handle('funasr:disconnect', async () => {
    await funasrStream.disconnect()
    return { ok: true }
  })

  ipcMain.handle('funasr:start-stream', (_event, payload) => {
    funasrStream.startStream(payload)
    return { ok: true }
  })

  ipcMain.handle('funasr:feed', (_event, payload) => {
    const { samples } = payload
    if (!samples || !samples.length) return { ok: true }
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples)
    funasrStream.feedAudio(float32)
    return { ok: true }
  })

  ipcMain.handle('funasr:finish', async () => {
    const text = await funasrStream.finishStream()
    return { text }
  })

  ipcMain.handle('funasr:abort', () => {
    funasrStream.abortStream()
    return { ok: true }
  })

  ipcMain.handle('funasr:status', () => funasrStream.getStatus())

  // ── Minecraft Gateway ──

  ipcMain.handle('minecraft:connect', async (_event, payload) => {
    const address = String(payload?.address ?? '').trim()
    const port = Number(payload?.port ?? 19131)
    const username = String(payload?.username ?? '').trim()
    await minecraftGateway.connect(address, port, username)
    return minecraftGateway.getStatus()
  })

  ipcMain.handle('minecraft:disconnect', async () => {
    await minecraftGateway.disconnect()
    return { ok: true }
  })

  ipcMain.handle('minecraft:send-command', (_event, payload) => {
    minecraftGateway.sendCommand(String(payload?.command ?? ''))
    return { ok: true }
  })

  ipcMain.handle('minecraft:status', () => minecraftGateway.getStatus())

  ipcMain.handle('minecraft:game-context', () => minecraftGateway.getGameContext())

  // ── Factorio RCON ──

  ipcMain.handle('factorio:connect', async (_event, payload) => {
    const address = String(payload?.address ?? '').trim()
    const port = Number(payload?.port ?? 34197)
    const password = String(payload?.password ?? '').trim()
    await factorioRcon.connect(address, port, password)
    return factorioRcon.getStatus()
  })

  ipcMain.handle('factorio:disconnect', async () => {
    await factorioRcon.disconnect()
    return { ok: true }
  })

  ipcMain.handle('factorio:execute', async (_event, payload) => {
    const command = String(payload?.command ?? '')
    const response = await factorioRcon.execute(command)
    return { response }
  })

  ipcMain.handle('factorio:status', () => factorioRcon.getStatus())

  ipcMain.handle('factorio:game-context', () => factorioRcon.getGameContext())

  // Realtime Voice (OpenAI Realtime API)
  realtimeVoice.onRealtimeEvent((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('realtime:event', event)
    }
  })

  ipcMain.handle('realtime:start', (_event, payload) => realtimeVoice.startSession(payload))
  ipcMain.handle('realtime:stop', () => realtimeVoice.stopSession())
  ipcMain.handle('realtime:feed', (_event, payload) => {
    realtimeVoice.feedAudio(payload.samples)
    return { ok: true }
  })
  ipcMain.handle('realtime:interrupt', () => {
    realtimeVoice.interrupt()
    return { ok: true }
  })
  ipcMain.handle('realtime:send-text', (_event, payload) => {
    realtimeVoice.sendTextMessage(payload.text)
    return { ok: true }
  })
  ipcMain.handle('realtime:state', () => realtimeVoice.getState())

  app.once('before-quit', () => {
    mcpHost.stopAll().catch(() => {})
    memoryVectorStore.flush().catch(() => {})
    minecraftGateway.disconnect().catch(() => {})
    factorioRcon.disconnect().catch(() => {})
    realtimeVoice.stopSession().catch(() => {})
  })
}
