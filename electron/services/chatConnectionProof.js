/**
 * Offline-classifiable chat connection proof helpers.
 *
 * Mirrors speechConnectionProof: connection tests must prove a real model
 * response from the requested provider/model. Model-list, endpoint reachability,
 * empty 2xx envelopes, and gateway fallback identity must not paint green ready.
 *
 * Message payloads use stable messageKey + safe params. Chinese strings remain
 * only as main-process fallbacks when a renderer has not yet mapped a key.
 */

import {
  buildSpeechConnectionEvidence,
  classifyEvidenceIdentity,
  redactSpeechConnectionText,
} from './speechConnectionProof.js'

export const CHAT_CONNECTION_MESSAGE = Object.freeze({
  READY: 'settings.chat_connection.ready',
  IDENTITY_UNVERIFIED: 'settings.chat_connection.identity_unverified',
  IDENTITY_MISMATCH: 'settings.chat_connection.identity_mismatch',
  INVALID_PROBE: 'settings.chat_connection.invalid_probe',
  MODEL_LIST_NOT_PROOF: 'settings.chat_connection.model_list_not_proof',
  MISSING_BASE_URL: 'settings.chat_connection.missing_base_url',
  UNSAFE_BASE_URL: 'settings.chat_connection.unsafe_base_url',
  MISSING_API_KEY: 'settings.chat_connection.missing_api_key',
  MISSING_API_KEY_DEEPSEEK: 'settings.chat_connection.missing_api_key_deepseek',
  AUTH_FAILED: 'settings.chat_connection.auth_failed',
  AUTH_FAILED_MISSING_KEY: 'settings.chat_connection.auth_failed_missing_key',
  AUTH_FAILED_DEEPSEEK: 'settings.chat_connection.auth_failed_deepseek',
  AUTH_FAILED_DEEPSEEK_MISSING: 'settings.chat_connection.auth_failed_deepseek_missing',
  QUOTA_OR_PERMISSION: 'settings.chat_connection.quota_or_permission',
  QUOTA_OR_PERMISSION_DEEPSEEK: 'settings.chat_connection.quota_or_permission_deepseek',
  INVALID_BASE_URL_DEEPSEEK: 'settings.chat_connection.invalid_base_url_deepseek',
  MODEL_NOT_FOUND: 'settings.chat_connection.model_not_found',
  MODEL_NOT_FOUND_DEEPSEEK: 'settings.chat_connection.model_not_found_deepseek',
  MODEL_MISSING_OLLAMA: 'settings.chat_connection.model_missing_ollama',
  MODEL_NOT_FOUND_OLLAMA: 'settings.chat_connection.model_not_found_ollama',
  RATE_LIMITED: 'settings.chat_connection.rate_limited',
  REQUEST_TIMEOUT: 'settings.chat_connection.request_timeout',
  PROVIDER_SERVER_ERROR: 'settings.chat_connection.provider_server_error',
  PROVIDER_UNREACHABLE: 'settings.chat_connection.provider_unreachable',
  PROVIDER_UNREACHABLE_OLLAMA: 'settings.chat_connection.provider_unreachable_ollama',
  PROVIDER_UNREACHABLE_OLLAMA_TIMEOUT: 'settings.chat_connection.provider_unreachable_ollama_timeout',
  UNKNOWN_ERROR: 'settings.chat_connection.unknown_error',
  API_KEY_HEADER_UNSAFE: 'settings.chat_connection.api_key_header_unsafe',
})

export const CHAT_CONNECTION_RECOMMENDATION = Object.freeze({
  INVALID_PROBE: 'settings.chat_connection.invalid_probe_rec',
  MISSING_API_KEY: 'settings.chat_connection.missing_api_key_rec',
  AUTH_FAILED: 'settings.chat_connection.auth_failed_rec',
  AUTH_FAILED_DEEPSEEK: 'settings.chat_connection.auth_failed_deepseek_rec',
  QUOTA_OR_PERMISSION: 'settings.chat_connection.quota_or_permission_rec',
  QUOTA_OR_PERMISSION_DEEPSEEK: 'settings.chat_connection.quota_or_permission_deepseek_rec',
  INVALID_BASE_URL_DEEPSEEK: 'settings.chat_connection.invalid_base_url_deepseek_rec',
  MODEL_NOT_FOUND: 'settings.chat_connection.model_not_found_rec',
  MODEL_NOT_FOUND_DEEPSEEK: 'settings.chat_connection.model_not_found_deepseek_rec',
  MODEL_MISSING_OLLAMA: 'settings.chat_connection.model_missing_ollama_rec',
  MODEL_NOT_FOUND_OLLAMA: 'settings.chat_connection.model_not_found_ollama_rec',
  RATE_LIMITED: 'settings.chat_connection.rate_limited_rec',
  REQUEST_TIMEOUT: 'settings.chat_connection.request_timeout_rec',
  PROVIDER_SERVER_ERROR: 'settings.chat_connection.provider_server_error_rec',
  PROVIDER_UNREACHABLE: 'settings.chat_connection.provider_unreachable_rec',
  PROVIDER_UNREACHABLE_OLLAMA: 'settings.chat_connection.provider_unreachable_ollama_rec',
  UNKNOWN_ERROR: 'settings.chat_connection.unknown_error_rec',
  API_KEY_HEADER_UNSAFE: 'settings.chat_connection.api_key_header_unsafe_rec',
  MODEL_LIST_NOT_PROOF: 'settings.chat_connection.model_list_not_proof_rec',
  IDENTITY_UNVERIFIED: 'settings.chat_connection.identity_unverified_rec',
})

const MESSAGE_FALLBACKS = Object.freeze({
  [CHAT_CONNECTION_MESSAGE.READY]: '连上了，模型已经回应啦。',
  [CHAT_CONNECTION_MESSAGE.IDENTITY_UNVERIFIED]:
    '服务有响应，但返回结果没有提供模型身份，暂时无法确认是当前模型。',
  [CHAT_CONNECTION_MESSAGE.IDENTITY_MISMATCH]:
    '服务有响应，但返回的模型与请求目标不一致，请复核设置。',
  [CHAT_CONNECTION_MESSAGE.INVALID_PROBE]:
    '服务返回了成功状态，但没有有效的模型回复。请检查接口地址和模型名后重试。',
  [CHAT_CONNECTION_MESSAGE.MODEL_LIST_NOT_PROOF]:
    '接口能返回模型列表，但这还不能证明当前配置的模型可以聊天。请用连接测试验证一次真实回复。',
  [CHAT_CONNECTION_MESSAGE.MISSING_BASE_URL]: '还没填 API 地址呢。',
  [CHAT_CONNECTION_MESSAGE.UNSAFE_BASE_URL]: '这个地址不太安全，没法用哦。',
  [CHAT_CONNECTION_MESSAGE.MISSING_API_KEY]: '先填一下 API Key 吧。',
  [CHAT_CONNECTION_MESSAGE.MISSING_API_KEY_DEEPSEEK]:
    'DeepSeek 需要填 API Key，去控制台拿一个填在上面就好。',
  [CHAT_CONNECTION_MESSAGE.AUTH_FAILED]: '地址能通，不过 API Key 好像不太对。',
  [CHAT_CONNECTION_MESSAGE.AUTH_FAILED_MISSING_KEY]: '地址能通，不过还没填 API Key 呢。',
  [CHAT_CONNECTION_MESSAGE.AUTH_FAILED_DEEPSEEK]:
    'DeepSeek 的 API Key 好像不太对，去控制台看看是不是过期了？',
  [CHAT_CONNECTION_MESSAGE.AUTH_FAILED_DEEPSEEK_MISSING]:
    'DeepSeek 需要填 API Key 才能用哦，去控制台拿一个填在上面就好。',
  [CHAT_CONNECTION_MESSAGE.QUOTA_OR_PERMISSION]: '服务商好像有权限或余额限制。',
  [CHAT_CONNECTION_MESSAGE.QUOTA_OR_PERMISSION_DEEPSEEK]:
    'DeepSeek 好像遇到了权限或余额限制，看看账号还有没有额度？',
  [CHAT_CONNECTION_MESSAGE.INVALID_BASE_URL_DEEPSEEK]:
    'DeepSeek 的地址或模型名好像对不上，Base URL 填 https://api.deepseek.com，模型先选 deepseek-v4-flash 试试？',
  [CHAT_CONNECTION_MESSAGE.MODEL_NOT_FOUND]: '没找到当前模型，可能名字不对或者账号没开通。',
  [CHAT_CONNECTION_MESSAGE.MODEL_NOT_FOUND_DEEPSEEK]:
    'DeepSeek 好像不认识当前模型，先换成 deepseek-v4-flash 试试？',
  [CHAT_CONNECTION_MESSAGE.MODEL_MISSING_OLLAMA]:
    'Ollama 连上了，不过还没有模型呢。运行 ollama pull qwen3:8b 装一个吧。',
  [CHAT_CONNECTION_MESSAGE.MODEL_NOT_FOUND_OLLAMA]:
    'Ollama 连上了，不过没找到当前配置的模型。先 ollama pull 装一下，或者换个已有的模型。',
  [CHAT_CONNECTION_MESSAGE.RATE_LIMITED]: '请求有点太频繁了，歇一小会儿再试试。',
  [CHAT_CONNECTION_MESSAGE.REQUEST_TIMEOUT]: '等了好一会儿都没回应，可能是网络不太顺畅。',
  [CHAT_CONNECTION_MESSAGE.PROVIDER_SERVER_ERROR]:
    '服务商那边暂时忙不过来，可能在维护或者流量太大。',
  [CHAT_CONNECTION_MESSAGE.PROVIDER_UNREACHABLE]: '没能连上，可能是地址或网络的问题。',
  [CHAT_CONNECTION_MESSAGE.PROVIDER_UNREACHABLE_OLLAMA]:
    '没能连上本机 Ollama。请先启动 Ollama，并确认 Base URL 使用本机 OpenAI 兼容端点。',
  [CHAT_CONNECTION_MESSAGE.PROVIDER_UNREACHABLE_OLLAMA_TIMEOUT]:
    '本机 Ollama 一直没有回应。请先启动 Ollama，并确认 Base URL 使用本机 OpenAI 兼容端点。',
  [CHAT_CONNECTION_MESSAGE.UNKNOWN_ERROR]: '接口返回了异常状态，不太确定哪里出了问题。',
  [CHAT_CONNECTION_MESSAGE.API_KEY_HEADER_UNSAFE]:
    'API Key 里有不适合放进 HTTP Header 的字符。',
})

const RECOMMENDATION_FALLBACKS = Object.freeze({
  [CHAT_CONNECTION_RECOMMENDATION.INVALID_PROBE]:
    '确认这个地址支持聊天补全接口，并检查当前模型名是否正确。',
  [CHAT_CONNECTION_RECOMMENDATION.MISSING_API_KEY]: '重新去服务商那里复制一下原始 Key，只要 Key 本身就好。',
  [CHAT_CONNECTION_RECOMMENDATION.AUTH_FAILED]: '看看 Key 有没有过期，或者重新复制一下。',
  [CHAT_CONNECTION_RECOMMENDATION.AUTH_FAILED_DEEPSEEK]:
    '可以去 DeepSeek 控制台重新生成一个，顺便看看余额和模型权限。',
  [CHAT_CONNECTION_RECOMMENDATION.QUOTA_OR_PERMISSION]:
    '看看 API Key 权限和账号余额，有些模型可能需要单独开通。',
  [CHAT_CONNECTION_RECOMMENDATION.QUOTA_OR_PERMISSION_DEEPSEEK]: '去控制台看看余额和模型权限。',
  [CHAT_CONNECTION_RECOMMENDATION.INVALID_BASE_URL_DEEPSEEK]:
    'Base URL 改成 https://api.deepseek.com，模型先用 deepseek-v4-flash。',
  [CHAT_CONNECTION_RECOMMENDATION.MODEL_NOT_FOUND]:
    '核对一下模型名，或者先换个服务商推荐的默认模型试试。',
  [CHAT_CONNECTION_RECOMMENDATION.MODEL_NOT_FOUND_DEEPSEEK]:
    '先用 deepseek-v4-flash，需要更强推理再切 deepseek-v4-pro。',
  [CHAT_CONNECTION_RECOMMENDATION.MODEL_MISSING_OLLAMA]:
    '运行 ollama pull qwen3:8b 装一个，或者装好别的模型再来刷新。',
  [CHAT_CONNECTION_RECOMMENDATION.MODEL_NOT_FOUND_OLLAMA]:
    '运行 ollama pull 安装当前模型，或者在模型列表里选一个已有的。',
  [CHAT_CONNECTION_RECOMMENDATION.RATE_LIMITED]:
    '等几秒再试就好。如果老是这样，去看看服务商那边的调用限额。',
  [CHAT_CONNECTION_RECOMMENDATION.REQUEST_TIMEOUT]: '看看网络和代理设置，也可以稍后再试一下。',
  [CHAT_CONNECTION_RECOMMENDATION.PROVIDER_SERVER_ERROR]:
    '过一会儿再试试。如果一直这样，可以去看看服务商的状态页。',
  [CHAT_CONNECTION_RECOMMENDATION.PROVIDER_UNREACHABLE]:
    '看看地址和网络，本地服务的话确认一下有没有在跑。',
  [CHAT_CONNECTION_RECOMMENDATION.PROVIDER_UNREACHABLE_OLLAMA]:
    '打开 Ollama 应用，或在终端运行 ollama serve；启动后再点一次连接测试。如果还没有模型，运行 ollama pull qwen3:8b。',
  [CHAT_CONNECTION_RECOMMENDATION.UNKNOWN_ERROR]:
    '看看地址、网络和模型名，也可以关注一下服务商那边有没有公告。',
  [CHAT_CONNECTION_RECOMMENDATION.API_KEY_HEADER_UNSAFE]:
    '重新去服务商那里复制一下原始 Key，只要 Key 本身就好。',
  [CHAT_CONNECTION_RECOMMENDATION.MODEL_LIST_NOT_PROOF]:
    '在设置里对当前模型再跑一次连接测试，确认能返回真实回复。',
  [CHAT_CONNECTION_RECOMMENDATION.IDENTITY_UNVERIFIED]:
    '检查服务是否会返回模型标识；兼容网关可能需要单独确认实际路由。',
})

function normalizeId(value) {
  const text = String(value ?? '').trim()
  return text || undefined
}

/**
 * Observed model identity from OpenAI-compatible / Anthropic message envelopes.
 * Missing fields are unknown (not a mismatch).
 */
export function extractObservedChatModelId(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  return normalizeId(
    data.model
    ?? data.model_id
    ?? data.modelId
    ?? data.output?.model
  )
}

export function buildChatConnectionResult({
  ok,
  messageKey,
  recommendationKey = undefined,
  messageParams = undefined,
  code = undefined,
  status = undefined,
  evidence = undefined,
  recommendation = undefined,
  checkedAt = undefined,
  discoveredModels = undefined,
  /** Never preferred over messageKey in UI; kept only for offline diagnostics. */
  diagnosticDetail = undefined,
} = {}) {
  const key = messageKey || (ok
    ? CHAT_CONNECTION_MESSAGE.READY
    : CHAT_CONNECTION_MESSAGE.INVALID_PROBE)
  const safeParams = messageParams && typeof messageParams === 'object'
    ? Object.fromEntries(
      Object.entries(messageParams)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([paramKey, value]) => [
          paramKey,
          typeof value === 'string' ? redactSpeechConnectionText(value) : value,
        ]),
    )
    : undefined

  const fallbackMessage = MESSAGE_FALLBACKS[key]
    || (ok
      ? MESSAGE_FALLBACKS[CHAT_CONNECTION_MESSAGE.READY]
      : MESSAGE_FALLBACKS[CHAT_CONNECTION_MESSAGE.UNKNOWN_ERROR])

  const recKey = recommendationKey
  const fallbackRecommendation = recKey
    ? (RECOMMENDATION_FALLBACKS[recKey] || recommendation)
    : recommendation

  void diagnosticDetail

  return {
    ok: Boolean(ok),
    message: fallbackMessage,
    messageKey: key,
    ...(safeParams && Object.keys(safeParams).length > 0 ? { messageParams: safeParams } : {}),
    ...(recKey ? { recommendationKey: recKey } : {}),
    ...(fallbackRecommendation
      ? { recommendation: redactSpeechConnectionText(fallbackRecommendation) }
      : {}),
    ...(code ? { code } : {}),
    ...(status ? { status } : {}),
    ...(evidence ? { evidence } : {}),
    ...(checkedAt ? { checkedAt } : {}),
    ...(discoveredModels ? { discoveredModels } : {}),
  }
}

/**
 * Build text connection evidence bound to the requested provider/model.
 * When the protocol returns a model id that differs, force partial.
 */
export function buildChatModelResponseEvidence({
  providerId,
  modelId,
  observedModelId,
  usedFallback = false,
  kind = 'model-response',
} = {}) {
  return buildSpeechConnectionEvidence({
    kind,
    providerId,
    modelId,
    observedModelId,
    usedFallback,
  })
}

export function classifyChatMessageProbeIdentity({
  providerId,
  modelId,
  data,
  usedFallback = false,
} = {}) {
  const observedModelId = extractObservedChatModelId(data)
  const identity = classifyEvidenceIdentity({
    requestedProviderId: providerId,
    requestedModelId: modelId,
    observedModelId,
    usedFallback,
  })
  const evidence = buildChatModelResponseEvidence({
    providerId,
    modelId,
    observedModelId,
    usedFallback: identity.usedFallback,
  })
  if (!observedModelId) evidence.partial = true
  return {
    observedModelId,
    identity,
    evidence,
  }
}
