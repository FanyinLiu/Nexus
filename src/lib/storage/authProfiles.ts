import {
  normalizeAuthProfileSnapshot,
} from '../../core/routing/AuthProfileStore.ts'
import type { AuthProfile, AuthProfileSnapshot } from '../../core/routing/types.ts'
import { AUTH_PROFILES_STORAGE_KEY, readJson, writeJson } from './core.ts'

export function loadAuthProfileSnapshot(): AuthProfileSnapshot {
  const raw = readJson<unknown>(AUTH_PROFILES_STORAGE_KEY, { profiles: [] })
  const normalized = normalizeAuthProfileSnapshot(raw)
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
    writeJson(AUTH_PROFILES_STORAGE_KEY, normalized)
  }
  return normalized
}

export function persistAuthProfileSnapshot(snapshot: AuthProfileSnapshot): void {
  writeJson(AUTH_PROFILES_STORAGE_KEY, normalizeAuthProfileSnapshot(snapshot))
}

export function upsertStoredAuthProfile(profile: AuthProfile): void {
  const snapshot = loadAuthProfileSnapshot()
  const next = snapshot.profiles.filter((p) => p.id !== profile.id)
  next.push({ ...profile })
  persistAuthProfileSnapshot({ profiles: next })
}

export function removeStoredAuthProfile(id: string): void {
  const snapshot = loadAuthProfileSnapshot()
  persistAuthProfileSnapshot({
    profiles: snapshot.profiles.filter((p) => p.id !== id),
  })
}
