import { OPEN_GOALS_STORAGE_KEY, createId, readJson, writeJsonDebounced } from '../../lib/storage/core'
import { planStore } from '../plan/planStore'
import { t } from '../../i18n/runtime.ts'
import type { AgentStopReason } from './agentLoop'

export type OpenGoalStatus = 'paused' | 'aborted'

export type OpenGoal = {
  id: string
  goal: string
  status: OpenGoalStatus
  reason?: string
  planId?: string
  lastResponse?: string
  iterations: number
  createdAt: number
  updatedAt: number
  lastNudgedAt?: number
  nudgeCount: number
}

export type OpenGoalListener = (goals: OpenGoal[]) => void

const NUDGE_BACKOFF_MS = 30 * 60 * 1000
const MAX_NUDGES_PER_GOAL = 3
const MAX_OPEN_GOALS = 50

function hashString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

class OpenGoalsStoreImpl {
  private goals: OpenGoal[] = []
  private listeners = new Set<OpenGoalListener>()
  private hydrated = false

  hydrate(): void {
    if (this.hydrated) return
    this.goals = readJson<OpenGoal[]>(OPEN_GOALS_STORAGE_KEY, [])
    this.hydrated = true
  }

  list(): OpenGoal[] {
    this.hydrate()
    return [...this.goals]
  }

  get(id: string): OpenGoal | undefined {
    this.hydrate()
    return this.goals.find((g) => g.id === id)
  }

  add(input: {
    goal: string
    status?: OpenGoalStatus
    reason?: string
    planId?: string
    lastResponse?: string
    iterations?: number
  }): OpenGoal {
    this.hydrate()
    const now = Date.now()
    const entry: OpenGoal = {
      id: createId('opengoal'),
      goal: input.goal,
      status: input.status ?? 'paused',
      reason: input.reason,
      planId: input.planId,
      lastResponse: input.lastResponse,
      iterations: input.iterations ?? 0,
      createdAt: now,
      updatedAt: now,
      nudgeCount: 0,
    }
    this.goals.unshift(entry)
    if (this.goals.length > MAX_OPEN_GOALS) {
      this.goals = this.goals.slice(0, MAX_OPEN_GOALS)
    }
    this.persist()
    return entry
  }

  recordFromAgentResult(input: {
    goal: string
    status: AgentStopReason
    reason?: string
    planId?: string
    lastResponse?: string
    iterations: number
  }): OpenGoal | undefined {
    if (input.status === 'done' || input.status === 'error') return undefined
    return this.add({
      goal: input.goal,
      status: input.status === 'aborted' ? 'aborted' : 'paused',
      reason: input.reason,
      planId: input.planId,
      lastResponse: input.lastResponse,
      iterations: input.iterations,
    })
  }

  markNudged(id: string): void {
    this.hydrate()
    const idx = this.goals.findIndex((g) => g.id === id)
    if (idx < 0) return
    const now = Date.now()
    this.goals[idx] = {
      ...this.goals[idx],
      lastNudgedAt: now,
      nudgeCount: this.goals[idx].nudgeCount + 1,
      updatedAt: now,
    }
    this.persist()
  }

  remove(id: string): void {
    this.hydrate()
    const before = this.goals.length
    this.goals = this.goals.filter((g) => g.id !== id)
    if (this.goals.length !== before) this.persist()
  }

  clear(): void {
    this.goals = []
    this.hydrated = true
    this.persist()
  }

  pickEligibleForNudge(now: number = Date.now()): OpenGoal | undefined {
    this.hydrate()
    const eligible = this.goals.filter((g) => {
      if (g.nudgeCount >= MAX_NUDGES_PER_GOAL) return false
      if (g.lastNudgedAt && now - g.lastNudgedAt < NUDGE_BACKOFF_MS) return false
      return true
    })
    if (!eligible.length) return undefined
    return [...eligible].sort((a, b) => a.createdAt - b.createdAt)[0]
  }

  buildNudgeText(goal: OpenGoal): string {
    let progressNote = ''
    if (goal.planId) {
      const plan = planStore.get(goal.planId)
      if (plan) {
        const total = plan.steps.length
        const completed = plan.steps.filter((s) => s.status === 'completed').length
        if (total > 0) progressNote = t('agent.goal.progress_note', { done: completed, total })
      }
    }
    const reason = goal.status === 'aborted' && goal.reason
      ? t('agent.goal.stopped_reason', { reason: goal.reason })
      : ''

    // Pick a template deterministically from goal.id + nudgeCount so the same
    // goal gets a different phrasing on each follow-up, but a single nudge
    // doesn't flicker between renders.
    const nudgeKeys = [
      'agent.goal.nudge.1',
      'agent.goal.nudge.2',
      'agent.goal.nudge.3',
      'agent.goal.nudge.4',
      'agent.goal.nudge.5',
    ] as const
    const seed = hashString(goal.id) + goal.nudgeCount
    const key = nudgeKeys[seed % nudgeKeys.length]
    return t(key, { goal: goal.goal, progress: progressNote, reason })
  }

  subscribe(listener: OpenGoalListener): () => void {
    this.hydrate()
    this.listeners.add(listener)
    listener(this.list())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private persist(): void {
    writeJsonDebounced(OPEN_GOALS_STORAGE_KEY, this.goals)
    const snapshot = this.list()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // listener errors must not break the store
      }
    }
  }
}

export const openGoalsStore = new OpenGoalsStoreImpl()
