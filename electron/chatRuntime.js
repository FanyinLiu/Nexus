import {
  CHAT_CONNECTION_MESSAGE,
  CHAT_CONNECTION_RECOMMENDATION,
  buildChatConnectionResult,
  classifyChatMessageProbeIdentity,
} from './services/chatConnectionProof.js'

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

function isMiniMaxTokenPlanProvider(providerId) {
  const normalizedProviderId = normalizeChatProviderId(providerId)
  return normalizedProviderId === 'minimax-coding'
    || normalizedProviderId === 'minimax-coding-global'
}

function formatInvalidChatApiKeyMessage(providerId) {
  const label = isMiniMaxTokenPlanProvider(providerId)
    ? 'MiniMax Token Plan API Key'
    : 'API Key'
  return `${label} 格式好像不太对：里面有中文、换行、空格之类不能用于 HTTP Header 的字符。只填服务商控制台生成的原始 Key 就好，不要包含套餐说明、模型名或备注。`
}

function classifyInvalidChatApiKeyCode(apiKey) {
  const value = String(apiKey ?? '').trim()
  if (/[一-鿿぀-ゟ゠-ヿ가-힯]/u.test(value)) return 'api_key_contains_cjk'
  if (/\s/u.test(value)) return 'api_key_contains_whitespace'
  return 'api_key_header_unsafe'
}

function normalizeChatApiKeyForHeader(providerId, apiKey) {
  const value = String(apiKey ?? '').trim()
  if (!value) return ''

  if (/[^\x21-\x7E]/u.test(value)) {
    const error = new Error(formatInvalidChatApiKeyMessage(providerId))
    error.code = classifyInvalidChatApiKeyCode(value)
    throw error
  }

  return value
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
  if (/1m|1000k|minimax-m3|grok-4\.3|gpt-5\.5|gpt-5\.4|gemini-(3|2\.5)|deepseek-v4|deepseek-chat|deepseek-reasoner|qwen3\.7|qwen[.-]3[.-]7|qwen[.-]3[.-]6-(plus|flash)|qwen3\.6|qwen3\.5-(plus|flash)|qwen3-coder-(plus|flash)|claude-opus-4-8|claude-opus-4-7|claude-sonnet-4-6/.test(id)) return 1_000_000
  if (/260k|256k|250k|grok-build|qwen3-max|qwen3-coder-(next|480)|qwen3-(235b|next|32b|30b|14b|8b|6|5|4b|1\.7b|0\.6b)|qwen3\.5-\d|kimi-k2|moonshotai\/kimi-k2|doubao-seed-2|seed-2|dola-seed-2|mistral-(large|medium-3-5)|mistral-small-2603|magistral|devstral/.test(id)) return 256_000
  if (/200k|claude|sonnet|opus|haiku|minimax-m2|glm-5|glm-4\.7/.test(id)) return 200_000
  if (/128k|qwen3|max|gpt-5|gpt-4\.1|o3|o4|ernie-5|llama-3\.3|nemotron/.test(id)) return 128_000
  if (/ernie-x1\.1/.test(id)) return 64_000
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

const CHAT_PROVIDER_BASE_URL_MATCHERS = Object.freeze([
  ['api.anthropic.com', 'anthropic'],
  ['api.minimax.io/anthropic', 'minimax-global'],
  ['api.minimaxi.com/anthropic', 'minimax'],
  ['openrouter.ai', 'openrouter'],
  ['api.together.xyz', 'together'],
  ['api.mistral.ai', 'mistral'],
  ['api.groq.com', 'groq'],
  ['api.deepseek.com', 'deepseek'],
  ['api.moonshot.ai/anthropic', 'kimi-coding-global'],
  ['api.moonshot.cn/anthropic', 'kimi-coding'],
  ['api.moonshot.ai', 'moonshot-global'],
  ['api.moonshot.cn', 'moonshot'],
  ['coding.dashscope.aliyuncs.com', 'modelstudio-coding'],
  ['dashscope-intl.aliyuncs.com', 'dashscope-global'],
  ['dashscope.aliyuncs.com', 'dashscope'],
  ['api.siliconflow.com', 'siliconflow-global'],
  ['api.siliconflow.cn', 'siliconflow'],
  ['api.x.ai', 'xai'],
  ['qianfan.baidubce.com', 'qianfan'],
  ['api.z.ai', 'zai'],
  ['open.bigmodel.cn', 'zai'],
  ['ark.cn-beijing.volces.com/api/coding', 'doubao-coding'],
  ['ark.cn-beijing.volces.com', 'doubao'],
  ['bytepluses.com/api/coding', 'byteplus-coding'],
  ['bytepluses.com', 'byteplus'],
  ['integrate.api.nvidia.com', 'nvidia'],
  ['api.venice.ai', 'venice'],
  ['127.0.0.1:11434', 'ollama'],
  ['localhost:11434', 'ollama'],
])

export function normalizeChatProviderId(providerId, baseUrl = '') {
  const explicit = String(providerId ?? '').trim().toLowerCase()
  if (explicit) {
    return explicit
  }

  const normalized = normalizeBaseUrl(baseUrl).toLowerCase()
  if (!normalized) {
    return 'openai'
  }

  for (const [needle, inferredProviderId] of CHAT_PROVIDER_BASE_URL_MATCHERS) {
    if (normalized.includes(needle)) return inferredProviderId
  }

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
  if (!chatProviderRequiresApiKey(normalizedProviderId)) {
    return null
  }

  if (hasNonEmptyString(apiKey)) {
    try {
      normalizeChatApiKeyForHeader(normalizedProviderId, apiKey)
    } catch (error) {
      return buildChatConnectionResult({
        ok: false,
        status: 'needs_key',
        code: error?.code || 'api_key_header_unsafe',
        messageKey: CHAT_CONNECTION_MESSAGE.API_KEY_HEADER_UNSAFE,
        recommendationKey: CHAT_CONNECTION_RECOMMENDATION.API_KEY_HEADER_UNSAFE,
        diagnosticDetail: error instanceof Error ? error.message : undefined,
      })
    }
    return null
  }

  if (normalizedProviderId === 'deepseek') {
    return buildChatConnectionResult({
      ok: false,
      status: 'needs_key',
      code: 'missing_api_key',
      messageKey: CHAT_CONNECTION_MESSAGE.MISSING_API_KEY_DEEPSEEK,
      recommendationKey: CHAT_CONNECTION_RECOMMENDATION.MISSING_API_KEY,
    })
  }

  return buildChatConnectionResult({
    ok: false,
    status: 'needs_key',
    code: 'missing_api_key',
    messageKey: CHAT_CONNECTION_MESSAGE.MISSING_API_KEY,
    recommendationKey: CHAT_CONNECTION_RECOMMENDATION.MISSING_API_KEY,
  })
}

function buildChatAuthorizationHeaders(providerId, apiKey, baseUrl = '') {
  const normalizedProviderId = normalizeChatProviderId(providerId)
  const protocol = getChatProviderProtocol(normalizedProviderId, baseUrl)
  const apiKeyHeaderValue = normalizeChatApiKeyForHeader(normalizedProviderId, apiKey)

  if (protocol === 'anthropic') {
    return {
      ...(apiKeyHeaderValue ? { 'x-api-key': apiKeyHeaderValue } : {}),
      'anthropic-version': '2023-06-01',
    }
  }

  return apiKeyHeaderValue
    ? {
        Authorization: `Bearer ${apiKeyHeaderValue}`,
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

function shouldDisableAnthropicThinking(providerId, model) {
  const normalizedProviderId = normalizeChatProviderId(providerId)
  const id = String(model ?? '').trim().toLowerCase()
  return (
    (
      normalizedProviderId === 'minimax'
      || normalizedProviderId === 'minimax-global'
      || normalizedProviderId === 'minimax-coding'
      || normalizedProviderId === 'minimax-coding-global'
    )
    && /^minimax-m3(?:\b|$)/u.test(id)
  )
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
        ...(shouldDisableAnthropicThinking(providerId, payload?.model) ? { thinking: { type: 'disabled' } } : {}),
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
  const probe = buildChatRequest({
    providerId,
    baseUrl,
    apiKey: payload?.apiKey,
    model: payload?.model,
    maxTokens: 1,
    temperature: 0,
    messages: [{ role: 'user', content: 'Reply with OK.' }],
  })

  return {
    providerId,
    protocol,
    successKind: 'message',
    endpoint: probe.endpoint,
    request: {
      method: 'POST',
      headers: probe.headers,
      body: probe.body,
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
    const protocol = getChatProviderProtocol(providerId)
    const hasTopLevelError = Boolean(data?.error)
    const hasResponse = !hasTopLevelError && (protocol === 'anthropic'
      ? Array.isArray(data?.content) && data.content.some((item) => (
        item?.type === 'text' && typeof item.text === 'string' && item.text.trim().length > 0
      ))
      : Array.isArray(data?.choices) && data.choices.some((item) => {
        const message = item?.message
        if (!message || typeof message !== 'object' || item?.error) return false
        return (typeof message.content === 'string' && message.content.trim().length > 0)
          || (typeof message.reasoning_content === 'string' && message.reasoning_content.trim().length > 0)
          || (Array.isArray(message.tool_calls) && message.tool_calls.length > 0)
      }))

    if (!hasResponse) {
      return buildChatConnectionResult({
        ok: false,
        status: 'error',
        code: 'invalid_probe_response',
        messageKey: CHAT_CONNECTION_MESSAGE.INVALID_PROBE,
        recommendationKey: CHAT_CONNECTION_RECOMMENDATION.INVALID_PROBE,
        checkedAt,
      })
    }

    const { evidence } = classifyChatMessageProbeIdentity({
      providerId,
      modelId: model,
      data,
    })
    const identityMismatch = Boolean(evidence.identityMismatch || evidence.usedFallback)
    const identityUnverified = !evidence.observedModelId

    return buildChatConnectionResult({
      ok: true,
      // Identity mismatch remains ok:true with partial evidence so the UI can
      // show partial rather than hard error for a working path that answered
      // with a different model than requested.
      status: identityMismatch ? 'error' : identityUnverified ? 'partial' : 'ready',
      messageKey: identityMismatch
        ? CHAT_CONNECTION_MESSAGE.IDENTITY_MISMATCH
        : identityUnverified
          ? CHAT_CONNECTION_MESSAGE.IDENTITY_UNVERIFIED
        : CHAT_CONNECTION_MESSAGE.READY,
      recommendationKey: identityUnverified
        ? CHAT_CONNECTION_RECOMMENDATION.IDENTITY_UNVERIFIED
        : undefined,
      evidence,
      checkedAt,
    })
  }

  // Model-list success is discovery-only proof. It must never paint green
  // connection readiness for the configured chat model.
  const discoveredModels = buildDiscoveredChatModels({ providerId, data })
  const modelIds = discoveredModels.map((item) => item.id)
  const requestedModel = String(model ?? '').trim()
  const normalizedProviderId = normalizeChatProviderId(providerId)

  if (normalizedProviderId === 'ollama') {
    if (!modelIds.length) {
      return buildChatConnectionResult({
        ok: false,
        status: 'model_missing',
        code: 'missing_model',
        messageKey: CHAT_CONNECTION_MESSAGE.MODEL_MISSING_OLLAMA,
        recommendationKey: CHAT_CONNECTION_RECOMMENDATION.MODEL_MISSING_OLLAMA,
        discoveredModels,
        checkedAt,
      })
    }

    if (requestedModel && !modelIds.includes(requestedModel)) {
      return buildChatConnectionResult({
        ok: false,
        status: 'model_missing',
        code: 'model_not_found',
        messageKey: CHAT_CONNECTION_MESSAGE.MODEL_NOT_FOUND_OLLAMA,
        recommendationKey: CHAT_CONNECTION_RECOMMENDATION.MODEL_NOT_FOUND_OLLAMA,
        messageParams: { model: requestedModel },
        discoveredModels,
        checkedAt,
      })
    }
  }

  return buildChatConnectionResult({
    ok: true,
    status: 'error',
    code: 'invalid_probe_response',
    messageKey: CHAT_CONNECTION_MESSAGE.MODEL_LIST_NOT_PROOF,
    recommendationKey: CHAT_CONNECTION_RECOMMENDATION.MODEL_LIST_NOT_PROOF,
    evidence: {
      kind: 'model-list',
      providerId: normalizedProviderId,
      ...(requestedModel ? { modelId: requestedModel } : {}),
      partial: true,
    },
    discoveredModels,
    checkedAt,
  })
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
  // Provider bodies stay diagnostic-only — never the primary UI message.
  const diagnosticDetail = rawMessage || undefined

  if (status === 401) {
    if (normalizedProviderId === 'deepseek') {
      return buildChatConnectionResult({
        ok: false,
        status: 'needs_key',
        code: 'auth_failed',
        messageKey: hasApiKey
          ? CHAT_CONNECTION_MESSAGE.AUTH_FAILED_DEEPSEEK
          : CHAT_CONNECTION_MESSAGE.AUTH_FAILED_DEEPSEEK_MISSING,
        recommendationKey: CHAT_CONNECTION_RECOMMENDATION.AUTH_FAILED_DEEPSEEK,
        checkedAt,
        diagnosticDetail,
      })
    }

    return buildChatConnectionResult({
      ok: false,
      status: 'needs_key',
      code: 'auth_failed',
      messageKey: hasApiKey
        ? CHAT_CONNECTION_MESSAGE.AUTH_FAILED
        : CHAT_CONNECTION_MESSAGE.AUTH_FAILED_MISSING_KEY,
      recommendationKey: CHAT_CONNECTION_RECOMMENDATION.AUTH_FAILED,
      checkedAt,
      diagnosticDetail,
    })
  }

  if (normalizedProviderId === 'deepseek') {
    if (status === 402 || status === 403) {
      return buildChatConnectionResult({
        ok: false,
        status: 'needs_key',
        code: 'quota_or_permission',
        messageKey: CHAT_CONNECTION_MESSAGE.QUOTA_OR_PERMISSION_DEEPSEEK,
        recommendationKey: CHAT_CONNECTION_RECOMMENDATION.QUOTA_OR_PERMISSION_DEEPSEEK,
        checkedAt,
        diagnosticDetail,
      })
    }

    if (status === 404) {
      return buildChatConnectionResult({
        ok: false,
        status: 'misconfigured',
        code: 'invalid_api_base_url',
        messageKey: CHAT_CONNECTION_MESSAGE.INVALID_BASE_URL_DEEPSEEK,
        recommendationKey: CHAT_CONNECTION_RECOMMENDATION.INVALID_BASE_URL_DEEPSEEK,
        checkedAt,
        diagnosticDetail,
      })
    }

    if (requestedModel && /model|模型|not found|does not exist/i.test(rawMessage)) {
      return buildChatConnectionResult({
        ok: false,
        status: 'model_missing',
        code: 'model_not_found',
        messageKey: CHAT_CONNECTION_MESSAGE.MODEL_NOT_FOUND_DEEPSEEK,
        recommendationKey: CHAT_CONNECTION_RECOMMENDATION.MODEL_NOT_FOUND_DEEPSEEK,
        messageParams: { model: requestedModel },
        checkedAt,
        diagnosticDetail,
      })
    }
  }

  if (status === 429) {
    return buildChatConnectionResult({
      ok: false,
      status: 'error',
      code: 'rate_limited',
      messageKey: CHAT_CONNECTION_MESSAGE.RATE_LIMITED,
      recommendationKey: CHAT_CONNECTION_RECOMMENDATION.RATE_LIMITED,
      checkedAt,
      diagnosticDetail,
    })
  }

  if ((status === 402 || status === 403) && normalizedProviderId !== 'deepseek') {
    return buildChatConnectionResult({
      ok: false,
      status: 'needs_key',
      code: 'quota_or_permission',
      messageKey: CHAT_CONNECTION_MESSAGE.QUOTA_OR_PERMISSION,
      recommendationKey: CHAT_CONNECTION_RECOMMENDATION.QUOTA_OR_PERMISSION,
      checkedAt,
      diagnosticDetail,
    })
  }

  if (status === 404 && requestedModel) {
    return buildChatConnectionResult({
      ok: false,
      status: 'model_missing',
      code: 'model_not_found',
      messageKey: CHAT_CONNECTION_MESSAGE.MODEL_NOT_FOUND,
      recommendationKey: CHAT_CONNECTION_RECOMMENDATION.MODEL_NOT_FOUND,
      messageParams: { model: requestedModel },
      checkedAt,
      diagnosticDetail,
    })
  }

  if (status === 408) {
    return buildChatConnectionResult({
      ok: false,
      status: 'unreachable',
      code: 'request_timeout',
      messageKey: CHAT_CONNECTION_MESSAGE.REQUEST_TIMEOUT,
      recommendationKey: CHAT_CONNECTION_RECOMMENDATION.REQUEST_TIMEOUT,
      checkedAt,
      diagnosticDetail,
    })
  }

  if (status === 502 || status === 503) {
    return buildChatConnectionResult({
      ok: false,
      status: 'unreachable',
      code: 'provider_server_error',
      messageKey: CHAT_CONNECTION_MESSAGE.PROVIDER_SERVER_ERROR,
      recommendationKey: CHAT_CONNECTION_RECOMMENDATION.PROVIDER_SERVER_ERROR,
      checkedAt,
      diagnosticDetail,
    })
  }

  return buildChatConnectionResult({
    ok: false,
    status: status >= 500 ? 'unreachable' : 'error',
    code: status >= 500 ? 'provider_server_error' : 'unknown_connection_error',
    messageKey: status >= 500
      ? CHAT_CONNECTION_MESSAGE.PROVIDER_SERVER_ERROR
      : CHAT_CONNECTION_MESSAGE.UNKNOWN_ERROR,
    recommendationKey: status >= 500
      ? CHAT_CONNECTION_RECOMMENDATION.PROVIDER_SERVER_ERROR
      : CHAT_CONNECTION_RECOMMENDATION.UNKNOWN_ERROR,
    messageParams: Number.isFinite(status) ? { status } : undefined,
    checkedAt,
    diagnosticDetail,
  })
}

function classifyOllamaTransportFailure(reason) {
  const normalized = String(reason ?? '').trim().toLowerCase()
  if (
    normalized.includes('econnrefused')
    || normalized.includes('err_connection_refused')
    || normalized.includes('连接被拒绝')
  ) {
    return 'refused'
  }
  if (
    normalized.includes('etimedout')
    || normalized.includes('timeout')
    || normalized.includes('超时')
  ) {
    return 'timeout'
  }
  return 'unknown'
}

export function summarizeChatConnectionTransportFailure({ providerId, reason, baseUrl }) {
  const checkedAt = new Date().toISOString()
  const normalizedProviderId = normalizeChatProviderId(providerId, baseUrl)
  const diagnosticDetail = String(reason ?? '').trim() || undefined

  if (normalizedProviderId === 'ollama') {
    const failureKind = classifyOllamaTransportFailure(reason)
    return buildChatConnectionResult({
      ok: false,
      status: 'unreachable',
      code: failureKind === 'timeout' ? 'request_timeout' : 'provider_unreachable',
      messageKey: failureKind === 'timeout'
        ? CHAT_CONNECTION_MESSAGE.PROVIDER_UNREACHABLE_OLLAMA_TIMEOUT
        : CHAT_CONNECTION_MESSAGE.PROVIDER_UNREACHABLE_OLLAMA,
      recommendationKey: CHAT_CONNECTION_RECOMMENDATION.PROVIDER_UNREACHABLE_OLLAMA,
      checkedAt,
      diagnosticDetail,
    })
  }

  return buildChatConnectionResult({
    ok: false,
    status: 'unreachable',
    code: 'provider_unreachable',
    messageKey: CHAT_CONNECTION_MESSAGE.PROVIDER_UNREACHABLE,
    recommendationKey: CHAT_CONNECTION_RECOMMENDATION.PROVIDER_UNREACHABLE,
    checkedAt,
    diagnosticDetail,
  })
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
