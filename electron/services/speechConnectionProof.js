/**
 * Offline-classifiable speech connection proof helpers.
 *
 * These pure functions decide whether a speech-input / speech-output probe
 * produced verifiable recognition or synthesis evidence. They intentionally
 * do not treat HTTP 2xx, dependency presence, endpoint reachability, or broad
 * "no speech" free-text alone as green ready.
 *
 * Volcengine status codes below are only the ones already used by this
 * codebase (see sttService / audioIpc). Undocumented provider envelopes stay
 * partial/invalid rather than invented success.
 */

import { redactSensitiveErrorText } from './errorRedaction.js'

const ACCEPTED_NO_SPEECH_CODES = new Set([
  'no_speech',
  'no_speech_detected',
  'audio_too_short',
])

/** Volcengine bigasr flash codes already handled in-repo. */
export const VOLCENGINE_STT_STATUS = Object.freeze({
  SUCCESS: '20000000',
  SILENT_OR_NO_SPEECH: '20000003',
})

const VOLCENGINE_STT_ACCEPTED = new Set([
  VOLCENGINE_STT_STATUS.SUCCESS,
  VOLCENGINE_STT_STATUS.SILENT_OR_NO_SPEECH,
])

/** Minimum non-empty audio payload that can carry one PCM sample (int16). */
const MIN_AUDIO_BYTES = 2

/**
 * Container signatures we can prove offline from bytes alone.
 * Raw PCM is accepted only when the caller declares a PCM content-type or
 * sample rate (OpenAI-compatible / ElevenLabs streaming paths).
 */
const AUDIO_SIGNATURE_CHECKS = [
  {
    id: 'wav',
    test: (buf) => (
      buf.length >= 12
      && buf.toString('ascii', 0, 4) === 'RIFF'
      && buf.toString('ascii', 8, 12) === 'WAVE'
    ),
  },
  {
    id: 'ogg',
    test: (buf) => buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS',
  },
  {
    id: 'flac',
    test: (buf) => buf.length >= 4 && buf.toString('ascii', 0, 4) === 'fLaC',
  },
  {
    id: 'mp3-id3',
    test: (buf) => buf.length >= 3 && buf.toString('ascii', 0, 3) === 'ID3',
  },
  {
    id: 'mp3-frame',
    test: (buf) => buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0,
  },
]

const JSONISH_PREFIXES = [
  '{',
  '[',
  '"',
  'null',
  'true',
  'false',
]

function normalizeId(value) {
  const text = String(value ?? '').trim()
  return text || undefined
}

function idsEqual(left, right) {
  const a = normalizeId(left)
  const b = normalizeId(right)
  if (!a || !b) return true
  return a === b
}

export function getSpeechInputResponseCode(data) {
  return String(
    data?.error?.code
    ?? data?.code
    ?? data?.detail?.code
    ?? '',
  ).trim().toLowerCase()
}

export function extractSpeechInputText(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
  return String(data.text ?? data.transcript ?? data.result?.text ?? '').trim()
}

/**
 * True when the envelope has a recognition-result shape (text/transcript),
 * not merely an HTTP envelope or free-form message. Error objects fail.
 */
export function hasSpeechInputResponseShape(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  if (data.error || data.detail?.error) return false
  return Object.hasOwn(data, 'text')
    || Object.hasOwn(data, 'transcript')
    || Boolean(data.result && typeof data.result === 'object' && Object.hasOwn(data.result, 'text'))
}

/**
 * Accepted "no speech" only for narrow client statuses + known machine codes.
 * Broad free-text matches (silence / 未检测到语音 / …) intentionally fail.
 */
export function isAcceptedNoSpeechResponse(status, data) {
  return (status === 400 || status === 422)
    && ACCEPTED_NO_SPEECH_CODES.has(getSpeechInputResponseCode(data))
}

/**
 * Table-driven Volcengine STT status classification from codes already used
 * in this repository. Unknown / missing codes are never success.
 */
export function classifyVolcengineSpeechInputStatus(code) {
  const normalized = String(code ?? '').trim()
  if (!normalized) {
    return {
      ok: false,
      kind: 'missing_status',
      code: '',
    }
  }
  if (normalized === VOLCENGINE_STT_STATUS.SUCCESS) {
    return {
      ok: true,
      kind: 'success',
      code: normalized,
    }
  }
  if (normalized === VOLCENGINE_STT_STATUS.SILENT_OR_NO_SPEECH) {
    return {
      ok: true,
      kind: 'no_speech',
      code: normalized,
    }
  }
  return {
    ok: false,
    kind: 'provider_error',
    code: normalized,
  }
}

export function isAcceptedVolcengineSpeechInputStatus(code) {
  return VOLCENGINE_STT_ACCEPTED.has(String(code ?? '').trim())
}

export function detectAudioSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < MIN_AUDIO_BYTES) return null
  for (const check of AUDIO_SIGNATURE_CHECKS) {
    if (check.test(buffer)) return check.id
  }
  return null
}

function looksLikeJsonOrText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false
  const head = buffer.subarray(0, Math.min(buffer.length, 32)).toString('utf8').trimStart().toLowerCase()
  return JSONISH_PREFIXES.some((prefix) => head.startsWith(prefix))
}

function normalizeMimeType(mimeType) {
  return String(mimeType ?? '').split(';')[0].trim().toLowerCase()
}

export function isDeclaredPcmMimeType(mimeType) {
  const mime = normalizeMimeType(mimeType)
  // Only explicit PCM mime types count as declared PCM. Opaque
  // application/octet-stream still requires a known container signature.
  return mime === 'audio/pcm'
    || mime === 'audio/l16'
    || mime === 'audio/s16le'
}

export function isAudioMimeType(mimeType) {
  const mime = normalizeMimeType(mimeType)
  if (!mime) return false
  if (mime.startsWith('audio/')) return true
  // Some providers return binary audio as application/octet-stream;
  // signature validation is still required in that case.
  return mime === 'application/octet-stream'
}

function decodeAudioBase64(audioBase64) {
  if (typeof audioBase64 !== 'string') return null
  const trimmed = audioBase64.trim()
  if (!trimmed) return null
  try {
    return Buffer.from(trimmed, 'base64')
  } catch {
    return null
  }
}

/**
 * Inspect synthesized audio for connection proof.
 * Valid non-empty audio bytes prove functional synthesis, not device playback.
 */
export function inspectSpeechOutputAudio(result) {
  if (!result || typeof result !== 'object') {
    return {
      ok: false,
      reason: 'missing_result',
      byteLength: 0,
      signature: null,
      evidenceKind: null,
    }
  }

  let buffer = null
  let declaredPcm = false

  if (result.pcmBuffer instanceof Buffer) {
    buffer = result.pcmBuffer
    declaredPcm = true
  } else if (typeof result.audioBase64 === 'string') {
    buffer = decodeAudioBase64(result.audioBase64)
    if (!buffer) {
      return {
        ok: false,
        reason: 'invalid_base64',
        byteLength: 0,
        signature: null,
        evidenceKind: null,
      }
    }
    declaredPcm = isDeclaredPcmMimeType(result.mimeType)
      || Number(result.pcmSampleRate) > 0
  } else if (result.pcmStream) {
    // A bare stream handle is not byte evidence; callers must materialize bytes.
    return {
      ok: false,
      reason: 'stream_without_bytes',
      byteLength: 0,
      signature: null,
      evidenceKind: null,
    }
  } else {
    return {
      ok: false,
      reason: 'empty_audio',
      byteLength: 0,
      signature: null,
      evidenceKind: null,
    }
  }

  if (buffer.length < MIN_AUDIO_BYTES) {
    return {
      ok: false,
      reason: 'empty_audio',
      byteLength: buffer.length,
      signature: null,
      evidenceKind: null,
    }
  }

  if (looksLikeJsonOrText(buffer)) {
    return {
      ok: false,
      reason: 'non_audio_payload',
      byteLength: buffer.length,
      signature: null,
      evidenceKind: null,
    }
  }

  const mime = normalizeMimeType(result.mimeType)
  if (mime && !isAudioMimeType(mime) && !declaredPcm) {
    return {
      ok: false,
      reason: 'invalid_content_type',
      byteLength: buffer.length,
      signature: null,
      evidenceKind: null,
    }
  }

  const signature = detectAudioSignature(buffer)
  if (!signature && !declaredPcm) {
    // Undeclared raw bytes without a known container are not proof.
    return {
      ok: false,
      reason: 'unknown_audio_signature',
      byteLength: buffer.length,
      signature: null,
      evidenceKind: null,
    }
  }

  // Raw PCM must be even-length int16 frames when sample rate is known.
  if (!signature && declaredPcm && buffer.length % 2 !== 0) {
    return {
      ok: false,
      reason: 'malformed_pcm',
      byteLength: buffer.length,
      signature: null,
      evidenceKind: null,
    }
  }

  return {
    ok: true,
    reason: signature ? 'container_audio' : 'declared_pcm',
    byteLength: buffer.length,
    signature: signature || (declaredPcm ? 'pcm' : null),
    // Synthesis bytes only — never device-playback proof.
    evidenceKind: 'audio-response',
  }
}

export function hasSpeechOutputAudio(result) {
  return inspectSpeechOutputAudio(result).ok
}

/**
 * Compare requested target identity with observed/runtime identity.
 * Missing observed fields are treated as unknown (not a mismatch).
 */
export function classifyEvidenceIdentity({
  requestedProviderId,
  requestedModelId,
  requestedVoiceId,
  observedProviderId,
  observedModelId,
  observedVoiceId,
  usedFallback = false,
} = {}) {
  if (usedFallback) {
    return {
      state: 'fallback',
      identityMismatch: true,
      usedFallback: true,
    }
  }

  const providerMatch = idsEqual(requestedProviderId, observedProviderId)
  const modelMatch = idsEqual(requestedModelId, observedModelId)
  const voiceMatch = idsEqual(requestedVoiceId, observedVoiceId)

  if (!providerMatch || !modelMatch || !voiceMatch) {
    return {
      state: 'mismatch',
      identityMismatch: true,
      usedFallback: false,
    }
  }

  const hasObserved = Boolean(
    normalizeId(observedProviderId)
    || normalizeId(observedModelId)
    || normalizeId(observedVoiceId),
  )

  return {
    state: hasObserved ? 'matched' : 'unknown',
    identityMismatch: false,
    usedFallback: false,
  }
}

/**
 * Build evidence bound to the requested target. Observed identity is recorded
 * when the response/runtime exposes it; mismatch/fallback forces partial.
 */
export function buildSpeechConnectionEvidence({
  kind,
  providerId,
  modelId,
  voiceId,
  observedProviderId,
  observedModelId,
  observedVoiceId,
  usedFallback = false,
  /** Synthesis without observed device playback. */
  synthesisOnly = false,
} = {}) {
  const identity = classifyEvidenceIdentity({
    requestedProviderId: providerId,
    requestedModelId: modelId,
    requestedVoiceId: voiceId,
    observedProviderId,
    observedModelId,
    observedVoiceId,
    usedFallback,
  })

  const partial = Boolean(
    synthesisOnly
    || kind === 'preflight'
    || kind === 'endpoint'
    || identity.identityMismatch,
  )

  return {
    kind,
    ...(normalizeId(providerId) ? { providerId: normalizeId(providerId) } : {}),
    ...(normalizeId(modelId) ? { modelId: normalizeId(modelId) } : {}),
    ...(normalizeId(voiceId) ? { voiceId: normalizeId(voiceId) } : {}),
    ...(normalizeId(observedProviderId) ? { observedProviderId: normalizeId(observedProviderId) } : {}),
    ...(normalizeId(observedModelId) ? { observedModelId: normalizeId(observedModelId) } : {}),
    ...(normalizeId(observedVoiceId) ? { observedVoiceId: normalizeId(observedVoiceId) } : {}),
    ...(partial ? { partial: true } : {}),
    ...(identity.identityMismatch ? { identityMismatch: true } : {}),
    ...(identity.usedFallback ? { usedFallback: true } : {}),
  }
}

/**
 * Stable message codes for structured localization. Message params must stay
 * free of secrets, transcripts, raw authorization, and full audio payloads.
 */
export const SPEECH_CONNECTION_MESSAGE = Object.freeze({
  INPUT_READY: 'settings.speech_connection.input_ready',
  INPUT_READY_SILENT: 'settings.speech_connection.input_ready_silent',
  INPUT_INVALID_PROBE: 'settings.speech_connection.input_invalid_probe',
  INPUT_PROVIDER_ERROR: 'settings.speech_connection.input_provider_error',
  INPUT_UNSUPPORTED: 'settings.speech_connection.input_unsupported',
  OUTPUT_SYNTHESIS_READY: 'settings.speech_connection.output_synthesis_ready',
  OUTPUT_SYNTHESIS_FALLBACK: 'settings.speech_connection.output_synthesis_fallback',
  OUTPUT_INVALID_AUDIO: 'settings.speech_connection.output_invalid_audio',
  OUTPUT_EMPTY_AUDIO: 'settings.speech_connection.output_empty_audio',
  IDENTITY_MISMATCH: 'settings.speech_connection.identity_mismatch',
})

/** Fallback Chinese copy when renderer has not yet mapped a key. */
const MESSAGE_FALLBACKS = Object.freeze({
  [SPEECH_CONNECTION_MESSAGE.INPUT_READY]:
    '连接成功，语音识别接口返回了可验证的识别结果。',
  [SPEECH_CONNECTION_MESSAGE.INPUT_READY_SILENT]:
    '连接成功，接口已收到测试音频；静音样本没有识别出文本，这属于预期现象。',
  [SPEECH_CONNECTION_MESSAGE.INPUT_INVALID_PROBE]:
    '语音识别服务返回了成功状态，但没有可验证的识别结果。请检查接口地址、模型和凭据。',
  [SPEECH_CONNECTION_MESSAGE.INPUT_PROVIDER_ERROR]:
    '语音识别服务返回了异常状态，请检查接口和凭据。',
  [SPEECH_CONNECTION_MESSAGE.INPUT_UNSUPPORTED]:
    '当前语音输入提供商暂未接通连接测试。',
  [SPEECH_CONNECTION_MESSAGE.OUTPUT_SYNTHESIS_READY]:
    '连接成功，已拿到可验证的合成音频（尚未验证本机扬声器播放）。',
  [SPEECH_CONNECTION_MESSAGE.OUTPUT_SYNTHESIS_FALLBACK]:
    '连接成功，已拿到合成音频，但实际音色/集群与请求目标不一致，请复核设置。',
  [SPEECH_CONNECTION_MESSAGE.OUTPUT_INVALID_AUDIO]:
    '语音服务返回了成功状态，但音频内容无法验证。请检查接口、音色和模型设置。',
  [SPEECH_CONNECTION_MESSAGE.OUTPUT_EMPTY_AUDIO]:
    '语音服务返回了成功状态，但没有收到有效音频。请检查接口、音色和模型设置。',
  [SPEECH_CONNECTION_MESSAGE.IDENTITY_MISMATCH]:
    '服务有响应，但返回的提供商/模型/音色与请求目标不一致。',
})

export function redactSpeechConnectionText(value) {
  return redactSensitiveErrorText(value)
}

/**
 * Build a connection-result payload with stable messageKey + safe params.
 * Never includes transcripts, secrets, or raw audio.
 */
export function buildSpeechConnectionResult({
  ok,
  messageKey,
  messageParams = undefined,
  code = undefined,
  status = undefined,
  evidence = undefined,
  recommendation = undefined,
  checkedAt = undefined,
  /** Optional provider diagnostic body; redacted and never preferred over messageKey. */
  diagnosticDetail = undefined,
} = {}) {
  const key = messageKey || (ok
    ? SPEECH_CONNECTION_MESSAGE.INPUT_READY
    : SPEECH_CONNECTION_MESSAGE.INPUT_INVALID_PROBE)
  const safeParams = messageParams && typeof messageParams === 'object'
    ? Object.fromEntries(
      Object.entries(messageParams)
        .filter(([, value]) => value !== undefined)
        .map(([paramKey, value]) => [
          paramKey,
          typeof value === 'string' ? redactSpeechConnectionText(value) : value,
        ]),
    )
    : undefined

  const fallback = MESSAGE_FALLBACKS[key]
    || (ok ? MESSAGE_FALLBACKS[SPEECH_CONNECTION_MESSAGE.INPUT_READY]
      : MESSAGE_FALLBACKS[SPEECH_CONNECTION_MESSAGE.INPUT_INVALID_PROBE])

  // Never surface raw provider diagnostic bodies as the primary user message.
  void diagnosticDetail

  return {
    ok: Boolean(ok),
    message: fallback,
    messageKey: key,
    ...(safeParams && Object.keys(safeParams).length > 0 ? { messageParams: safeParams } : {}),
    ...(code ? { code } : {}),
    ...(status ? { status } : {}),
    ...(evidence ? { evidence } : {}),
    ...(recommendation ? { recommendation: redactSpeechConnectionText(recommendation) } : {}),
    ...(checkedAt ? { checkedAt } : {}),
  }
}

export function classifyOpenAiCompatibleSpeechInputProbe({ status, data } = {}) {
  if (isAcceptedNoSpeechResponse(status, data)) {
    return {
      ok: true,
      kind: 'accepted_no_speech',
      messageKey: SPEECH_CONNECTION_MESSAGE.INPUT_READY_SILENT,
      code: undefined,
    }
  }

  if (status !== undefined && status !== null && !(status >= 200 && status < 300)) {
    return {
      ok: false,
      kind: 'http_error',
      messageKey: SPEECH_CONNECTION_MESSAGE.INPUT_PROVIDER_ERROR,
      code: 'provider_error',
    }
  }

  if (!hasSpeechInputResponseShape(data)) {
    return {
      ok: false,
      kind: 'invalid_probe_response',
      messageKey: SPEECH_CONNECTION_MESSAGE.INPUT_INVALID_PROBE,
      code: 'invalid_probe_response',
    }
  }

  const text = extractSpeechInputText(data)
  return {
    ok: true,
    kind: text ? 'text_result' : 'empty_text_result',
    messageKey: text
      ? SPEECH_CONNECTION_MESSAGE.INPUT_READY
      : SPEECH_CONNECTION_MESSAGE.INPUT_READY_SILENT,
    code: undefined,
  }
}

export function classifyVolcengineSpeechInputProbe({ statusCode } = {}) {
  const classified = classifyVolcengineSpeechInputStatus(statusCode)
  if (!classified.ok) {
    return {
      ok: false,
      kind: classified.kind,
      messageKey: classified.kind === 'missing_status'
        ? SPEECH_CONNECTION_MESSAGE.INPUT_INVALID_PROBE
        : SPEECH_CONNECTION_MESSAGE.INPUT_PROVIDER_ERROR,
      code: classified.kind === 'missing_status'
        ? 'invalid_probe_response'
        : 'provider_error',
      providerStatusCode: classified.code || undefined,
    }
  }

  return {
    ok: true,
    kind: classified.kind,
    messageKey: classified.kind === 'no_speech'
      ? SPEECH_CONNECTION_MESSAGE.INPUT_READY_SILENT
      : SPEECH_CONNECTION_MESSAGE.INPUT_READY,
    code: undefined,
    providerStatusCode: classified.code,
  }
}

export function classifySpeechOutputProbe(result, {
  providerId,
  modelId,
  voiceId,
} = {}) {
  const inspection = inspectSpeechOutputAudio(result)
  if (!inspection.ok) {
    return buildSpeechConnectionResult({
      ok: false,
      messageKey: inspection.reason === 'empty_audio' || inspection.reason === 'missing_result'
        ? SPEECH_CONNECTION_MESSAGE.OUTPUT_EMPTY_AUDIO
        : SPEECH_CONNECTION_MESSAGE.OUTPUT_INVALID_AUDIO,
      code: 'invalid_probe_response',
    })
  }

  const observedModelId = normalizeId(result?.resolvedCluster ?? result?.model ?? result?.modelId)
  const observedVoiceId = normalizeId(result?.resolvedVoice ?? result?.voice)
  const usedFallback = Boolean(result?.usedFallback)
  const evidence = buildSpeechConnectionEvidence({
    kind: 'audio-response',
    providerId,
    modelId,
    voiceId,
    observedModelId,
    observedVoiceId,
    usedFallback,
    synthesisOnly: true,
  })

  const messageKey = evidence.identityMismatch || evidence.usedFallback
    ? SPEECH_CONNECTION_MESSAGE.OUTPUT_SYNTHESIS_FALLBACK
    : SPEECH_CONNECTION_MESSAGE.OUTPUT_SYNTHESIS_READY

  return buildSpeechConnectionResult({
    ok: true,
    // Identity mismatch / fallback remains ok:true with partial evidence so
    // the UI can show partial rather than hard error for a working path.
    messageKey,
    evidence,
    status: evidence.identityMismatch ? 'error' : 'ready',
  })
}
