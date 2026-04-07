export type FailoverDomain = 'chat' | 'speech-input' | 'speech-output'

type FailoverEntry = {
  errorCount: number
  cooldownUntil?: string
  lastError?: string
  lastFailureAt?: string
  lastSuccessAt?: string
}

type FailoverState = {
  entries: Record<string, FailoverEntry>
}

const FAILOVER_STATE_STORAGE_KEY = 'nexus:provider-failover-state'
const FAILOVER_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  25 * 60_000,
  60 * 60_000,
]

function readState(): FailoverState {
  try {
    const raw = window.localStorage.getItem(FAILOVER_STATE_STORAGE_KEY)
    if (!raw) {
      return { entries: {} }
    }

    const parsed = JSON.parse(raw) as FailoverState | null
    return parsed?.entries ? parsed : { entries: {} }
  } catch {
    return { entries: {} }
  }
}

function writeState(state: FailoverState) {
  window.localStorage.setItem(FAILOVER_STATE_STORAGE_KEY, JSON.stringify(state))
}

function normalizeKeyPart(value: string) {
  return String(value ?? '').trim().toLowerCase()
}

export function buildFailoverKey(domain: FailoverDomain, providerId: string, identity = '') {
  const normalizedIdentity = normalizeKeyPart(identity)
  return normalizedIdentity
    ? `${domain}:${normalizeKeyPart(providerId)}:${normalizedIdentity}`
    : `${domain}:${normalizeKeyPart(providerId)}`
}

export function isFailoverCoolingDown(key: string, now = Date.now()) {
  const entry = readState().entries[key]
  const cooldownAt = Date.parse(entry?.cooldownUntil ?? '')
  return Number.isFinite(cooldownAt) && cooldownAt > now
}

export function getFailoverCooldownLabel(key: string) {
  const entry = readState().entries[key]
  const cooldownAt = Date.parse(entry?.cooldownUntil ?? '')
  if (!Number.isFinite(cooldownAt)) {
    return ''
  }

  return new Date(cooldownAt).toISOString()
}

export function recordFailoverSuccess(key: string) {
  const state = readState()
  state.entries[key] = {
    errorCount: 0,
    lastSuccessAt: new Date().toISOString(),
  }
  writeState(state)
}

export function recordFailoverFailure(key: string, errorMessage: string) {
  const state = readState()
  const previous = state.entries[key]
  const nextErrorCount = Math.max(1, (previous?.errorCount ?? 0) + 1)
  const backoffMs = FAILOVER_BACKOFF_MS[Math.min(nextErrorCount - 1, FAILOVER_BACKOFF_MS.length - 1)]
  const now = Date.now()

  state.entries[key] = {
    errorCount: nextErrorCount,
    cooldownUntil: new Date(now + backoffMs).toISOString(),
    lastError: errorMessage,
    lastFailureAt: new Date(now).toISOString(),
    lastSuccessAt: previous?.lastSuccessAt,
  }

  writeState(state)
}

export function isFailoverEligibleError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (!message.trim()) {
    return true
  }

  if (
    /aborterror|aborted|已取消|已中止|cancell?ed/u.test(message)
  ) {
    return false
  }

  return !(
    /请先填写|未连接桌面客户端|没有可播报的文本|没有可用的音频轨道|关键词不能为空|模型名|API Key/u.test(message)
  )
}

export function clearFailoverCooldown(key: string) {
  const state = readState()
  if (!(key in state.entries)) {
    return
  }

  delete state.entries[key]
  writeState(state)
}
