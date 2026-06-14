import { ipcMain } from 'electron'
import {
  buildChatConnectionTestRequest,
  buildChatModelListRequest,
  buildChatRequest,
  buildDiscoveredChatModels,
  chatProviderRequiresApiKey,
  extractChatResponseContent,
  extractChatResponseFinishReason,
  extractChatResponseReasoning,
  extractChatResponseToolCalls,
  extractChatStreamingDeltaContent,
  extractChatStreamingDeltaReasoning,
  extractChatStreamingDeltaToolCalls,
  getChatConnectionTestPreflightFailure,
  isChatStreamingPayloadTerminal,
  normalizeChatProviderId,
  summarizeChatConnectionTestFailure,
  summarizeChatConnectionTestSuccess,
  trimRepeatedStreamingDelta as trimChatStreamingDelta,
} from '../chatRuntime.js'
import {
  normalizeBaseUrl,
  performNetworkRequest,
  performNetworkRequestWithRetry,
  formatConnectionFailureMessage,
} from '../net.js'
import {
  isVolcengineSpeechInputProvider,
  isVolcengineSpeechOutputProvider,
  parseVolcengineSpeechCredentials,
  resolveSpeechOutputBaseUrl,
} from '../services/ttsService.js'
import { checkChatBaseUrlSafety } from '../services/urlSafety.js'
import {
  runSpeechInputConnectionSmokeTest,
  runSpeechOutputConnectionSmokeTest,
} from '../services/sttService.js'
import { requireTrustedSender, expectString, assertArray } from './validate.js'
import { resolveVaultRefsForSender } from '../services/vaultRefs.js'
import {
  validateChatAbortStreamPayload,
  validateChatCompletionPayload,
  validateChatModelListPayload,
  validateServiceConnectionTestPayload,
} from './payloadSchemas.js'

function formatEmptyChatContentMessage({ reasoningLength = 0, finishReason = '' } = {}) {
  const details = []
  if (reasoningLength > 0) details.push(`reasoningLength=${reasoningLength}`)
  if (finishReason) details.push(`finishReason=${finishReason}`)
  const suffix = details.length ? `（${details.join('，')}）` : ''
  return `模型回来了但是内容是空的${suffix}，看看接口兼容性或者试试关掉 Thinking？`
}

export function register({ activeChatStreamControllers, CHAT_REQUEST_TIMEOUT_MS, CONNECTION_TEST_TIMEOUT_MS }) {
  ipcMain.handle('chat:complete', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateChatCompletionPayload('chat:complete', payload)
    const requestPayload = await resolveVaultRefsForSender(event.sender, payload, ['apiKey'])
    expectString(requestPayload?.baseUrl, 'payload.baseUrl')
    assertArray(requestPayload?.messages, 'payload.messages')
    const baseUrl = normalizeBaseUrl(requestPayload.baseUrl)
    const safety = checkChatBaseUrlSafety(baseUrl)
    if (!safety.ok) {
      throw new Error(`API Base URL 被拒绝（${safety.reason}）。请使用合法的 https/http 模型接口地址。`)
    }
    const providerId = normalizeChatProviderId(requestPayload.providerId, baseUrl)
    const requestSpec = buildChatRequest(requestPayload, { stream: false })

    console.info('[chat:complete] request', {
      traceId: requestPayload.traceId ?? '',
      providerId,
      baseUrl,
      model: requestPayload.model,
      messageCount: Array.isArray(requestPayload.messages) ? requestPayload.messages.length : 0,
      temperature: requestPayload.temperature ?? 0.8,
      maxTokens: requestPayload.maxTokens ?? 500,
    })

    let response
    try {
      // Bounded retry on transient 429/5xx/network blips before surfacing a
      // failure (the higher-level key/provider failover then takes over). One
      // retry keeps an interactive turn from stalling. Non-streaming, so the
      // wrapper's body-drain-and-retry is safe.
      response = await performNetworkRequestWithRetry(requestSpec.endpoint, {
        allowPrivateNetwork: true,
        method: 'POST',
        headers: requestSpec.headers,
        body: requestSpec.body,
        timeoutMs: CHAT_REQUEST_TIMEOUT_MS,
        timeoutMessage: '模型回复太慢了，看看网络和服务有没有问题？',
        maxAttempts: 2,
        onRetry: ({ attempt, reason }) =>
          console.warn('[chat:complete] transient failure, retrying', { attempt, reason }),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.error('[chat:complete] network failure', {
        traceId: requestPayload.traceId ?? '',
        providerId,
        baseUrl,
        model: requestPayload.model,
        reason,
      })
      throw new Error(`没能连上模型接口，看看地址和网络对不对？具体原因：${reason}`)
    }

    const data = await response.json().catch((parseErr) => {
      console.warn('[chat:complete] response body is not valid JSON:', parseErr?.message)
      return {}
    })

    if (!response.ok) {
      console.warn('[chat:complete] request failed', {
        traceId: requestPayload.traceId ?? '',
        providerId,
        baseUrl,
        model: requestPayload.model,
        status: response.status,
        message: data?.error?.message ?? data?.message ?? '',
      })
      if (response.status === 401) {
        throw new Error(
          requestPayload.apiKey || !chatProviderRequiresApiKey(providerId)
            ? 'API Key 好像不太对，去设置里看看？'
            : '还没填 API Key 呢，先去设置里填一个吧。',
        )
      }

      throw new Error(
        data?.error?.message ??
          data?.message ??
          `模型那边回了个状态码 ${response.status}，不太确定怎么回事。`,
      )
    }

    const content = extractChatResponseContent(requestSpec.protocol, data)
    const toolCalls = extractChatResponseToolCalls(requestSpec.protocol, data)
    const finishReason = extractChatResponseFinishReason(requestSpec.protocol, data)
    const reasoning = extractChatResponseReasoning(requestSpec.protocol, data)

    if (!content && !toolCalls) {
      throw new Error(formatEmptyChatContentMessage({
        reasoningLength: reasoning.length,
        finishReason,
      }))
    }

    console.info('[chat:complete] success', {
      traceId: requestPayload.traceId ?? '',
      baseUrl,
      model: requestPayload.model,
      contentLength: (content || '').length,
      toolCallCount: toolCalls?.length ?? 0,
      reasoningLength: reasoning.length,
    })

    return {
      content: content || '',
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
      ...(finishReason ? { finish_reason: finishReason } : {}),
      ...(reasoning ? { reasoning_content: reasoning } : {}),
    }
  })

  ipcMain.handle('chat:complete-stream', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateChatCompletionPayload('chat:complete-stream', payload)
    const requestPayload = await resolveVaultRefsForSender(event.sender, payload, ['apiKey'])
    expectString(requestPayload?.baseUrl, 'payload.baseUrl')
    assertArray(requestPayload?.messages, 'payload.messages')
    const { requestId, ...chatPayload } = requestPayload
    const baseUrl = normalizeBaseUrl(chatPayload.baseUrl)
    const safety = checkChatBaseUrlSafety(baseUrl)
    if (!safety.ok) {
      throw new Error(`API Base URL 被拒绝（${safety.reason}）。请使用合法的 https/http 模型接口地址。`)
    }
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
      // The retry wrapper only re-issues on a non-ok status (known at header
      // time) or an initial connection error — never once a 200 body has begun
      // streaming — so there's no risk of duplicate partial output. An aborted
      // signal still bubbles immediately.
      response = await performNetworkRequestWithRetry(requestSpec.endpoint, {
        allowPrivateNetwork: true,
        method: 'POST',
        headers: requestSpec.headers,
        body: requestSpec.body,
        signal: abortController.signal,
        timeoutMs: CHAT_REQUEST_TIMEOUT_MS,
        timeoutMessage: '模型回复太慢了，看看网络和服务有没有问题？',
        maxAttempts: 2,
        onRetry: ({ attempt, reason }) =>
          console.warn('[chat:stream] transient failure, retrying', { attempt, reason }),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      activeChatStreamControllers.delete(requestId)
      console.error('[chat:stream] network failure', { requestId, reason })
      throw new Error(`没能连上模型接口，看看地址和网络对不对？具体原因：${reason}`)
    }

    if (!response.ok) {
      activeChatStreamControllers.delete(requestId)
      const data = await response.json().catch(() => ({}))
      if (response.status === 401) {
        throw new Error(
          chatPayload.apiKey || !chatProviderRequiresApiKey(providerId)
            ? 'API Key 好像不太对，去设置里看看？'
            : '还没填 API Key 呢，先去设置里填一个吧。',
        )
      }
      throw new Error(
        data?.error?.message ?? data?.message ?? `模型那边回了个状态码 ${response.status}，不太确定怎么回事。`,
      )
    }

    let fullContent = ''
    let fullReasoning = ''
    let finishReason = null
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
        finishReason = extractChatResponseFinishReason(requestSpec.protocol, parsed) ?? finishReason

        const rawDelta = extractChatStreamingDeltaContent(requestSpec.protocol, parsed)
        const delta = trimChatStreamingDelta(fullContent, rawDelta)
        if (delta) {
          fullContent += delta
          if (!event.sender.isDestroyed()) {
            event.sender.send('chat:stream-delta', { requestId, delta })
          }
        }

        const reasoningDelta = extractChatStreamingDeltaReasoning(requestSpec.protocol, parsed)
        if (reasoningDelta) {
          fullReasoning += reasoningDelta
          if (!event.sender.isDestroyed()) {
            event.sender.send('chat:stream-delta', {
              requestId,
              delta: '',
              reasoning_delta: reasoningDelta,
            })
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
      throw new Error(formatEmptyChatContentMessage({
        reasoningLength: fullReasoning.length,
        finishReason,
      }))
    }

    console.info('[chat:stream] success', {
      requestId,
      model: chatPayload.model,
      contentLength: (content || '').length,
      toolCallCount: toolCalls?.length ?? 0,
      reasoningLength: fullReasoning.length,
    })

    return {
      content: content || '',
      ...(toolCalls && toolCalls.length ? { tool_calls: toolCalls } : {}),
      ...(finishReason ? { finish_reason: finishReason } : {}),
      ...(fullReasoning ? { reasoning_content: fullReasoning } : {}),
    }
  })

  ipcMain.handle('chat:abort-stream', async (event, payload = {}) => {
    requireTrustedSender(event)
    payload = validateChatAbortStreamPayload(payload)
    const requestId = String(payload.requestId ?? '').trim()
    if (!requestId) return

    const controller = activeChatStreamControllers.get(requestId)
    if (!controller) return

    activeChatStreamControllers.delete(requestId)
    controller.abort()
  })

  ipcMain.handle('chat:test-connection', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateServiceConnectionTestPayload({
      ...payload,
      capability: 'text',
    })
    const requestPayload = await resolveVaultRefsForSender(event.sender, payload, ['apiKey'])
    const baseUrl = normalizeBaseUrl(requestPayload.baseUrl)
    const providerId = normalizeChatProviderId(requestPayload.providerId, baseUrl)

    if (!baseUrl) {
      return {
        ok: false,
        message: '还没填 API 地址呢。',
      }
    }

    const safety = checkChatBaseUrlSafety(baseUrl)
    if (!safety.ok) {
      return {
        ok: false,
        message: `这个地址不太安全，没法用哦（${safety.reason}）。`,
      }
    }

    const preflightFailure = getChatConnectionTestPreflightFailure({
      providerId,
      apiKey: requestPayload.apiKey,
    })
    if (preflightFailure) {
      return preflightFailure
    }

    const requestSpec = buildChatConnectionTestRequest({
      providerId,
      baseUrl,
      apiKey: requestPayload.apiKey,
      model: requestPayload.model,
    })

    try {
      const response = await performNetworkRequest(requestSpec.endpoint, {
        allowPrivateNetwork: true,
        ...requestSpec.request,
        // Re-check every redirect hop so a poisoned 30x can't reach IMDS/private
        // hosts past the first-hop SSRF check (non-streaming probe — safe to follow).
        followRedirectsSafely: true,
        timeoutMs: CONNECTION_TEST_TIMEOUT_MS,
        timeoutMessage: '等了好久都没连上，看看地址和网络对不对？',
      })

      const data = await response.json().catch(() => ({}))

      if (response.ok) {
        return summarizeChatConnectionTestSuccess({
          providerId,
          successKind: requestSpec.successKind,
          data,
          model: requestPayload.model,
        })
      }

      return summarizeChatConnectionTestFailure({
        providerId,
        status: response.status,
        data,
        hasApiKey: Boolean(String(requestPayload.apiKey ?? '').trim()),
        model: requestPayload.model,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        status: 'unreachable',
        message: formatConnectionFailureMessage(reason),
        recommendation: '看看地址和网络，本地服务的话确认一下有没有在跑。',
        checkedAt: new Date().toISOString(),
      }
    }
  })

  ipcMain.handle('chat:list-models', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateChatModelListPayload(payload)
    const requestPayload = await resolveVaultRefsForSender(event.sender, payload, ['apiKey'])
    const baseUrl = normalizeBaseUrl(requestPayload.baseUrl)
    const providerId = normalizeChatProviderId(requestPayload.providerId, baseUrl)

    if (!baseUrl) {
      return {
        ok: false,
        providerId,
        status: 'misconfigured',
        message: '还没填 API 地址呢。',
        recommendation: '本地 Ollama 一般用 http://127.0.0.1:11434/v1 哦。',
        checkedAt: new Date().toISOString(),
        discoveredModels: [],
      }
    }

    const safety = checkChatBaseUrlSafety(baseUrl)
    if (!safety.ok) {
      return {
        ok: false,
        providerId,
        status: 'misconfigured',
        message: `这个地址不太安全，没法用哦（${safety.reason}）。`,
        recommendation: '地址需要是正常的 http/https 网址，本地服务用 127.0.0.1 或 localhost 就好。',
        checkedAt: new Date().toISOString(),
        discoveredModels: [],
      }
    }

    const preflightFailure = getChatConnectionTestPreflightFailure({
      providerId,
      apiKey: requestPayload.apiKey,
    })
    if (preflightFailure) {
      return {
        ...preflightFailure,
        providerId,
        status: 'needs_key',
        recommendation: '填上 API Key 再来刷新就好。',
        checkedAt: new Date().toISOString(),
        discoveredModels: [],
      }
    }

    const requestSpec = buildChatModelListRequest({
      providerId,
      baseUrl,
      apiKey: requestPayload.apiKey,
      model: requestPayload.model,
    })

    try {
      const response = await performNetworkRequest(requestSpec.endpoint, {
        allowPrivateNetwork: true,
        ...requestSpec.request,
        // Re-check every redirect hop (see chat:test-connection) — model-list is
        // a non-streaming GET, safe to follow with per-hop SSRF revalidation.
        followRedirectsSafely: true,
        timeoutMs: CONNECTION_TEST_TIMEOUT_MS,
        timeoutMessage: '读取模型列表有点久，看看地址和网络对不对？',
      })
      const data = await response.json().catch(() => ({}))
      const discoveredModels = buildDiscoveredChatModels({ providerId, data })

      if (response.ok) {
        return {
          ok: discoveredModels.length > 0,
          providerId,
          status: discoveredModels.length > 0 ? 'ready' : 'model_missing',
          message: discoveredModels.length > 0
            ? `发现了 ${discoveredModels.length} 个可用模型。`
            : '连上了，不过暂时没发现可用模型。',
          recommendation: discoveredModels.length > 0
            ? ''
            : providerId === 'ollama'
              ? '运行 ollama pull qwen3:8b 装一个，或者装好别的模型再来刷新。'
              : '有些服务商不开放模型列表接口，手动填写模型名也可以的。',
          discoveredModels,
          checkedAt: new Date().toISOString(),
        }
      }

      const failure = summarizeChatConnectionTestFailure({
        providerId,
        status: response.status,
        data,
        hasApiKey: Boolean(String(requestPayload.apiKey ?? '').trim()),
        model: requestPayload.model,
      })

      return {
        ...failure,
        providerId,
        discoveredModels,
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        providerId,
        status: 'unreachable',
        message: formatConnectionFailureMessage(reason),
        recommendation: providerId === 'ollama'
          ? '确认 Ollama 有没有在跑，地址确认是 127.0.0.1:11434/v1。'
          : '看看地址和网络设置对不对。',
        discoveredModels: [],
        checkedAt: new Date().toISOString(),
      }
    }
  })

  ipcMain.handle('service:test-connection', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateServiceConnectionTestPayload(payload)
    const requestPayload = await resolveVaultRefsForSender(event.sender, payload, ['apiKey'])
    let baseUrl
    if (requestPayload.capability !== 'speech-output') {
      baseUrl = normalizeBaseUrl(requestPayload.baseUrl)
    } else {
      baseUrl = resolveSpeechOutputBaseUrl(requestPayload.providerId, requestPayload.baseUrl)
    }

    if (!baseUrl) {
      return {
        ok: false,
        message: '还没填 API 地址呢。',
      }
    }

    const safety = checkChatBaseUrlSafety(baseUrl)
    if (!safety.ok) {
      return {
        ok: false,
        message: `这个地址不太安全，没法用哦（${safety.reason}）。`,
      }
    }

    if (isVolcengineSpeechInputProvider(requestPayload.providerId) || isVolcengineSpeechOutputProvider(requestPayload.providerId)) {
      const credentials = parseVolcengineSpeechCredentials(requestPayload.apiKey)
      if (!credentials.appId || !credentials.accessToken) {
        return {
          ok: false,
          message: isVolcengineSpeechInputProvider(requestPayload.providerId)
            ? '火山语音识别需要在 API Key 那里填 APP_ID:ACCESS_TOKEN 的格式哦。'
            : '火山语音合成需要在 API Key 那里填 APP_ID:ACCESS_TOKEN 的格式哦。',
        }
      }
    }

    if (requestPayload.capability === 'speech-output') {
      try {
        return await runSpeechOutputConnectionSmokeTest(requestPayload, baseUrl)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)

        return {
          ok: false,
          message: formatConnectionFailureMessage(reason),
        }
      }
    }

    try {
      return await runSpeechInputConnectionSmokeTest(requestPayload, baseUrl)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      return {
        ok: false,
        message: formatConnectionFailureMessage(reason),
      }
    }
  })
}
