import { apiProviderRequiresApiKey } from '../models/providerCatalog.ts'

export type BackgroundChatInput = {
  providerId?: string
  baseUrl: string
  model: string
  apiKey?: string
}

export type BackgroundChatFailureKind = 'auth' | 'transient'

export type BackgroundChatGateReason =
  | 'ready'
  | 'invalid_config'
  | 'missing_api_key'
  | 'auth_blocked'
  | 'transient_cooldown'

export type BackgroundChatGate = {
  allowed: boolean
  reason: BackgroundChatGateReason
  shouldNotify: boolean
  retryAt?: number
}

const TRANSIENT_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  25 * 60_000,
  60 * 60_000,
] as const

type BackgroundChatIdentity = {
  providerId: string
  baseUrl: string
  model: string
  apiKey: string
}

type BackgroundChatState = {
  identity: BackgroundChatIdentity
  authBlocked: boolean
  transientFailureCount: number
  cooldownUntil: number
  notifiedSignal: string | null
}

// Keep one bucket per configuration identity. The key is deliberately kept
// inside this module only; it may contain the ephemeral API key, but it is
// never returned, logged, persisted, or rendered.
const MAX_IDENTITY_STATES = 16
const states = new Map<string, BackgroundChatState>()
let leaseOwner: symbol | null = null

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function identityFor(input: BackgroundChatInput): BackgroundChatIdentity {
  return {
    providerId: normalize(input.providerId).toLowerCase(),
    baseUrl: normalize(input.baseUrl),
    model: normalize(input.model),
    apiKey: normalize(input.apiKey),
  }
}

function identityKey(identity: BackgroundChatIdentity): string {
  return JSON.stringify([
    identity.providerId,
    identity.baseUrl,
    identity.model,
    identity.apiKey,
  ])
}

function ensureState(input: BackgroundChatInput): BackgroundChatState {
  const identity = identityFor(input)
  const key = identityKey(identity)
  let current = states.get(key)
  if (!current) {
    if (states.size >= MAX_IDENTITY_STATES) {
      const oldestKey = states.keys().next().value
      if (typeof oldestKey === 'string') states.delete(oldestKey)
    }
    current = {
      identity,
      authBlocked: false,
      transientFailureCount: 0,
      cooldownUntil: 0,
      notifiedSignal: null,
    }
    states.set(key, current)
  }
  return current
}

function notifyOnce(current: BackgroundChatState, signal: string): boolean {
  if (current.notifiedSignal === signal) return false
  current.notifiedSignal = signal
  return true
}

function requiresApiKey(providerId: string): boolean {
  try {
    return apiProviderRequiresApiKey(providerId)
  } catch {
    return true
  }
}

/**
 * Check readiness and the in-memory auth/transient state before any prompt,
 * persona load, IPC, or network work. No input is persisted or returned.
 */
export function getBackgroundChatGate(
  input: BackgroundChatInput,
  now = Date.now(),
): BackgroundChatGate {
  const current = ensureState(input)
  const providerId = current.identity.providerId
  const hasBaseUrl = current.identity.baseUrl.length > 0
  const hasModel = current.identity.model.length > 0

  if (!hasBaseUrl || !hasModel) {
    return {
      allowed: false,
      reason: 'invalid_config',
      shouldNotify: notifyOnce(current, 'invalid_config'),
    }
  }

  if (requiresApiKey(providerId) && current.identity.apiKey.length === 0) {
    return {
      allowed: false,
      reason: 'missing_api_key',
      shouldNotify: notifyOnce(current, 'missing_api_key'),
    }
  }

  if (current.authBlocked) {
    return {
      allowed: false,
      reason: 'auth_blocked',
      shouldNotify: notifyOnce(current, 'auth_blocked'),
    }
  }

  if (current.cooldownUntil > now) {
    return {
      allowed: false,
      reason: 'transient_cooldown',
      retryAt: current.cooldownUntil,
      shouldNotify: notifyOnce(current, `transient_cooldown:${current.cooldownUntil}`),
    }
  }

  return { allowed: true, reason: 'ready', shouldNotify: false }
}

export function recordBackgroundChatFailure(
  input: BackgroundChatInput,
  kind: BackgroundChatFailureKind,
  now = Date.now(),
): void {
  const current = ensureState(input)
  current.notifiedSignal = null

  if (kind === 'auth') {
    current.authBlocked = true
    current.cooldownUntil = 0
    current.transientFailureCount = 0
    return
  }

  current.authBlocked = false
  current.transientFailureCount = Math.min(
    current.transientFailureCount + 1,
    TRANSIENT_BACKOFF_MS.length,
  )
  current.cooldownUntil = now + TRANSIENT_BACKOFF_MS[current.transientFailureCount - 1]
}

export function recordBackgroundChatSuccess(input: BackgroundChatInput): void {
  const current = ensureState(input)
  current.authBlocked = false
  current.transientFailureCount = 0
  current.cooldownUntil = 0
  current.notifiedSignal = null
}

export function classifyBackgroundChatFailure(error: unknown): BackgroundChatFailureKind {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status?: unknown }).status
    : undefined
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined
  const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : ''
  const normalizedCode = typeof code === 'string' ? code.trim().toLowerCase() : ''
  if (
    status === 401
    || status === 403
    || normalizedStatus === '401'
    || normalizedStatus === '403'
    || normalizedStatus === 'needs_key'
    || normalizedCode === 'auth_failed'
    || normalizedCode === 'missing_api_key'
    || normalizedCode === 'api_key_header_unsafe'
  ) return 'auth'

  const message = error instanceof Error ? error.message : String(error ?? '')
  return /401|403|unauthori[sz]ed|authentication|missing\s+(?:an?\s+)?(?:api\s*)?key|还没填\s*(?:api\s*)?key|還沒填\s*(?:api\s*)?key|先填\s*(?:一下\s*)?(?:api\s*)?key|先填寫\s*(?:一下\s*)?(?:api\s*)?key|請先填\s*(?:一下\s*)?(?:api\s*)?key|未填写\s*(?:api\s*)?key|未填寫\s*(?:api\s*)?key|没有填\s*(?:api\s*)?key|沒有填\s*(?:api\s*)?key|身份验证失败|身份認證失敗|认证失败|認證失敗|鉴权失败|鑑權失敗|(?:api\s*key|接口密钥|介面密鑰|密钥|密鑰).{0,20}(?:不太对|不太對|不正确|不正確|无效|無效|错误|錯誤)/i.test(message)
    ? 'auth'
    : 'transient'
}

export function isBackgroundChatLeaseAvailable(): boolean {
  return !leaseOwner
}

/** Module-scope lease shared by Dream, V2 autonomy, and Sunday Letter. */
export function acquireBackgroundChatLease(): symbol | null {
  if (leaseOwner) return null
  leaseOwner = Symbol('background-chat-lease')
  return leaseOwner
}

export function releaseBackgroundChatLease(token: symbol): boolean {
  if (!leaseOwner || token !== leaseOwner) return false
  leaseOwner = null
  return true
}

/** Test-only reset; production callers should rely on success/config changes. */
export function resetBackgroundChatPolicyForTests(): void {
  states.clear()
  leaseOwner = null
}
