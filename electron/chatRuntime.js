function normalizeBaseUrl(value) {
  return String(value ?? '').trim().replace(/\/+$/u, '')
}

function stripAnthropicVersionSuffix(baseUrl) {
  return normalizeBaseUrl(baseUrl).replace(/\/v1$/iu, '')
}

function extractTextFromContent(content) {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part?.text === 'string') return part.text
        if (typeof part?.delta?.text === 'string') return part.delta.text
        return ''
      })
      .join('\n')
      .trim()
  }

  if (typeof content?.text === 'string') {
    return content.text.trim()
  }

  if (typeof content?.delta?.text === 'string') {
    return content.delta.text.trim()
  }

  return ''
}

const CHAT_PROVIDER_PROTOCOLS = Object.freeze({
  anthropic: 'anthropic',
  minimax: 'anthropic',
})

const CHAT_PROVIDER_API_KEY_POLICY = Object.freeze({
  custom: false,
  ollama: false,
})

export function normalizeChatProviderId(providerId, baseUrl = '') {
  const explicit = String(providerId ?? '').trim().toLowerCase()
  if (explicit) {
    return explicit
  }

  const normalized = normalizeBaseUrl(baseUrl).toLowerCase()
  if (!normalized) {
    return 'openai'
  }

  if (normalized.includes('api.anthropic.com')) return 'anthropic'
  if (normalized.includes('api.minimax.io/anthropic') || normalized.includes('api.minimaxi.com/anthropic')) {
    return 'minimax'
  }
  if (normalized.includes('openrouter.ai')) return 'openrouter'
  if (normalized.includes('api.together.xyz')) return 'together'
  if (normalized.includes('api.mistral.ai')) return 'mistral'
  if (normalized.includes('api.groq.com')) return 'groq'
  if (normalized.includes('api.deepseek.com')) return 'deepseek'
  if (normalized.includes('api.moonshot.ai') || normalized.includes('api.moonshot.cn')) return 'moonshot'
  if (normalized.includes('dashscope.aliyuncs.com')) return 'dashscope'
  if (normalized.includes('api.siliconflow.com') || normalized.includes('api.siliconflow.cn')) {
    return 'siliconflow'
  }
  if (normalized.includes('api.x.ai')) return 'xai'
  if (normalized.includes('qianfan.baidubce.com')) return 'qianfan'
  if (normalized.includes('api.z.ai') || normalized.includes('open.bigmodel.cn')) return 'zai'
  if (normalized.includes('bytepluses.com')) return 'byteplus'
  if (normalized.includes('integrate.api.nvidia.com')) return 'nvidia'
  if (normalized.includes('api.venice.ai')) return 'venice'
  if (normalized.includes('127.0.0.1:11434') || normalized.includes('localhost:11434')) return 'ollama'

  return 'openai'
}

export function getChatProviderProtocol(providerId, baseUrl = '') {
  const explicit = String(providerId ?? '').trim().toLowerCase()
  if (explicit === 'anthropic' || explicit === 'openai-compatible') {
    return explicit
  }

  const normalizedProviderId = normalizeChatProviderId(providerId, baseUrl)
  if (
    normalizedProviderId === 'minimax'
    && !normalizeBaseUrl(baseUrl).toLowerCase().includes('/anthropic')
  ) {
    return 'openai-compatible'
  }

  return CHAT_PROVIDER_PROTOCOLS[normalizedProviderId] ?? 'openai-compatible'
}

export function chatProviderRequiresApiKey(providerId) {
  const normalized = normalizeChatProviderId(providerId)
  return CHAT_PROVIDER_API_KEY_POLICY[normalized] ?? true
}

function buildChatAuthorizationHeaders(providerId, apiKey, baseUrl = '') {
  const normalizedProviderId = normalizeChatProviderId(providerId)
  const protocol = getChatProviderProtocol(normalizedProviderId, baseUrl)

  if (protocol === 'anthropic') {
    return {
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
      'anthropic-version': '2023-06-01',
    }
  }

  return apiKey
    ? {
        Authorization: `Bearer ${apiKey}`,
      }
    : {}
}

function splitSystemMessages(messages) {
  const system = []
  const normalizedMessages = []

  for (const message of Array.isArray(messages) ? messages : []) {
    const text = extractTextFromContent(message?.content)
    if (!text) {
      continue
    }

    if (message?.role === 'system') {
      system.push(text)
      continue
    }

    if (message?.role === 'assistant' || message?.role === 'user') {
      normalizedMessages.push({
        role: message.role,
        content: text,
      })
    }
  }

  return {
    system: system.join('\n\n').trim(),
    messages: normalizedMessages,
  }
}

function resolveAnthropicEndpoint(baseUrl, suffix) {
  const normalized = stripAnthropicVersionSuffix(baseUrl)
  return `${normalized}${suffix}`
}

export function buildChatRequest(payload, options = {}) {
  const providerId = normalizeChatProviderId(payload?.providerId, payload?.baseUrl)
  const baseUrl = normalizeBaseUrl(payload?.baseUrl)
  const protocol = getChatProviderProtocol(providerId, baseUrl)
  const stream = options.stream === true

  if (protocol === 'anthropic') {
    const normalizedMessages = splitSystemMessages(payload?.messages)

    // Convert OpenAI-style tools to Anthropic format
    const anthropicTools = Array.isArray(payload?.tools) && payload.tools.length > 0
      ? payload.tools.map((t) => ({
          name: t.function?.name ?? t.name,
          description: t.function?.description ?? t.description ?? '',
          input_schema: t.function?.parameters ?? t.parameters ?? { type: 'object', properties: {} },
        }))
      : undefined

    // Wrap system as a single text block with cache_control: ephemeral so the
    // Anthropic prompt cache can reuse the rendered prefix across turns.
    // Render order is tools → system → messages, so this one breakpoint
    // caches tool definitions + system together. Volatile per-turn content
    // (current date/time, correction hints) is injected into the last user
    // message by systemPromptBuilder so the cached prefix stays byte-stable.
    // Prompt caching is GA — no anthropic-beta header needed.
    const systemBlocks = normalizedMessages.system
      ? [{ type: 'text', text: normalizedMessages.system, cache_control: { type: 'ephemeral' } }]
      : undefined

    return {
      providerId,
      protocol,
      endpoint: resolveAnthropicEndpoint(baseUrl, '/v1/messages'),
      headers: {
        'Content-Type': 'application/json',
        ...buildChatAuthorizationHeaders(providerId, payload?.apiKey, baseUrl),
      },
      body: JSON.stringify({
        model: payload?.model,
        messages: normalizedMessages.messages,
        max_tokens: payload?.maxTokens ?? 500,
        temperature: payload?.temperature ?? 0.8,
        ...(systemBlocks ? { system: systemBlocks } : {}),
        ...(stream ? { stream: true } : {}),
        ...(anthropicTools ? { tools: anthropicTools } : {}),
      }),
    }
  }

  const tools = Array.isArray(payload?.tools) && payload.tools.length > 0
    ? payload.tools
    : undefined

  return {
    providerId,
    protocol,
    endpoint: `${baseUrl}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      ...buildChatAuthorizationHeaders(providerId, payload?.apiKey, baseUrl),
    },
    body: JSON.stringify({
      model: payload?.model,
      messages: payload?.messages,
      temperature: payload?.temperature ?? 0.8,
      max_tokens: payload?.maxTokens ?? 500,
      ...(stream ? { stream: true } : {}),
      ...(tools ? { tools } : {}),
    }),
  }
}

export function buildChatConnectionTestRequest(payload) {
  const providerId = normalizeChatProviderId(payload?.providerId, payload?.baseUrl)
  const baseUrl = normalizeBaseUrl(payload?.baseUrl)
  const protocol = getChatProviderProtocol(providerId, baseUrl)

  if (protocol === 'anthropic') {
    return {
      providerId,
      protocol,
      successKind: 'message',
      endpoint: resolveAnthropicEndpoint(baseUrl, '/v1/messages'),
      request: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildChatAuthorizationHeaders(providerId, payload?.apiKey, baseUrl),
        },
        body: JSON.stringify({
          model: payload?.model,
          max_tokens: 1,
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: 'Ping.',
            },
          ],
        }),
      },
    }
  }

  return {
    providerId,
    protocol,
    successKind: 'model_list',
    endpoint: `${baseUrl}/models`,
    request: {
      method: 'GET',
      headers: buildChatAuthorizationHeaders(providerId, payload?.apiKey, baseUrl),
    },
  }
}

export function extractChatResponseContent(providerId, payload) {
  if (getChatProviderProtocol(providerId) === 'anthropic') {
    return extractTextFromContent(payload?.content)
  }

  return extractTextFromContent(
    payload?.choices?.[0]?.message?.content
    ?? payload?.message?.content
    ?? payload?.content
    ?? '',
  )
}

/**
 * Extract `reasoning_content` (chain-of-thought trace) from a non-streaming
 * response. Thinking-mode models — DeepSeek-R1, QwQ, Hunyuan-thinking,
 * Qwen-thinking and similar — emit this alongside `content`, and reject any
 * follow-up turn whose previous assistant message omits it. Anthropic uses a
 * different `thinking` content block that this branch does not yet support.
 *
 * Returns '' when the model didn't produce a reasoning trace, or for any
 * provider/protocol that doesn't surface one.
 */
export function extractChatResponseReasoning(providerId, payload) {
  if (getChatProviderProtocol(providerId) === 'anthropic') {
    return ''
  }

  const value = payload?.choices?.[0]?.message?.reasoning_content
    ?? payload?.message?.reasoning_content
    ?? payload?.reasoning_content
  return typeof value === 'string' ? value : ''
}

/**
 * Extract tool_calls from the LLM response (OpenAI format).
 * For Anthropic, converts tool_use content blocks to OpenAI tool_calls format.
 */
export function extractChatResponseToolCalls(providerId, payload) {
  if (getChatProviderProtocol(providerId) === 'anthropic') {
    // Anthropic returns tool calls as content blocks with type "tool_use"
    const content = Array.isArray(payload?.content) ? payload.content : []
    const toolUseBlocks = content.filter((block) => block?.type === 'tool_use')
    if (!toolUseBlocks.length) return null

    return toolUseBlocks.map((block) => ({
      id: block.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
      type: 'function',
      function: {
        name: block.name,
        arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
      },
    }))
  }

  // OpenAI format
  const toolCalls = payload?.choices?.[0]?.message?.tool_calls
  if (!Array.isArray(toolCalls) || !toolCalls.length) return null
  return toolCalls
}

/**
 * Extract finish_reason from the LLM response.
 */
export function extractChatResponseFinishReason(providerId, payload) {
  if (getChatProviderProtocol(providerId) === 'anthropic') {
    return payload?.stop_reason ?? null
  }

  return payload?.choices?.[0]?.finish_reason ?? null
}

export function extractChatStreamingDeltaContent(providerId, payload) {
  if (getChatProviderProtocol(providerId) === 'anthropic') {
    return extractTextFromContent(
      payload?.delta?.text
      ?? payload?.content_block?.text
      ?? '',
    )
  }

  return extractTextFromContent(
    payload?.choices?.[0]?.delta?.content
    ?? payload?.choices?.[0]?.message?.content
    ?? payload?.message?.content
    ?? '',
  )
}

/**
 * Streaming counterpart to extractChatResponseReasoning. Pulls the
 * incremental reasoning fragment from a single SSE delta. OpenAI-compat
 * thinking models stream reasoning before content, on a separate
 * `delta.reasoning_content` field; the caller accumulates these the same
 * way it accumulates content deltas.
 */
export function extractChatStreamingDeltaReasoning(providerId, payload) {
  if (getChatProviderProtocol(providerId) === 'anthropic') {
    return ''
  }

  const value = payload?.choices?.[0]?.delta?.reasoning_content
    ?? payload?.choices?.[0]?.message?.reasoning_content
    ?? payload?.message?.reasoning_content
  return typeof value === 'string' ? value : ''
}

/**
 * Extract tool_call fragments from a single SSE delta payload.
 *
 * Returns an array of partial tool_call descriptors keyed by `index`, or null
 * when the delta carries no tool_call information. Each fragment may contribute
 * `id`, `type`, `function.name`, or a chunk of `function.arguments` — the
 * caller accumulates fragments with matching indexes across the stream.
 */
export function extractChatStreamingDeltaToolCalls(providerId, payload) {
  if (getChatProviderProtocol(providerId) === 'anthropic') {
    if (
      payload?.type === 'content_block_start'
      && payload?.content_block?.type === 'tool_use'
    ) {
      // Validate each field the same way the OpenAI branch does. Anthropic
      // generally sends id + name on the start event, but some proxies
      // (minimax's /anthropic adapter, self-hosted Claude gateways) have
      // been observed dropping one or the other — passing `undefined`
      // through would create a malformed tool_call the accumulator can't
      // serialise cleanly.
      const fragment = { index: Number(payload?.index ?? 0), type: 'function' }
      const blockId = payload.content_block.id
      const blockName = payload.content_block.name
      if (typeof blockId === 'string' && blockId) fragment.id = blockId
      const fn = { arguments: '' }
      if (typeof blockName === 'string' && blockName) fn.name = blockName
      fragment.function = fn
      return [fragment]
    }
    if (
      payload?.type === 'content_block_delta'
      && payload?.delta?.type === 'input_json_delta'
    ) {
      return [{
        index: Number(payload?.index ?? 0),
        function: { arguments: payload.delta.partial_json ?? '' },
      }]
    }
    return null
  }

  const deltaCalls = payload?.choices?.[0]?.delta?.tool_calls
  if (!Array.isArray(deltaCalls) || !deltaCalls.length) return null

  return deltaCalls.map((tc, fallbackIndex) => {
    const fragment = { index: Number(tc?.index ?? fallbackIndex) }
    if (typeof tc?.id === 'string' && tc.id) fragment.id = tc.id
    if (typeof tc?.type === 'string' && tc.type) fragment.type = tc.type
    if (tc?.function && typeof tc.function === 'object') {
      const fn = {}
      if (typeof tc.function.name === 'string' && tc.function.name) {
        fn.name = tc.function.name
      }
      if (typeof tc.function.arguments === 'string') {
        fn.arguments = tc.function.arguments
      }
      if (Object.keys(fn).length > 0) fragment.function = fn
    }
    return fragment
  })
}

export function isChatStreamingPayloadTerminal(providerId, payload) {
  if (getChatProviderProtocol(providerId) === 'anthropic') {
    return payload?.type === 'message_stop' || payload?.type === 'error'
  }

  const finishReason = String(payload?.choices?.[0]?.finish_reason ?? '')
    .trim()
    .toLowerCase()

  if (finishReason && finishReason !== 'null') {
    return true
  }

  return payload?.done === true || payload?.stop === true
}

export function trimRepeatedStreamingDelta(fullContent, incomingDelta) {
  const delta = String(incomingDelta ?? '')
  if (!delta) return ''
  if (!fullContent) return delta

  if (delta.startsWith(fullContent)) {
    return delta.slice(fullContent.length)
  }

  if (fullContent.endsWith(delta)) {
    return ''
  }

  const maxOverlap = Math.min(fullContent.length, delta.length, 200)
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (fullContent.endsWith(delta.slice(0, overlap))) {
      return delta.slice(overlap)
    }
  }

  return delta
}
