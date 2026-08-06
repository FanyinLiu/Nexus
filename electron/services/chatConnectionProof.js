/**
 * Offline-classifiable chat connection proof helpers.
 *
 * Mirrors speechConnectionProof: connection tests must prove a real model
 * response from the requested provider/model. Model-list, endpoint reachability,
 * empty 2xx envelopes, and gateway fallback identity must not paint green ready.
 *
 * Message payloads use stable messageKey + safe params. The `message` field
 * mirrors the key itself — renderers always translate the key, so no
 * human-readable fallback copy lives in the main process.
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

function normalizeId(value) {
  const text = String(value ?? '').trim()
  return text || undefined
}

/**
 * Observed model identity from OpenAI-compatible / Anthropic message envelopes.
 * Missing fields are unknown (not a mismatch).
 */
function extractObservedChatModelId(data) {
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

  const recKey = recommendationKey

  void diagnosticDetail

  return {
    ok: Boolean(ok),
    // `message` mirrors the stable messageKey — renderers translate the key,
    // so the main process ships no human-readable fallback copy.
    message: key,
    messageKey: key,
    ...(safeParams && Object.keys(safeParams).length > 0 ? { messageParams: safeParams } : {}),
    ...(recKey ? { recommendationKey: recKey } : {}),
    ...(recommendation
      ? { recommendation: redactSpeechConnectionText(recommendation) }
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
function buildChatModelResponseEvidence({
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
