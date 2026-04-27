/**
 * Drive a single errand through the agent loop and persist the result.
 *
 * Pure-ish: no scheduling, no clock side effects beyond timestamping.
 * The caller (useErrandScheduler) decides *when* to invoke this; the
 * runner just executes one errand end-to-end.
 *
 * The agent loop is the same one chat agent mode uses. Errands set
 * `recordOpenGoal: false` and `recordTrace: false` so the user's chat
 * trace panel doesn't get polluted with overnight side activity.
 */

import { runAgentLoop, type AgentExecuteTurn } from './agentLoop.ts'
import { updateErrand, type ErrandRecord } from './errandStore.ts'
import {
  ERRAND_RUNNER_STATE_STORAGE_KEY,
  readJson,
  writeJson,
} from '../../lib/storage'
import {
  type ErrandRunnerState,
} from './errandPolicy.ts'
import type { UiLanguage } from '../../types'

export interface RunErrandDeps {
  executeTurn: AgentExecuteTurn
  uiLanguage?: UiLanguage
  maxIterations?: number
  signal?: AbortSignal
}

const DEFAULT_MAX_ITERATIONS = 6

export async function runErrand(
  errand: ErrandRecord,
  deps: RunErrandDeps,
): Promise<ErrandRecord> {
  const startedAt = new Date().toISOString()
  const running = updateErrand(errand.id, { status: 'running', startedAt })
  if (!running) return errand

  try {
    const result = await runAgentLoop({
      goal: errand.prompt,
      initialHistory: [],
      executeTurn: deps.executeTurn,
      maxIterations: deps.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      uiLanguage: deps.uiLanguage,
      signal: deps.signal,
      recordOpenGoal: false,
      recordTrace: false,
    })

    const completedAt = new Date().toISOString()
    if (result.status === 'done') {
      return updateErrand(errand.id, {
        status: 'completed',
        completedAt,
        result: result.finalResponse,
        iterationsUsed: result.iterations,
      }) ?? running
    }
    return updateErrand(errand.id, {
      status: 'failed',
      completedAt,
      result: result.finalResponse,
      iterationsUsed: result.iterations,
      error: result.reason ?? `agent_loop_${result.status}`,
    }) ?? running
  } catch (err) {
    return updateErrand(errand.id, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    }) ?? running
  }
}

// ── Runner state persistence ─────────────────────────────────────────────

export function readErrandRunnerState(): ErrandRunnerState {
  const raw = readJson<unknown>(ERRAND_RUNNER_STATE_STORAGE_KEY, {})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const obj = raw as Record<string, unknown>
  const state: ErrandRunnerState = {}
  if (typeof obj.lastRunAt === 'string') state.lastRunAt = obj.lastRunAt
  if (typeof obj.nightStartedAt === 'string') state.nightStartedAt = obj.nightStartedAt
  if (typeof obj.ranThisNight === 'number' && Number.isFinite(obj.ranThisNight)) {
    state.ranThisNight = obj.ranThisNight
  }
  return state
}

export function writeErrandRunnerState(state: ErrandRunnerState): void {
  writeJson(ERRAND_RUNNER_STATE_STORAGE_KEY, state)
}
