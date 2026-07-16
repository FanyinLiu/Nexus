import type {
  AppSettings,
  ConnectionEvidence,
  ServiceConnectionCapability,
} from '../../types'

export const DEFAULT_CONNECTION_RESULT_TTL_MS = 10 * 60 * 1000
export const CONNECTION_CLOCK_SKEW_TOLERANCE_MS = 30 * 1000
// Leave headroom for the +25 ms used by renderer expiry timers while staying
// below the browser's signed 32-bit setTimeout ceiling.
export const MAX_CONNECTION_EXPIRY_DELAY_MS = 2_147_000_000

export type ConnectionResultFreshness =
  | 'current'
  | 'config-stale'
  | 'time-stale'
  | 'unverified'

export type ConnectionTestResultTone =
  | 'none'
  | 'loading'
  | 'success'
  | 'error'
  | 'stale'
  | 'partial'

export type ConnectionVerificationRecord = {
  fingerprint: string
  checkedAt: string
  evidence?: ConnectionEvidence
  ok: boolean
}

type ConnectionResultFreshnessInput = {
  checkedAt?: string
  evidence?: ConnectionEvidence
}

export function getConnectionResultFreshness(
  result: ConnectionResultFreshnessInput,
  fingerprintMatches: boolean,
  now = new Date(),
  ttlMs = DEFAULT_CONNECTION_RESULT_TTL_MS,
): ConnectionResultFreshness {
  if (!fingerprintMatches) return 'config-stale'
  if (!result.evidence || !result.checkedAt) return 'unverified'
  const checkedAtMs = Date.parse(result.checkedAt)
  if (!Number.isFinite(checkedAtMs)) return 'unverified'
  if (checkedAtMs - now.getTime() > CONNECTION_CLOCK_SKEW_TOLERANCE_MS) return 'unverified'
  if (now.getTime() - checkedAtMs >= ttlMs) return 'time-stale'
  return 'current'
}

export function connectionEvidenceMeetsCapability(
  capability: ServiceConnectionCapability,
  evidence?: ConnectionEvidence,
) {
  if (!evidence) return false
  // Identity mismatch / fallback / explicit partial must never paint the
  // requested target green-ready even when a lower-level path worked.
  if (evidence.identityMismatch || evidence.usedFallback) return false
  if (evidence.partial && evidence.kind !== 'audio-response' && evidence.kind !== 'playback') {
    return false
  }
  switch (capability) {
    case 'text':
      return evidence.kind === 'model-response'
    case 'speech-input':
      // Preflight (dependency presence) is not recognition proof.
      return evidence.kind === 'audio-response' || evidence.kind === 'local-runtime'
    case 'speech-output':
      // audio-response proves functional synthesis for the connection probe.
      // playback is reserved for observed device start. Synthesis-only still
      // qualifies as connection-capability proof; message copy must not claim
      // speaker playback unless kind === 'playback'.
      return evidence.kind === 'audio-response' || evidence.kind === 'playback'
  }
}

/**
 * Ephemeral comparison key for a connection test. It may contain a credential
 * value, so callers must keep it in memory and must never log, render, or persist it.
 */
export function buildConnectionTestFingerprint(
  capability: ServiceConnectionCapability,
  settings: AppSettings,
) {
  switch (capability) {
    case 'text':
      return JSON.stringify([
        capability,
        settings.apiProviderId,
        settings.apiBaseUrl,
        settings.apiKey,
        settings.model,
      ])
    case 'speech-input':
      return JSON.stringify([
        capability,
        settings.speechInputProviderId,
        settings.speechInputApiBaseUrl,
        settings.speechInputApiKey,
        settings.speechInputModel,
      ])
    case 'speech-output':
      return JSON.stringify([
        capability,
        settings.speechOutputEnabled,
        settings.speechOutputProviderId,
        settings.speechOutputApiBaseUrl,
        settings.speechOutputApiKey,
        settings.speechOutputModel,
        settings.speechOutputVoice,
      ])
  }
}

export function withConnectionCheckedAt<T extends { checkedAt?: string }>(result: T, now = new Date()) {
  return result.checkedAt ? result : { ...result, checkedAt: now.toISOString() }
}

/**
 * Earliest future expiry among capability results that still have a trusted
 * checkedAt. Both success and failure must age out so stale red/green cards
 * become neutral after the TTL, not sticky forever.
 */
export function getNextConnectionResultExpiryMs(
  results: Iterable<{ ok?: boolean; checkedAt?: string } | null | undefined>,
  nowMs = Date.now(),
  ttlMs = DEFAULT_CONNECTION_RESULT_TTL_MS,
): number | null {
  let nextExpiry: number | null = null
  for (const result of results) {
    if (!result?.checkedAt) continue
    const checkedAtMs = Date.parse(result.checkedAt)
    if (!Number.isFinite(checkedAtMs)) continue
    if (checkedAtMs - nowMs > CONNECTION_CLOCK_SKEW_TOLERANCE_MS) continue
    const expiry = checkedAtMs + ttlMs
    if (expiry <= nowMs) continue
    const safelyClampedExpiry = Math.min(expiry, nowMs + MAX_CONNECTION_EXPIRY_DELAY_MS)
    if (nextExpiry === null || safelyClampedExpiry < nextExpiry) nextExpiry = safelyClampedExpiry
  }
  return nextExpiry
}

/**
 * Failure freshness does not require capability evidence — a current failure
 * is still an error. Config change, TTL expiry, and future-dated clocks still
 * neutralize the card so old failures cannot outlive the config they tested.
 */
export function getConnectionFailureFreshness(
  result: { checkedAt?: string },
  fingerprintMatches: boolean,
  now = new Date(),
  ttlMs = DEFAULT_CONNECTION_RESULT_TTL_MS,
): ConnectionResultFreshness {
  if (!fingerprintMatches) return 'config-stale'
  if (!result.checkedAt) return 'current'
  const checkedAtMs = Date.parse(result.checkedAt)
  if (!Number.isFinite(checkedAtMs)) return 'unverified'
  if (checkedAtMs - now.getTime() > CONNECTION_CLOCK_SKEW_TOLERANCE_MS) return 'unverified'
  if (now.getTime() - checkedAtMs >= ttlMs) return 'time-stale'
  return 'current'
}

export function shouldAcceptConnectionTestResult(options: {
  requestGeneration: number
  activeGeneration: number
  requestEpoch?: number
  activeEpoch?: number
}) {
  if (options.requestGeneration !== options.activeGeneration) return false
  if (
    options.requestEpoch !== undefined
    && options.activeEpoch !== undefined
    && options.requestEpoch !== options.activeEpoch
  ) {
    return false
  }
  return true
}

export function createConnectionVerificationRecord(
  capability: ServiceConnectionCapability,
  settings: AppSettings,
  result: { ok: boolean; checkedAt?: string; evidence?: ConnectionEvidence },
  now = new Date(),
): ConnectionVerificationRecord {
  const stamped = withConnectionCheckedAt(result, now)
  return {
    fingerprint: buildConnectionTestFingerprint(capability, settings),
    checkedAt: stamped.checkedAt as string,
    evidence: result.evidence,
    ok: result.ok,
  }
}

export function isConnectionVerificationCurrent(
  record: ConnectionVerificationRecord | null | undefined,
  capability: ServiceConnectionCapability,
  settings: AppSettings,
  now = new Date(),
  ttlMs = DEFAULT_CONNECTION_RESULT_TTL_MS,
): boolean {
  if (!record?.ok) return false
  const fingerprintMatches = record.fingerprint === buildConnectionTestFingerprint(capability, settings)
  if (getConnectionResultFreshness(record, fingerprintMatches, now, ttlMs) !== 'current') return false
  return connectionEvidenceMeetsCapability(capability, record.evidence)
}

export type ConnectionTestResultPresentation = {
  tone: ConnectionTestResultTone
  className: string | null
  freshness: ConnectionResultFreshness | null
  verified: boolean
}

/**
 * Pure presentation policy for connection-test result cards. Success styling
 * is reserved for current, fingerprint-matched, evidence-backed results.
 */
export function getConnectionTestResultPresentation(
  input: {
    testing?: boolean
    result?: (ConnectionResultFreshnessInput & { ok: boolean }) | null
    fingerprintMatches: boolean
    capability: ServiceConnectionCapability
  },
  now = new Date(),
  ttlMs = DEFAULT_CONNECTION_RESULT_TTL_MS,
): ConnectionTestResultPresentation {
  if (input.testing) {
    return {
      tone: 'loading',
      className: 'settings-test-result is-loading',
      freshness: null,
      verified: false,
    }
  }

  if (!input.result) {
    return {
      tone: 'none',
      className: null,
      freshness: null,
      verified: false,
    }
  }

  if (!input.result.ok) {
    const failureFreshness = getConnectionFailureFreshness(
      input.result,
      input.fingerprintMatches,
      now,
      ttlMs,
    )
    if (
      failureFreshness === 'config-stale'
      || failureFreshness === 'time-stale'
      || failureFreshness === 'unverified'
    ) {
      return {
        tone: 'stale',
        className: 'settings-test-result is-stale',
        freshness: failureFreshness,
        verified: false,
      }
    }
    return {
      tone: 'error',
      className: 'settings-test-result is-error',
      freshness: failureFreshness,
      verified: false,
    }
  }

  const freshness = getConnectionResultFreshness(
    input.result,
    input.fingerprintMatches,
    now,
    ttlMs,
  )

  if (freshness === 'config-stale' || freshness === 'time-stale' || freshness === 'unverified') {
    return {
      tone: 'stale',
      className: 'settings-test-result is-stale',
      freshness,
      verified: false,
    }
  }

  if (!connectionEvidenceMeetsCapability(input.capability, input.result.evidence)) {
    return {
      tone: 'partial',
      className: 'settings-test-result is-partial',
      freshness,
      verified: false,
    }
  }

  return {
    tone: 'success',
    className: 'settings-test-result is-success',
    freshness,
    verified: true,
  }
}

/**
 * Resolve a connection-result message for the active UI language.
 * Prefer structured messageKey + safe params; never invent success from fallbacks.
 */
export function resolveConnectionResultMessage(
  result: {
    message?: string
    messageKey?: string
    messageParams?: Record<string, string | number | boolean | null | undefined>
  },
  uiLanguage: AppSettings['uiLanguage'],
  translate: (
    language: AppSettings['uiLanguage'],
    key: string,
    params?: Record<string, string | number | boolean | null | undefined>,
  ) => string,
): string {
  if (result.messageKey) {
    return translate(uiLanguage, result.messageKey, result.messageParams)
  }
  return String(result.message ?? '')
}

export function resolveConnectionResultRecommendation(
  result: {
    recommendation?: string
    recommendationKey?: string
    messageParams?: Record<string, string | number | boolean | null | undefined>
  },
  uiLanguage: AppSettings['uiLanguage'],
  translate: (
    language: AppSettings['uiLanguage'],
    key: string,
    params?: Record<string, string | number | boolean | null | undefined>,
  ) => string,
): string | undefined {
  if (result.recommendationKey) {
    return translate(uiLanguage, result.recommendationKey, result.messageParams)
  }
  return result.recommendation
}
