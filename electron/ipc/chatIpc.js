import { ipcMain } from 'electron'
import {
  buildChatConnectionTestRequest,
  buildChatRequest,
  chatProviderRequiresApiKey,
  extractChatResponseContent,
  extractChatResponseFinishReason,
  extractChatResponseToolCalls,
  extractChatStreamingDeltaContent,
  extractChatStreamingDeltaToolCalls,
  isChatStreamingPayloadTerminal,
  normalizeChatProviderId,
  trimRepeatedStreamingDelta as trimChatStreamingDelta,
} from '../chatRuntime.js'
import {
  normalizeBaseUrl,
  performNetworkRequest,
  formatConnectionFailureMessage,
} from '../net.js'
import {
  isVolcengineSpeechInputProvider,
  isVolcengineSpeechOutputProvider,
  parseVolcengineSpeechCredentials,
  resolveSpeechOutputBaseUrl,
} from '../services/ttsService.js'
import {
  runSpeechInputConnectionSmokeTest,
  runSpeechOutputConnectionSmokeTest,
} from '../services/sttService.js'
import { requireTrustedSender, expectString, assertArray } from './validate.js'

export function register({ activeChatStreamControllers, CHAT_REQUEST_TIMEOUT_MS, CONNECTION_TEST_TIMEOUT_MS }) {
  ipcMain.handle('chat:complete', async (event, payload) => {
    requireTrustedSender(event)
    expectString(payload?.baseUrl, 'payload.baseUrl')
    assertArray(payload?.messages, 'payload.messages')
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

    const data = await response.json().catch((parseErr) => {
      console.warn('[chat:complete] response body is not valid JSON:', parseErr?.message)
      return {}
    })

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
    const toolCalls = extractChatResponseToolCalls(requestSpec.protocol, data)
    const finishReason = extractChatResponseFinishReason(requestSpec.protocol, data)

    if (!content && !toolCalls) {
      throw new Error('模型返回了空内容，请检查接口兼容性。')
    }

    console.info('[chat:complete] success', {
      traceId: payload.traceId ?? '',
      baseUrl,
      model: payload.model,
      contentLength: (content || '').length,
      toolCallCount: toolCalls?.length ?? 0,
    })

    return {
      content: content || '',
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
      ...(finishReason ? { finish_reason: finishReason } : {}),
    }
  })

  ipcMain.handle('chat:complete-stream', async (event, payload) => {
    requireTrustedSender(event)
    expectString(payload?.baseUrl, 'payload.baseUrl')
    assertArray(payload?.messages, 'payload.messages')
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

    const abortController = new AbortController()
    activeChatStreamControllers.set(requestId, abortController)

    let response
    try {
      response = await performNetworkRequest(requestSpec.endpoint, {
        method: 'POST',
        headers: requestSpec.headers,
        body: requestSpec.body,
        signal: abortController.signal,
        timeoutMs: CHAT_REQUEST_TIMEOUT_MS,
        timeoutMessage: '模型响应超时，请检查网络、代理或当前模型服务状态。',
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      activeChatStreamControllers.delete(requestId)
      console.error('[chat:stream] network failure', { requestId, reason })
      throw new Error(`模型接口连接失败，请检查 API Base URL、网络或代理设置。原始错误：${reason}`)
    }

    if (!response.ok) {
      activeChatStreamControllers.delete(requestId)
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
    const toolCallAccumulator = new Map()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let sseBuffer = ''
    let streamCompleted = false

    const mergeToolCallFragments = (fragments) => {
      for (const frag of fragments) {
        const key = Number.isFinite(frag?.index) ? frag.index : 0
        const existing = toolCallAccumulator.get(key) ?? {
          id: '',
          type: 'function',
          function: { name: '', arguments: '' },
        }
        if (frag.id) existing.id = frag.id
        if (frag.type) existing.type = frag.type
        if (frag.function?.name) existing.function.name = frag.function.name
        if (typeof frag.function?.arguments === 'string') {
          existing.function.arguments =
            (existing.function.arguments ?? '') + frag.function.arguments
        }
        toolCallAccumulator.set(key, existing)
      }
    }

    const processSseLine = (line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) {
        return false
      }

      const jsonStr = trimmed.slice(5).trim()
      if (jsonStr === '[DONE]') {
        return true
      }

      let parsed
      try {
        parsed = JSON.parse(jsonStr)
      } catch {
        return false // Malformed SSE line — expected, skip
      }

      try {
        const rawDelta = extractChatStreamingDeltaContent(requestSpec.protocol, parsed)
        const delta = trimChatStreamingDelta(fullContent, rawDelta)
        if (delta) {
          fullContent += delta
          if (!event.sender.isDestroyed()) {
            event.sender.send('chat:stream-delta', { requestId, delta })
          }
        }

        const toolCallFragments = extractChatStreamingDeltaToolCalls(
          requestSpec.protocol,
          parsed,
        )
        if (toolCallFragments?.length) {
          mergeToolCallFragments(toolCallFragments)
        }

        return isChatStreamingPayloadTerminal(requestSpec.protocol, parsed)
      } catch (err) {
        console.error('[chat:stream] delta extraction error:', err?.message)
        return false
      }
    }

    let streamError = null
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
    } catch (err) {
      // Capture so we can still emit a `done:true` frame to the renderer
      // (otherwise the UI's isStreaming flag stays stuck forever) and
      // re-throw after the cleanup runs.
      streamError = err
    } finally {
      activeChatStreamControllers.delete(requestId)
      reader.releaseLock()

      // Always emit a terminal frame so the renderer's stream consumer
      // resolves. Without this, mid-stream errors would leave `isStreaming`
      // stuck and the user would think the assistant is still typing.
      if (!event.sender.isDestroyed()) {
        const terminalPayload = streamError
          ? {
              requestId,
              delta: '',
              done: true,
              error: streamError instanceof Error ? streamError.message : String(streamError),
            }
          : { requestId, delta: '', done: true }
        try {
          event.sender.send('chat:stream-delta', terminalPayload)
        } catch (sendErr) {
          console.warn('[chat:stream] failed to emit terminal frame:', sendErr?.message)
        }
      }
    }

    // Re-surface the original error to the invoker promise so callers
    // see the rejection just like before — the change above is purely
    // additive on the streaming side.
    if (streamError) throw streamError

    const content = extractChatResponseContent(requestSpec.protocol, { content: fullContent })

    const toolCalls = toolCallAccumulator.size > 0
      ? [...toolCallAccumulator.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, tc]) => ({
            id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
            type: tc.type || 'function',
            function: {
              name: tc.function.name || '',
              arguments: tc.function.arguments || '',
            },
          }))
          .filter((tc) => tc.function.name)
      : null

    if (!content && !(toolCalls && toolCalls.length)) {
      throw new Error('模型返回了空内容，请检查接口兼容性。')
    }

    console.info('[chat:stream] success', {
      requestId,
      model: chatPayload.model,
      contentLength: (content || '').length,
      toolCallCount: toolCalls?.length ?? 0,
    })

    return {
      content: content || '',
      ...(toolCalls && toolCalls.length ? { tool_calls: toolCalls } : {}),
    }
  })

  ipcMain.handle('chat:abort-stream', async (event, payload = {}) => {
    requireTrustedSender(event)
    const requestId = String(payload?.requestId ?? '').trim()
    if (!requestId) return

    const controller = activeChatStreamControllers.get(requestId)
    if (!controller) return

    activeChatStreamControllers.delete(requestId)
    controller.abort()
  })

  ipcMain.handle('chat:test-connection', async (event, payload) => {
    requireTrustedSender(event)
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

        let message
        if (requestSpec.successKind === 'message') {
          message = '连接成功，已收到模型响应。'
        } else if (firstModels.length) {
          message = `连接成功，可用模型示例：${firstModels.join(', ')}`
        } else {
          message = '连接成功，接口已正常响应。'
        }

        return { ok: true, message }
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

  ipcMain.handle('service:test-connection', async (event, payload) => {
    requireTrustedSender(event)
    let baseUrl
    if (payload.capability !== 'speech-output') {
      baseUrl = normalizeBaseUrl(payload.baseUrl)
    } else {
      baseUrl = resolveSpeechOutputBaseUrl(payload.providerId, payload.baseUrl)
    }

    if (!baseUrl) {
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
}
