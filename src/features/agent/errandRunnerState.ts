import {
  ERRAND_RUNNER_STATE_STORAGE_KEY,
  readJson,
  writeJson,
} from '../../lib/storage.ts'
import type { ErrandRunnerState } from './errandPolicy.ts'

function parseIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString()
}

function parseRunCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.floor(value))
}

export function readErrandRunnerState(): ErrandRunnerState {
  const raw = readJson<unknown>(ERRAND_RUNNER_STATE_STORAGE_KEY, {})
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

export function writeErrandRunnerState(state: ErrandRunnerState): void {
  writeJson(ERRAND_RUNNER_STATE_STORAGE_KEY, state)
}
