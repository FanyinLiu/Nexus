import {
  ERRAND_RUNNER_STATE_STORAGE_KEY,
  readJson,
  writeJson,
} from '../../lib/storage.ts'
import type { ErrandRunnerState } from './errandPolicy.ts'

function hasChanged(normalized: unknown, raw: unknown): boolean {
  return JSON.stringify(normalized) !== JSON.stringify(raw)
}

function parseIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString()
}

function parseRunCount(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.max(0, Math.floor(numeric))
}

export function normalizeErrandRunnerState(raw: unknown): ErrandRunnerState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const obj = raw as Record<string, unknown>
  const state: ErrandRunnerState = {}

  const lastRunAt = parseIsoTimestamp(obj.lastRunAt)
  if (lastRunAt) state.lastRunAt = lastRunAt

  const nightStartedAt = parseIsoTimestamp(obj.nightStartedAt)
  if (nightStartedAt) state.nightStartedAt = nightStartedAt

  const ranThisNight = parseRunCount(obj.ranThisNight)
  if (ranThisNight !== null) state.ranThisNight = ranThisNight

  return state
}

export function readErrandRunnerState(): ErrandRunnerState {
  const raw = readJson<unknown>(ERRAND_RUNNER_STATE_STORAGE_KEY, {})
  const normalized = normalizeErrandRunnerState(raw)
  if (hasChanged(normalized, raw)) {
    writeJson(ERRAND_RUNNER_STATE_STORAGE_KEY, normalized)
  }
  return normalized
}

export function writeErrandRunnerState(state: ErrandRunnerState): void {
  writeJson(ERRAND_RUNNER_STATE_STORAGE_KEY, normalizeErrandRunnerState(state))
}
