function normalizeBaseUrl(value) {
  return String(value ?? '').trim().replace(/\/+$/u, '')
}

function stripAnthropicVersionSuffix(baseUrl) {
  return normalizeBaseUrl(baseUrl).replace(/\/v1$/iu, '')
}

function isAnthropicCompatibleBaseUrl(baseUrl) {
  return /\/anthropic(?:\/v1)?$/iu.test(normalizeBaseUrl(baseUrl))
}

function extractTextFromContent(content, { trim = true } = {}) {
  const normalize = (text) => trim ? text.trim() : text

  if (typeof content === 'string') {
    return normalize(content)
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part?.text === 'string') return part.text
        if (typeof part?.delta?.text === 'string') return part.delta.text
        return ''
      })
      .join('\n')
    return normalize(text)
  }

  if (typeof content?.text === 'string') {
    return normalize(content.text)
  }

  if (typeof content?.delta?.text === 'string') {
    return normalize(content.delta.text)
  }

  return ''
}

function hasNonEmptyString(value) {
  return String(value ?? '').trim().length > 0
}

function modelSupportsVision(model) {
  const id = String(model ?? '').trim()
  if (!id) return false
  return [
    /gpt-4o(?!-mini-tts|-mini-transcribe|-transcribe)/i,
    /gpt-4\.1/i,
    /gpt-4-vision/i,
    /gpt-4-turbo/i,
    /gpt-5/i,
    /\bo3\b|\bo4\b/i,
    /claude-3/i,
    /claude-4/i,
    /claude-5/i,
    /claude-(opus|sonnet|haiku)/i,
    /gemini/i,
    /qwen.*-vl/i,
    /qwen2(\.5)?-vl/i,
    /\bvl-/i,
    /-vl\b/i,
    /\bvision\b/i,
    /pixtral/i,
    /llava/i,
    /llama-?\d+(\.\d+)?-vision/i,
    /minicpm-?v/i,
    /moondream/i,
    /internvl/i,
    /cogvlm/i,
    /yi-vl/i,
    /glm-4v/i,
    /step-1v/i,
  ].some((pattern) => pattern.test(id))
}

function modelSupportsSpeech(model) {
  const id = String(model ?? '').trim().toLowerCase()
  return Boolean(id && /realtime|audio|voice|tts|transcribe|speech/.test(id))
}

function estimateModelContextWindowTokens(model) {
  const id = String(model ?? '').trim().toLowerCase()
  if (!id) return null
  if (/2m|2000k|grok-4\.20|grok-4-1-fast|grok-4-fast/.test(id)) return 2_000_000
  if (/gpt-5\.4-mini/.test(id)) return 400_000
  if (/gpt-5\.4-nano/.test(id)) return 128_000
  if (/qwen3\.6-max/.test(id)) return 256_000
  if (/1m|1000k|grok-4\.3|gpt-5\.5|gpt-5\.4|gemini-(3|2\.5)|deepseek-v4|deepseek-chat|deepseek-reasoner|qwen3\.7|qwen3\.6|qwen3\.5-(plus|flash)|qwen3-coder-(plus|flash)|claude-opus-4-8|claude-opus-4-7|claude-sonnet-4-6/.test(id)) return 1_000_000
  if (/260k|256k|250k|grok-build|qwen3-max|qwen3-(235b|next|32b|30b|14b|8b|4b|1\.7b|0\.6b)|qwen3\.5-\d|kimi-k2|moonshotai\/kimi-k2|doubao-seed-2|seed-2|dola-seed-2|mistral-(large|medium-3-5)|mistral-small-2603|magistral|devstral/.test(id)) return 256_000
  if (/200k|claude|sonnet|opus|haiku|minimax-m2|glm-5|glm-4\.7/.test(id)) return 200_000
  if (/128k|qwen3|max|gpt-5|gpt-4\.1|o3|o4|ernie-5|llama-3\.3|nemotron/.test(id)) return 128_000
  if (/64k/.test(id)) return 64_000
  if (/32k|codestral|qwen.*coder|coder/.test(id)) return 32_000
  if (/16k|llama-3|mistral-small/.test(id)) return 16_000
  if (/8k|qwen3:8b|qwen2|llama|mistral-7b/.test(id)) return 8_000
  return null
}

function getProviderRunLocation(providerId) {
  const normalized = normalizeChatProviderId(providerId)
  if (normalized === 'ollama') return 'local'
  if (normalized === 'custom') return 'custom'
  return 'cloud'
}

function buildDiscoveredModel(providerId, entry) {
  const id = String(entry?.id ?? entry?.name ?? entry?.model ?? '').trim()
  if (!id) return null
  const normalizedProviderId = normalizeChatProviderId(providerId)

  return {
    id,
    label: id,
    providerId: normalizedProviderId,
    source: normalizedProviderId === 'ollama' ? 'ollama' : 'preset',
    sizeBytes: typeof entry?.size === 'number' ? entry.size : null,
    modifiedAt: typeof entry?.modified_at === 'string' ? entry.modified_at : null,
    family: typeof entry?.details?.family === 'string' ? entry.details.family : null,
    capabilities: {
      runLocation: getProviderRunLocation(normalizedProviderId),
      supportsTools: true,
      supportsVision: modelSupportsVision(id),
      supportsSpeech: modelSupportsSpeech(id),
      contextWindowTokens: estimateModelContextWindowTokens(id),
      requiresApiKey: chatProviderRequiresApiKey(normalizedProviderId),
    },
  }
}

export function extractChatModelEntries(data) {
  if (Array.isArray(data?.data)) {
    return data.data
      .map((item) => ({ ...item, id: String(item?.id ?? '').trim() }))
      .filter((item) => item.id)
  }

  if (Array.isArray(data?.models)) {
    return data.models
      .map((item) => ({
        ...item,
        id: String(item?.name ?? item?.model ?? item?.id ?? '').trim(),
      }))
      .filter((item) => item.id)
  }

  return []
}

export function buildDiscoveredChatModels({ providerId, data }) {
  return extractChatModelEntries(data)
    .map((entry) => buildDiscoveredModel(providerId, entry))
    .filter(Boolean)
}

const CHAT_PROVIDER_PROTOCOLS = Object.freeze({
  anthropic: 'anthropic',
  'kimi-coding': 'anthropic',
  'kimi-coding-global': 'anthropic',
  minimax: 'anthropic',
  'minimax-global': 'anthropic',
  'minimax-coding': 'anthropic',
  'minimax-coding-global': 'anthropic',
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
  if (normalized.includes('api.minimax.io/anthropic')) {
    return 'minimax-global'
  }
  if (normalized.includes('api.minimaxi.com/anthropic')) {
    return 'minimax'
  }
  if (normalized.includes('openrouter.ai')) return 'openrouter'
  if (normalized.includes('api.together.xyz')) return 'together'
  if (normalized.includes('api.mistral.ai')) return 'mistral'
  if (normalized.includes('api.groq.com')) return 'groq'
  if (normalized.includes('api.deepseek.com')) return 'deepseek'
  if (normalized.includes('api.moonshot.ai/anthropic')) return 'kimi-coding-global'
  if (normalized.includes('api.moonshot.cn/anthropic')) return 'kimi-coding'
  if (normalized.includes('api.moonshot.ai')) return 'moonshot-global'
  if (normalized.includes('api.moonshot.cn')) return 'moonshot'
  if (normalized.includes('coding.dashscope.aliyuncs.com')) return 'modelstudio-coding'
  if (normalized.includes('dashscope.aliyuncs.com')) return 'dashscope'
  if (normalized.includes('api.siliconflow.com') || normalized.includes('api.siliconflow.cn')) {
    return 'siliconflow'
  }
  if (normalized.includes('api.x.ai')) return 'xai'
  if (normalized.includes('qianfan.baidubce.com')) return 'qianfan'
  if (normalized.includes('api.z.ai') || normalized.includes('open.bigmodel.cn')) return 'zai'
  if (normalized.includes('ark.cn-beijing.volces.com/api/coding')) return 'doubao-coding'
  if (normalized.includes('ark.cn-beijing.volces.com')) return 'doubao'
  if (normalized.includes('bytepluses.com/api/coding')) return 'byteplus-coding'
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

  if (isAnthropicCompatibleBaseUrl(baseUrl)) {
    return 'anthropic'
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

export function getChatConnectionTestPreflightFailure({ providerId, apiKey }) {
  const normalizedProviderId = normalizeChatProviderId(providerId)
  if (!chatProviderRequiresApiKey(normalizedProviderId) || hasNonEmptyString(apiKey)) {
    return null
  }

  if (normalizedProviderId === 'deepseek') {
    return {
      ok: false,
      message: 'DeepSeek API 需要先填写 API Key。请在模型设置里选择 DeepSeek，并填入 DeepSeek 控制台生成的 API Key。',
    }
  }

  return {
    ok: false,
    message: '请先填写 API Key。',
  }
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

function shouldOmitAnthropicTemperature(model) {
  const id = String(model ?? '').trim().toLowerCase()
  return /^claude-opus-4-[78](?:\b|$)/u.test(id)
}

function shouldDisableOpenAiCompatibleThinking(providerId, model) {
  const normalizedProviderId = normalizeChatProviderId(providerId)
  const id = String(model ?? '').trim().toLowerCase()
  return normalizedProviderId === 'deepseek' && /^deepseek-v4-(?:flash|pro)(?:\b|$)/u.test(id)
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
        ...(
          shouldOmitAnthropicTemperature(payload?.model)
            ? {}
            : { temperature: payload?.temperature ?? 0.8 }
        ),
        ...(systemBlocks ? { system: systemBlocks } : {}),
        ...(stream ? { stream: true } : {}),
        ...(anthropicTools ? { tools: anthropicTools } : {}),
      }),
    }
  }

  const tools = Array.isArray(payload?.tools) && payload.tools.length > 0
    ? payload.tools
    : undefined
  const openAiBody = {
    model: payload?.model,
    messages: payload?.messages,
    temperature: payload?.temperature ?? 0.8,
    max_tokens: payload?.maxTokens ?? 500,
    ...(stream ? { stream: true } : {}),
    ...(tools ? { tools } : {}),
  }

  if (shouldDisableOpenAiCompatibleThinking(providerId, payload?.model)) {
    openAiBody.thinking = { type: 'disabled' }
  }

  return {
    providerId,
    protocol,
    endpoint: `${baseUrl}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      ...buildChatAuthorizationHeaders(providerId, payload?.apiKey, baseUrl),
    },
    body: JSON.stringify(openAiBody),
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

export function buildChatModelListRequest(payload) {
  const providerId = normalizeChatProviderId(payload?.providerId, payload?.baseUrl)
  const baseUrl = normalizeBaseUrl(payload?.baseUrl)
  const protocol = getChatProviderProtocol(providerId, baseUrl)

  return {
    providerId,
    protocol,
    endpoint: protocol === 'anthropic'
      ? resolveAnthropicEndpoint(baseUrl, '/v1/models')
      : `${baseUrl}/models`,
    request: {
      method: 'GET',
      headers: buildChatAuthorizationHeaders(providerId, payload?.apiKey, baseUrl),
    },
  }
}

export function summarizeChatConnectionTestSuccess({ providerId, successKind, data, model }) {
  const checkedAt = new Date().toISOString()
  if (successKind === 'message') {
    return {
      ok: true,
      status: 'ready',
      message: '连接成功，已收到模型响应。',
      checkedAt,
    }
  }

  const discoveredModels = buildDiscoveredChatModels({ providerId, data })
  const modelIds = discoveredModels.map((item) => item.id)
  const requestedModel = String(model ?? '').trim()
  const normalizedProviderId = normalizeChatProviderId(providerId)

  if (normalizedProviderId === 'ollama') {
    if (!modelIds.length) {
      return {
        ok: false,
        status: 'model_missing',
        message: 'Ollama 已连接，但还没有发现可用模型。请先运行：ollama pull qwen3:8b。',
        recommendation: '运行 ollama pull qwen3:8b，或在 Ollama 中安装任意可用聊天模型后刷新。',
        discoveredModels,
        checkedAt,
      }
    }

    if (requestedModel && !modelIds.includes(requestedModel)) {
      return {
        ok: false,
        status: 'model_missing',
        message: `Ollama 已连接，但没有找到模型「${requestedModel}」。请先运行：ollama pull ${requestedModel}，或在设置里填写已安装模型。`,
        recommendation: `运行 ollama pull ${requestedModel}，或在模型列表里选择已安装模型。`,
        discoveredModels,
        checkedAt,
      }
    }
  }

  if (modelIds.length) {
    return {
      ok: true,
      status: 'ready',
      message: `连接成功，可用模型示例：${modelIds.slice(0, 3).join(', ')}`,
      discoveredModels,
      checkedAt,
    }
  }

  return {
    ok: true,
    status: 'ready',
    message: '连接成功，接口已正常响应。',
    discoveredModels,
    checkedAt,
  }
}

function extractConnectionFailureMessage(data) {
  const value = data?.error?.message
    ?? data?.error
    ?? data?.message
  if (typeof value === 'string') {
    return value.trim()
  }
  return ''
}

export function summarizeChatConnectionTestFailure({ providerId, status, data, hasApiKey, model }) {
  const checkedAt = new Date().toISOString()
  const normalizedProviderId = normalizeChatProviderId(providerId)
  const rawMessage = extractConnectionFailureMessage(data)
  const requestedModel = String(model ?? '').trim()

  if (status === 401) {
    if (normalizedProviderId === 'deepseek') {
      return {
        ok: false,
        status: 'needs_key',
        message: hasApiKey
          ? 'DeepSeek API Key 无效或已失效，请检查 DeepSeek 控制台中的 Key。'
          : 'DeepSeek API 需要先填写 API Key。请在模型设置里选择 DeepSeek，并填入 DeepSeek 控制台生成的 API Key。',
        recommendation: '打开 DeepSeek 控制台重新生成 API Key，并确认当前账号余额与模型权限。',
        checkedAt,
      }
    }

    return {
      ok: false,
      status: 'needs_key',
      message: hasApiKey
        ? 'URL 可访问，但 API Key 无效或已失效。'
        : 'URL 可访问，但还没有填写 API Key。',
      recommendation: '检查 API Key 是否填入、是否过期，以及当前 provider 是否要求 Bearer token。',
      checkedAt,
    }
  }

  if (normalizedProviderId === 'deepseek') {
    if (status === 402 || status === 403) {
      return {
        ok: false,
        status: 'needs_key',
        message: rawMessage || 'DeepSeek API 返回权限或余额限制，请检查账号余额、模型权限和 API Key 状态。',
        recommendation: '检查 DeepSeek 账号余额、模型权限和 API Key 状态。',
        checkedAt,
      }
    }

    if (status === 404) {
      return {
        ok: false,
        status: 'misconfigured',
        message: 'DeepSeek API 地址或模型名不匹配。建议 Base URL 使用 https://api.deepseek.com，模型先用 deepseek-v4-flash。',
        recommendation: 'Base URL 改为 https://api.deepseek.com，模型先用 deepseek-v4-flash。',
        checkedAt,
      }
    }

    if (requestedModel && /model|模型|not found|does not exist/i.test(rawMessage)) {
      return {
        ok: false,
        status: 'model_missing',
        message: `DeepSeek 没有接受当前模型「${requestedModel}」。建议先改成 deepseek-v4-flash，再重新测试。`,
        recommendation: '模型先改成 deepseek-v4-flash；如果需要更强推理，再切 deepseek-v4-pro。',
        checkedAt,
      }
    }
  }

  return {
    ok: false,
    status: status >= 500 ? 'unreachable' : 'error',
    message: rawMessage || `接口返回异常状态：${status}`,
    recommendation: '检查 API Base URL、网络代理、模型名和服务商状态。',
    checkedAt,
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
      { trim: false },
    )
  }

  return extractTextFromContent(
    payload?.choices?.[0]?.delta?.content
    ?? payload?.choices?.[0]?.message?.content
    ?? payload?.message?.content
    ?? '',
    { trim: false },
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
      // generally sends id + name on the start event, but some compatible
      // Anthropic-style gateways have
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
