import type {
  AuthProfile,
  AuthProfileSnapshot,
  AuthProfileStatus,
  ProviderId,
} from './types.ts'

const DEFAULT_COOLDOWN_MS = 60_000
const AUTH_PROFILE_STATUSES = new Set<AuthProfileStatus>(['active', 'cooldown', 'failed'])
const HTTP_HEADER_SAFE_CREDENTIAL_PATTERN = /^[\x21-\x7E]+$/u

export type RegisterProfileInput = {
  id: string
  providerId: ProviderId
  apiKey: string
  label?: string
}

function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined
}

function cloneProfile(profile: AuthProfile): AuthProfile {
  return { ...profile }
}

export function isHttpHeaderSafeCredential(value: unknown): boolean {
  const credential = typeof value === 'string' ? value.trim() : ''
  return credential.length > 0 && HTTP_HEADER_SAFE_CREDENTIAL_PATTERN.test(credential)
}

export function formatUnsafeCredentialError(label = 'API key'): string {
  return `${label} must not contain spaces, newlines, Chinese text, or other characters that cannot be sent in an HTTP header.`
}

function normalizeProfile(value: unknown): AuthProfile | null {
  if (!value || typeof value !== 'object') return null
  const profile = value as Partial<AuthProfile>
  if (typeof profile.id !== 'string' || !profile.id.trim()) return null
  if (typeof profile.providerId !== 'string' || !profile.providerId.trim()) return null
  const apiKey = typeof profile.apiKey === 'string' ? profile.apiKey.trim() : ''
  if (!isHttpHeaderSafeCredential(apiKey)) return null
  const status = AUTH_PROFILE_STATUSES.has(profile.status as AuthProfileStatus)
    ? profile.status as AuthProfileStatus
    : 'active'
  const cooldownUntil = normalizeOptionalNumber(profile.cooldownUntil)
  const lastUsedAt = normalizeOptionalNumber(profile.lastUsedAt)
  const label = typeof profile.label === 'string' ? profile.label.trim() : ''
  return {
    id: profile.id.trim(),
    providerId: profile.providerId.trim(),
    apiKey,
    ...(label ? { label } : {}),
    status,
    successCount: normalizeNonNegativeInteger(profile.successCount),
    failureCount: normalizeNonNegativeInteger(profile.failureCount),
    ...(status === 'cooldown' && cooldownUntil !== undefined ? { cooldownUntil } : {}),
    ...(lastUsedAt !== undefined ? { lastUsedAt } : {}),
  }
}

export function normalizeAuthProfileSnapshot(value: unknown): AuthProfileSnapshot {
  if (!value || typeof value !== 'object') return { profiles: [] }
  const snapshot = value as Partial<AuthProfileSnapshot>
  if (!Array.isArray(snapshot.profiles)) return { profiles: [] }
  const profiles: AuthProfile[] = []
  const seen = new Set<string>()
  for (const item of snapshot.profiles) {
    const normalized = normalizeProfile(item)
    if (!normalized || seen.has(normalized.id)) continue
    seen.add(normalized.id)
    profiles.push(normalized)
  }
  return { profiles }
}

export class AuthProfileStore {
  private readonly profiles = new Map<string, AuthProfile>()
  private readonly cooldownMs: number

  constructor(options?: { cooldownMs?: number }) {
    this.cooldownMs = options?.cooldownMs ?? DEFAULT_COOLDOWN_MS
  }

  register(input: RegisterProfileInput): AuthProfile {
    const id = input.id.trim()
    const providerId = input.providerId.trim()
    const apiKey = input.apiKey.trim()
    const label = input.label?.trim()
    if (!id || !providerId || !apiKey) {
      throw new Error('AuthProfileStore.register requires non-empty id, providerId and apiKey')
    }
    if (!isHttpHeaderSafeCredential(apiKey)) {
      throw new Error(formatUnsafeCredentialError())
    }
    const existing = this.profiles.get(id)
    if (existing) {
      existing.providerId = providerId
      existing.apiKey = apiKey
      existing.label = label || undefined
      return cloneProfile(existing)
    }
    const profile: AuthProfile = {
      id,
      providerId,
      apiKey,
      ...(label ? { label } : {}),
      status: 'active',
      successCount: 0,
      failureCount: 0,
    }
    this.profiles.set(profile.id, profile)
    return cloneProfile(profile)
  }

  remove(id: string): void {
    this.profiles.delete(id)
  }

  get(id: string): AuthProfile | undefined {
    this.refreshExpiredCooldowns()
    const profile = this.profiles.get(id)
    return profile ? cloneProfile(profile) : undefined
  }

  list(providerId?: ProviderId): AuthProfile[] {
    this.refreshExpiredCooldowns()
    const all = Array.from(this.profiles.values())
    const profiles = providerId ? all.filter((p) => p.providerId === providerId) : all
    return profiles.map(cloneProfile)
  }

  pickNextActive(providerId: ProviderId, now: number = Date.now()): AuthProfile | undefined {
    this.refreshExpiredCooldowns(now)
    const candidates: AuthProfile[] = []
    for (const profile of this.profiles.values()) {
      if (profile.providerId !== providerId) continue
      if (profile.status === 'active') {
        candidates.push(profile)
      }
    }
    if (candidates.length === 0) return undefined
    candidates.sort((a, b) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0))
    const picked = candidates[0]
    picked.lastUsedAt = now
    return cloneProfile(picked)
  }

  recordSuccess(id: string): void {
    const profile = this.profiles.get(id)
    if (!profile) return
    profile.successCount += 1
    profile.status = 'active'
    profile.cooldownUntil = undefined
  }

  recordFailure(id: string, reason: 'rate_limit' | 'auth' | 'other' = 'other'): void {
    const profile = this.profiles.get(id)
    if (!profile) return
    profile.failureCount += 1
    if (reason === 'auth') {
      profile.status = 'failed'
      return
    }
    profile.status = 'cooldown'
    profile.cooldownUntil = Date.now() + this.cooldownMs
  }

  setStatus(id: string, status: AuthProfileStatus): void {
    const profile = this.profiles.get(id)
    if (!profile) return
    profile.status = status
    if (status !== 'cooldown') {
      profile.cooldownUntil = undefined
    }
  }

  snapshot(): AuthProfileSnapshot {
    this.refreshExpiredCooldowns()
    return { profiles: Array.from(this.profiles.values()).map(cloneProfile) }
  }

  restore(snapshot: AuthProfileSnapshot): void {
    this.profiles.clear()
    for (const profile of normalizeAuthProfileSnapshot(snapshot).profiles) {
      this.profiles.set(profile.id, cloneProfile(profile))
    }
  }

  private refreshExpiredCooldowns(now: number = Date.now()): void {
    for (const profile of this.profiles.values()) {
      if (
        profile.status === 'cooldown'
        && profile.cooldownUntil !== undefined
        && profile.cooldownUntil <= now
      ) {
        profile.status = 'active'
        profile.cooldownUntil = undefined
      }
    }
  }
}
