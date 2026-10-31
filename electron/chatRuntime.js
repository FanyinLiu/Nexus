// @ts-check
import {
  estimateModelContextWindowTokens,
  modelRejectsChatCompletionsTools,
  modelSupportsSpeech,
  modelSupportsVision,
} from '../shared/modelCapabilities.js'
import { inferProviderIdFromHost } from '../shared/providerHostInference.js'
import {
  CHAT_IPC_ERROR_CODES,
  chatIpcErrorCodeFromConnectionCode,
  classifyChatTransportFailure,
} from '../shared/chatErrorCodes.js'
import {
  CHAT_CONNECTION_MESSAGE,
  CHAT_CONNECTION_RECOMMENDATION,
  buildChatConnectionResult,
  classifyChatMessageProbeIdentity,
} from './services/chatConnectionProof.js'
import { normalizeBaseUrl } from './netHelpers.js'

/** @typedef {{ function?: { name?: string, description?: string, parameters?: unknown }, name?: string, description?: string, parameters?: unknown }} ChatTool */
/** @typedef {{ providerId?: string, baseUrl?: string, apiKey?: string, model?: string, messages?: unknown[], tools?: unknown[], temperature?: number, maxTokens?: number }} ChatRequestPayload */
/** @typedef {{ id?: string, name?: string, model?: string, size?: number, modified_at?: string, details?: { family?: string } }} ChatModelEntry */
/**
 * @typedef {Object} DiscoveredChatModel
 * @property {string} id
 * @property {string} label
 * @property {string} providerId
 * @property {'ollama' | 'preset'} source
 * @property {number | null} sizeBytes
 * @property {string | null} modifiedAt
 * @property {string | null} family
 * @property {{
 *   runLocation: 'local' | 'custom' | 'cloud', supportsTools: boolean, supportsVision: boolean,
 *   supportsSpeech: boolean, contextWindowTokens: number | null, requiresApiKey: boolean,
 * }} capabilities
 */

/** @typedef {{ content?: unknown, reasoning_content?: unknown, tool_calls?: unknown }} ChatProbeMessage */
/** @typedef {{ message?: ChatProbeMessage, finish_reason?: unknown, delta?: ChatProbeMessage, error?: unknown }} ChatProbeChoice */
/**
 * @typedef {Object} ChatProbeData
 * @property {unknown} [error]
 * @property {unknown} [message]
 * @property {Array<{ type?: unknown, text?: unknown }>} [content]
 * @property {ChatProbeChoice[]} [choices]
 * @property {unknown} [model]
 * @property {unknown} [model_id]
 * @property {unknown} [modelId]
 * @property {{ model?: unknown }} [output]
 */

/**
 * @typedef {Object} ChatProviderPayload
 * @property {unknown} [content]
 * @property {unknown} [stop_reason]
 * @property {unknown} [reasoning_content]
 * @property {unknown} [type]
 * @property {unknown} [index]
 * @property {unknown} [done]
 * @property {unknown} [stop]
 * @property {{ type?: unknown, text?: unknown, partial_json?: unknown }} [delta]
 * @property {{ type?: unknown, text?: unknown, id?: unknown, name?: unknown, input?: unknown, partial_json?: unknown }} [content_block]
 * @property {{ content?: unknown, reasoning_content?: unknown }} [message]
 * @property {ChatProbeChoice[]} [choices]
 */

/**
 * @typedef {Object} ChatToolCallFragment
 * @property {number} index
 * @property {string} [id]
 * @property {string} [type]
 * @property {{ name?: string, arguments?: string }} [function]
 */

/** @typedef {{ id?: unknown, type?: string, function?: { name?: unknown, arguments?: unknown } }} ChatToolCall */

/** @param {unknown} baseUrl @returns {string} */
function stripAnthropicVersionSuffix(baseUrl) {
  return normalizeBaseUrl(baseUrl).replace(/\/v1$/iu, '')
}

/** @param {unknown} baseUrl @returns {boolean} */
function isAnthropicCompatibleBaseUrl(baseUrl) {
  return /\/anthropic(?:\/v1)?$/iu.test(normalizeBaseUrl(baseUrl))
}

/** @param {unknown} content @param {{ trim?: boolean }} [options] @returns {string} */
function extractTextFromContent(content, { trim = true } = {}) {
  /** @param {string} text @returns {string} */
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

  if (typeof /** @type {{ text?: unknown }} */ (content)?.text === 'string') {
    return normalize(/** @type {{ text: string }} */ (content).text)
  }

  if (typeof /** @type {{ delta?: { text?: unknown } }} */ (content)?.delta?.text === 'string') {
    return normalize(/** @type {{ delta: { text: string } }} */ (content).delta.text)
  }

  return ''
}

/** @param {unknown} value @returns {boolean} */
function hasNonEmptyString(value) {
  return String(value ?? '').trim().length > 0
}

/** @param {unknown} providerId @returns {boolean} */
function isMiniMaxTokenPlanProvider(providerId) {
  const normalizedProviderId = normalizeChatProviderId(providerId)
  return normalizedProviderId === 'minimax-coding'
    || normalizedProviderId === 'minimax-coding-global'
}

/** @param {unknown} providerId @param {string} code @returns {string} */
function formatInvalidChatApiKeyMessage(providerId, code) {
  const label = isMiniMaxTokenPlanProvider(providerId)
    ? 'MiniMax Token Plan API Key'
    : 'API Key'
  // Kept in English so the message can cross IPC as a diagnostic string; the
  // renderer classifies on the embedded code/`API Key` token, not this copy.
  return `${label} is not safe for HTTP headers (${code}). Paste the raw key from the provider console only — no plan notes, model names, or comments.`
}

/** @param {unknown} apiKey @returns {string} */
function classifyInvalidChatApiKeyCode(apiKey) {
  const value = String(apiKey ?? '').trim()
  if (/[一-鿿぀-ゟ゠-ヿ가-힯]/u.test(value)) return 'api_key_contains_cjk'
  if (/\s/u.test(value)) return 'api_key_contains_whitespace'
  return 'api_key_header_unsafe'
}

/**
 * @param {unknown} providerId
 * @param {unknown} apiKey
 * @returns {string}
 */
function normalizeChatApiKeyForHeader(providerId, apiKey) {
  const value = String(apiKey ?? '').trim()
  if (!value) return ''

  if (/[^\x21-\x7E]/u.test(value)) {
    const code = classifyInvalidChatApiKeyCode(value)
    const error = /** @type {Error & { code?: string }} */ (new Error(formatInvalidChatApiKeyMessage(providerId, code)))
    error.code = code
    throw error
  }

  return value
}

/** @param {unknown} providerId @returns {'local' | 'custom' | 'cloud'} */
function getProviderRunLocation(providerId) {
  const normalized = normalizeChatProviderId(providerId)
  if (normalized === 'ollama') return 'local'
  if (normalized === 'custom') return 'custom'
  return 'cloud'
}

/**
 * @param {unknown} providerId
 * @param {ChatModelEntry} entry
 * @returns {DiscoveredChatModel | null}
 */
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

/** @param {unknown} data @returns {ChatModelEntry[]} */
export function extractChatModelEntries(data) {
  const source = /** @type {{ data?: unknown, models?: unknown }} */ (data)

  if (Array.isArray(source?.data)) {
    return source.data
      .map((item) => ({ ...item, id: String(item?.id ?? '').trim() }))
      .filter((item) => item.id)
  }

  if (Array.isArray(source?.models)) {
    return source.models
      .map((item) => ({
        ...item,
        id: String(item?.name ?? item?.model ?? item?.id ?? '').trim(),
      }))
      .filter((item) => item.id)
  }

  return []
}

/**
 * @param {{ providerId?: unknown, data?: unknown }} params
 * @returns {DiscoveredChatModel[]}
 */
export function buildDiscoveredChatModels({ providerId, data }) {
  return /** @type {DiscoveredChatModel[]} */ (extractChatModelEntries(data)
    .map((entry) => buildDiscoveredModel(providerId, entry))
    .filter(Boolean))
}

/** @type {Readonly<Record<string, 'anthropic'>>} */
const CHAT_PROVIDER_PROTOCOLS = Object.freeze({
  anthropic: 'anthropic',
  'kimi-coding': 'anthropic',
  'kimi-coding-global': 'anthropic',
  minimax: 'anthropic',
  'minimax-global': 'anthropic',
  'minimax-coding': 'anthropic',
  'minimax-coding-global': 'anthropic',
})

/** @type {Readonly<Record<string, boolean>>} */
const CHAT_PROVIDER_API_KEY_POLICY = Object.freeze({
  custom: false,
  ollama: false,
})

// Host inference table lives in shared/providerHostInference.js (single
// source of truth, shared with the renderer's inferApiProviderId). The main
// process keeps its historical 'openai' fallback for unmatched hosts.
/**
 * @param {unknown} providerId
 * @param {unknown} [baseUrl]
 * @param {unknown} [model]
 * @returns {string}
 */
export function normalizeChatProviderId(providerId, baseUrl = '', model = '') {
  const explicit = String(providerId ?? '').trim().toLowerCase()
  if (explicit) {
    return explicit
  }

  return inferProviderIdFromHost(normalizeBaseUrl(baseUrl), /** @type {string | null | undefined} */ (model)) ?? 'openai'
}

/**
 * @param {unknown} providerId
 * @param {unknown} [baseUrl]
 * @returns {string}
 */
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

/** @param {unknown} providerId @returns {boolean} */
export function chatProviderRequiresApiKey(providerId) {
  const normalized = normalizeChatProviderId(providerId)
  return CHAT_PROVIDER_API_KEY_POLICY[normalized] ?? true
}

/**
 * @param {{ providerId?: unknown, apiKey?: unknown }} params
 * @returns {ReturnType<typeof buildChatConnectionResult> | null}
 */
export function getChatConnectionTestPreflightFailure({ providerId, apiKey }) {
  const normalizedProviderId = normalizeChatProviderId(providerId)
  if (!chatProviderRequiresApiKey(normalizedProviderId)) {
    return null
  }

  if (hasNonEmptyString(apiKey)) {
    try {
      normalizeChatApiKeyForHeader(normalizedProviderId, apiKey)
    } catch (error) {
      const shortCode = /** @type {{ code?: string }} */ (error)?.code || 'api_key_header_unsafe'
      return buildChatConnectionResult({
        ok: false,
        status: 'needs_key',
        code: shortCode,
        ipcCode: chatIpcErrorCodeFromConnectionCode(shortCode)
          || CHAT_IPC_ERROR_CODES.API_KEY_HEADER_UNSAFE,
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
      ipcCode: CHAT_IPC_ERROR_CODES.MISSING_API_KEY,
      messageKey: CHAT_CONNECTION_MESSAGE.MISSING_API_KEY_DEEPSEEK,
      recommendationKey: CHAT_CONNECTION_RECOMMENDATION.MISSING_API_KEY,
    })
  }

  return buildChatConnectionResult({
    ok: false,
    status: 'needs_key',
    code: 'missing_api_key',
    ipcCode: CHAT_IPC_ERROR_CODES.MISSING_API_KEY,
    messageKey: CHAT_CONNECTION_MESSAGE.MISSING_API_KEY,
    recommendationKey: CHAT_CONNECTION_RECOMMENDATION.MISSING_API_KEY,
  })
}

/** @param {unknown} providerId @param {unknown} apiKey @param {unknown} [baseUrl] @returns {Record<string, string>} */
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

/**
 * @param {unknown} messages
 * @returns {{ system: string, messages: Array<{ role: 'assistant' | 'user', content: string }> }}
 */
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

/** @param {unknown} baseUrl @param {string} suffix @returns {string} */
function resolveAnthropicEndpoint(baseUrl, suffix) {
  const normalized = stripAnthropicVersionSuffix(baseUrl)
  return `${normalized}${suffix}`
}

/** @param {unknown} model @returns {boolean} */
function shouldOmitAnthropicTemperature(model) {
  const id = String(model ?? '').trim().toLowerCase()
  return /^claude-opus-4-[78](?:\b|$)/u.test(id)
}

/** @param {unknown} providerId @param {unknown} model @returns {boolean} */
function shouldDisableOpenAiCompatibleThinking(providerId, model) {
  const normalizedProviderId = normalizeChatProviderId(providerId)
  const id = String(model ?? '').trim().toLowerCase()
  // deepseek-flash is the current V4.1 id. The legacy v4-flash name still
  // routes there, so both keep thinking off for the same chat-compat reason.
  return normalizedProviderId === 'deepseek' && (
    id === 'deepseek-flash'
    || /^deepseek-v4-(?:flash|pro)(?:\b|$)/u.test(id)
  )
}

/** @param {unknown} providerId @param {unknown} model @returns {boolean} */
function shouldDisableAnthropicThinking(providerId, model) {
  const normalizedProviderId = normalizeChatProviderId(providerId)
  const id = String(model ?? '').trim().toLowerCase()
  // Exact M3 only. M3.1-Flash-Preview is a different model with tunable
  // thinking, and a word-boundary after "m3" would also match that id.
  return (
    (
      normalizedProviderId === 'minimax'
      || normalizedProviderId === 'minimax-global'
      || normalizedProviderId === 'minimax-coding'
      || normalizedProviderId === 'minimax-coding-global'
    )
    && id === 'minimax-m3'
  )
}

/**
 * GPT-6 Chat Completions sampling.
 *
 * Sol and Luna accept function tools only with reasoning_effort "none".
 * Astra and 6.1 Sol reject "none"; their tools need the Responses API,
 * which this client does not call. Any effort other than "none" rejects
 * temperature, so those requests omit it.
 */
/** @param {unknown} providerId @param {unknown} model @param {boolean} hasTools @returns {{ omitTemperature: boolean, reasoningEffort: 'none' | undefined }} */
function openAiChatCompletionsSampling(providerId, model, hasTools) {
  if (normalizeChatProviderId(providerId) !== 'openai') {
    return { omitTemperature: false, reasoningEffort: undefined }
  }
  const id = String(model ?? '').trim().toLowerCase()
  const toolsWithNone = id === 'gpt-6-sol' || id === 'gpt-6-luna'
  if (hasTools && toolsWithNone) {
    return { omitTemperature: false, reasoningEffort: 'none' }
  }
  if (toolsWithNone || id === 'gpt-6-astra' || id === 'gpt-6.1-sol') {
    return { omitTemperature: true, reasoningEffort: undefined }
  }
  return { omitTemperature: false, reasoningEffort: undefined }
}

/** @param {ChatRequestPayload} payload @param {{ stream?: boolean }} [options] @returns {{ providerId: string, protocol: string, endpoint: string, headers: Record<string, string>, body: string }} */
export function buildChatRequest(payload, options = {}) {
  const providerId = normalizeChatProviderId(payload?.providerId, payload?.baseUrl, payload?.model)
  const baseUrl = normalizeBaseUrl(payload?.baseUrl)
  const protocol = getChatProviderProtocol(providerId, baseUrl)
  const stream = options.stream === true

  if (protocol === 'anthropic') {
    const normalizedMessages = splitSystemMessages(payload?.messages)

    // Convert OpenAI-style tools to Anthropic format
    const anthropicTools = Array.isArray(payload?.tools) && payload.tools.length > 0
      ? /** @type {ChatTool[]} */ (payload.tools).map((t) => ({
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
  // Astra and 6.1 Sol reject function tools on this endpoint. Drop them so
  // selecting either model still completes a normal chat turn.
  const sendTools = Boolean(tools) && !modelRejectsChatCompletionsTools(payload?.model)
  const sampling = openAiChatCompletionsSampling(providerId, payload?.model, sendTools)
  /** @type {Record<string, unknown>} */
  const openAiBody = {
    model: payload?.model,
    messages: payload?.messages,
    ...(sampling.omitTemperature ? {} : { temperature: payload?.temperature ?? 0.8 }),
    max_tokens: payload?.maxTokens ?? 500,
    ...(stream ? { stream: true } : {}),
    ...(sendTools ? { tools } : {}),
    ...(sampling.reasoningEffort ? { reasoning_effort: sampling.reasoningEffort } : {}),
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

/** @param {ChatRequestPayload} payload @returns {{ providerId: string, protocol: string, successKind: 'message', endpoint: string, request: { method: 'POST', headers: Record<string, string>, body: string } }} */
export function buildChatConnectionTestRequest(payload) {
  const providerId = normalizeChatProviderId(payload?.providerId, payload?.baseUrl, payload?.model)
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

/** @param {ChatRequestPayload} payload @returns {{ providerId: string, protocol: string, endpoint: string, request: { method: 'GET', headers: Record<string, string> } }} */
export function buildChatModelListRequest(payload) {
  const providerId = normalizeChatProviderId(payload?.providerId, payload?.baseUrl, payload?.model)
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

/** @param {{ providerId?: unknown, successKind?: string, data?: ChatProbeData, model?: unknown }} params @returns {ReturnType<typeof buildChatConnectionResult>} */
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
      providerId: /** @type {string | undefined} */ (providerId),
      modelId: /** @type {string | undefined} */ (model),
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

/** @param {ChatProbeData | null | undefined} data @returns {string} */
function extractConnectionFailureMessage(data) {
  const value = /** @type {{ message?: unknown }} */ (data?.error)?.message
    ?? data?.error
    ?? data?.message
  if (typeof value === 'string') {
    return value.trim()
  }
  return ''
}

/** @param {{ providerId?: unknown, status: number, data?: ChatProbeData, hasApiKey?: boolean, model?: unknown }} params @returns {ReturnType<typeof buildChatConnectionResult>} */
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

/** @param {unknown} reason @returns {'refused' | 'timeout' | 'unknown'} */
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
  ) {
    return 'timeout'
  }
  return 'unknown'
}

/** @param {{ providerId?: unknown, reason?: unknown, baseUrl?: unknown, error?: unknown }} params @returns {ReturnType<typeof buildChatConnectionResult>} */
export function summarizeChatConnectionTransportFailure({ providerId, reason, baseUrl, error }) {
  const checkedAt = new Date().toISOString()
  const normalizedProviderId = normalizeChatProviderId(providerId, baseUrl)
  const diagnosticDetail = String(reason ?? '').trim() || undefined
  const ipcCode = classifyChatTransportFailure(error ?? reason)
  const isTimeout = ipcCode === CHAT_IPC_ERROR_CODES.TIMEOUT

  if (normalizedProviderId === 'ollama') {
    const failureKind = isTimeout ? 'timeout' : classifyOllamaTransportFailure(reason)
    const timedOut = failureKind === 'timeout'
    return buildChatConnectionResult({
      ok: false,
      status: 'unreachable',
      code: timedOut ? 'request_timeout' : 'provider_unreachable',
      ipcCode: timedOut ? CHAT_IPC_ERROR_CODES.TIMEOUT : CHAT_IPC_ERROR_CODES.UNREACHABLE,
      messageKey: timedOut
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
    code: isTimeout ? 'request_timeout' : 'provider_unreachable',
    ipcCode,
    messageKey: isTimeout
      ? CHAT_CONNECTION_MESSAGE.REQUEST_TIMEOUT
      : CHAT_CONNECTION_MESSAGE.PROVIDER_UNREACHABLE,
    recommendationKey: isTimeout
      ? CHAT_CONNECTION_RECOMMENDATION.REQUEST_TIMEOUT
      : CHAT_CONNECTION_RECOMMENDATION.PROVIDER_UNREACHABLE,
    checkedAt,
    diagnosticDetail,
  })
}

/**
 * @param {unknown} providerId
 * @param {ChatProviderPayload} payload
 * @returns {string}
 */
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
/**
 * @param {unknown} providerId
 * @param {ChatProviderPayload} payload
 * @returns {string}
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
/**
 * @param {unknown} providerId
 * @param {ChatProviderPayload} payload
 * @returns {ChatToolCall[] | null}
 */
export function extractChatResponseToolCalls(providerId, payload) {
  if (getChatProviderProtocol(providerId) === 'anthropic') {
    // Anthropic returns tool calls as content blocks with type "tool_use"
    const content = Array.isArray(payload?.content) ? payload.content : []
    const toolUseBlocks = /** @type {Array<{ type?: unknown, id?: unknown, name?: unknown, input?: unknown }>} */ (content)
      .filter((block) => block?.type === 'tool_use')
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
/**
 * @param {unknown} providerId
 * @param {ChatProviderPayload} payload
 * @returns {string | null}
 */
export function extractChatResponseFinishReason(providerId, payload) {
  if (getChatProviderProtocol(providerId) === 'anthropic') {
    return /** @type {string | null} */ (payload?.stop_reason ?? null)
  }

  return /** @type {string | null} */ (payload?.choices?.[0]?.finish_reason ?? null)
}

/**
 * @param {unknown} providerId
 * @param {ChatProviderPayload} payload
 * @returns {string}
 */
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
/**
 * @param {unknown} providerId
 * @param {ChatProviderPayload} payload
 * @returns {string}
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
/**
 * @param {unknown} providerId
 * @param {ChatProviderPayload} payload
 * @returns {ChatToolCallFragment[] | null}
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
      /** @type {ChatToolCallFragment} */
      const fragment = { index: Number(payload?.index ?? 0), type: 'function' }
      const blockId = payload.content_block.id
      const blockName = payload.content_block.name
      if (typeof blockId === 'string' && blockId) fragment.id = blockId
      /** @type {{ name?: string, arguments?: string }} */
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
        function: { arguments: /** @type {string} */ (payload.delta.partial_json ?? '') },
      }]
    }
    return null
  }

  const deltaCalls = payload?.choices?.[0]?.delta?.tool_calls
  if (!Array.isArray(deltaCalls) || !deltaCalls.length) return null

  return deltaCalls.map((tc, fallbackIndex) => {
    /** @type {ChatToolCallFragment} */
    const fragment = { index: Number(tc?.index ?? fallbackIndex) }
    if (typeof tc?.id === 'string' && tc.id) fragment.id = tc.id
    if (typeof tc?.type === 'string' && tc.type) fragment.type = tc.type
    if (tc?.function && typeof tc.function === 'object') {
      /** @type {{ name?: string, arguments?: string }} */
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

/**
 * @param {unknown} providerId
 * @param {ChatProviderPayload} payload
 * @returns {boolean}
 */
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

/** @param {string} fullContent @param {unknown} incomingDelta @returns {string} */
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
