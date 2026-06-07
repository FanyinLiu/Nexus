// PlanStore — explicit goal → steps state machine for agent runs.
//
// The agent loop in features/agent/agentLoop.ts can run without a plan, but
// when the user (or the model itself) wants a visible task list, the loop
// creates a Plan, the model emits step updates between iterations, and the
// PlanPanel UI shows progress in real time.
//
// Storage is localStorage (debounced) — survives reloads but is local-first
// like every other Nexus subsystem. No IPC, no IndexedDB, no migrations.

import {
  PLAN_STORE_STORAGE_KEY,
  createId,
  readJsonValidated,
  writeJsonDebounced,
} from '../../lib/storage/core.ts'

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'

export type PlanStep = {
  id: string
  text: string
  status: PlanStepStatus
  result?: string
  startedAt?: number
  completedAt?: number
}

export type PlanStatus = 'draft' | 'active' | 'completed' | 'aborted'

export type Plan = {
  id: string
  goal: string
  steps: PlanStep[]
  status: PlanStatus
  createdAt: number
  updatedAt: number
}

export type PlanListener = (plans: Plan[]) => void

const PLAN_STEP_STATUSES = new Set<PlanStepStatus>([
  'pending',
  'in_progress',
  'completed',
  'skipped',
  'failed',
])

const PLAN_STATUSES = new Set<PlanStatus>([
  'draft',
  'active',
  'completed',
  'aborted',
])

const MAX_PLAN_GOAL_CHARS = 500
const MAX_PLAN_STEP_TEXT_CHARS = 500
const MAX_PLAN_RESULT_CHARS = 4_000
const MAX_PLAN_STEPS = 64
const FALLBACK_PLAN_GOAL = 'Untitled plan'

function clonePlan(plan: Plan): Plan {
  return {
    ...plan,
    steps: plan.steps.map((step) => ({ ...step })),
  }
}

function normalizeDisplayText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function normalizeTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeStepTexts(steps: string[]): string[] {
  const normalized: string[] = []
  for (const step of steps) {
    const text = normalizeDisplayText(step, MAX_PLAN_STEP_TEXT_CHARS)
    if (!text) continue
    normalized.push(text)
    if (normalized.length >= MAX_PLAN_STEPS) break
  }
  return normalized
}

function canMutatePlan(plan: Plan): boolean {
  return plan.status === 'draft' || plan.status === 'active'
}

function normalizePlanStep(value: unknown): PlanStep | null {
  if (!value || typeof value !== 'object') return null
  const step = value as Partial<PlanStep>
  if (typeof step.id !== 'string' || !step.id.trim()) return null
  const text = normalizeDisplayText(step.text, MAX_PLAN_STEP_TEXT_CHARS)
  if (!text) return null
  if (!PLAN_STEP_STATUSES.has(step.status as PlanStepStatus)) return null
  const startedAt = normalizeTimestamp(step.startedAt)
  const completedAt = normalizeTimestamp(step.completedAt)
  const result = normalizeDisplayText(step.result, MAX_PLAN_RESULT_CHARS)
  return {
    id: step.id,
    text,
    status: step.status as PlanStepStatus,
    ...(result ? { result } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
  }
}

function normalizePlan(value: unknown): Plan | null {
  if (!value || typeof value !== 'object') return null
  const plan = value as Partial<Plan>
  if (typeof plan.id !== 'string' || !plan.id.trim()) return null
  const goal = normalizeDisplayText(plan.goal, MAX_PLAN_GOAL_CHARS)
  if (!goal) return null
  if (!PLAN_STATUSES.has(plan.status as PlanStatus)) return null
  const createdAt = normalizeTimestamp(plan.createdAt)
  const updatedAt = normalizeTimestamp(plan.updatedAt)
  if (createdAt === undefined || updatedAt === undefined) return null
  const steps = Array.isArray(plan.steps)
    ? plan.steps.map(normalizePlanStep).filter((step): step is PlanStep => Boolean(step))
      .slice(0, MAX_PLAN_STEPS)
    : []
  return {
    id: plan.id,
    goal,
    status: plan.status as PlanStatus,
    createdAt,
    updatedAt,
    steps,
  }
}

class PlanStoreImpl {
  private plans: Plan[] = []
  private listeners = new Set<PlanListener>()
  private hydrated = false

  hydrate(): void {
    if (this.hydrated) return
    this.plans = readJsonValidated(PLAN_STORE_STORAGE_KEY, [], (parsed) => (
      Array.isArray(parsed) ? parsed.map(normalizePlan).filter((plan): plan is Plan => Boolean(plan)) : null
    ))
    this.hydrated = true
  }

  list(): Plan[] {
    this.hydrate()
    return this.plans.map(clonePlan)
  }

  get(id: string): Plan | undefined {
    this.hydrate()
    const plan = this.plans.find((p) => p.id === id)
    return plan ? clonePlan(plan) : undefined
  }

  active(): Plan | undefined {
    this.hydrate()
    const plan = this.plans.find((p) => p.status === 'active')
    return plan ? clonePlan(plan) : undefined
  }

  create(goal: string, steps: string[] = []): Plan {
    this.hydrate()
    const now = Date.now()
    const normalizedSteps = normalizeStepTexts(steps)
    const plan: Plan = {
      id: createId('plan'),
      goal: normalizeDisplayText(goal, MAX_PLAN_GOAL_CHARS) ?? FALLBACK_PLAN_GOAL,
      status: normalizedSteps.length > 0 ? 'active' : 'draft',
      createdAt: now,
      updatedAt: now,
      steps: normalizedSteps.map((text) => ({
        id: createId('step'),
        text,
        status: 'pending',
      })),
    }
    this.plans.unshift(plan)
    this.persist()
    return clonePlan(plan)
  }

  setSteps(planId: string, steps: string[]): Plan | undefined {
    return this.update(planId, (plan) => {
      if (!canMutatePlan(plan)) return false
      const normalizedSteps = normalizeStepTexts(steps)
      plan.steps = normalizedSteps.map((text) => ({
        id: createId('step'),
        text,
        status: 'pending',
      }))
      plan.status = normalizedSteps.length > 0 ? 'active' : 'draft'
    })
  }

  startStep(planId: string, stepId: string): Plan | undefined {
    return this.update(planId, (plan) => {
      if (plan.status !== 'active') return false
      const step = plan.steps.find((s) => s.id === stepId)
      if (!step || step.status !== 'pending') return false
      step.status = 'in_progress'
      step.startedAt = Date.now()
    })
  }

  markStepDone(planId: string, stepId: string, result?: string): Plan | undefined {
    return this.update(planId, (plan) => {
      if (plan.status !== 'active') return false
      const step = plan.steps.find((s) => s.id === stepId)
      if (!step || (step.status !== 'pending' && step.status !== 'in_progress')) return false
      step.status = 'completed'
      const normalizedResult = normalizeDisplayText(result, MAX_PLAN_RESULT_CHARS)
      if (normalizedResult) step.result = normalizedResult
      else delete step.result
      step.completedAt = Date.now()
      if (plan.steps.every((s) => s.status === 'completed' || s.status === 'skipped')) {
        plan.status = 'completed'
      }
    })
  }

  markStepFailed(planId: string, stepId: string, error: string): Plan | undefined {
    return this.update(planId, (plan) => {
      if (plan.status !== 'active') return false
      const step = plan.steps.find((s) => s.id === stepId)
      if (!step || (step.status !== 'pending' && step.status !== 'in_progress')) return false
      step.status = 'failed'
      step.result = normalizeDisplayText(error, MAX_PLAN_RESULT_CHARS) ?? 'Step failed'
      step.completedAt = Date.now()
    })
  }

  abort(planId: string, reason?: string): Plan | undefined {
    return this.update(planId, (plan) => {
      if (!canMutatePlan(plan)) return false
      plan.status = 'aborted'
      const normalizedReason = normalizeDisplayText(reason, MAX_PLAN_RESULT_CHARS)
      if (normalizedReason) {
        const inProgress = plan.steps.find((s) => s.status === 'in_progress')
        if (inProgress) {
          inProgress.status = 'failed'
          inProgress.result = normalizedReason
          inProgress.completedAt = Date.now()
        }
      }
    })
  }

  remove(planId: string): void {
    this.hydrate()
    const before = this.plans.length
    this.plans = this.plans.filter((p) => p.id !== planId)
    if (this.plans.length !== before) this.persist()
  }

  clear(): void {
    this.plans = []
    this.hydrated = true
    this.persist()
  }

  subscribe(listener: PlanListener): () => void {
    this.hydrate()
    this.listeners.add(listener)
    listener(this.list())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private update(planId: string, mutator: (plan: Plan) => false | void): Plan | undefined {
    this.hydrate()
    const idx = this.plans.findIndex((p) => p.id === planId)
    if (idx < 0) return undefined
    const next: Plan = {
      ...this.plans[idx],
      steps: this.plans[idx].steps.map((s) => ({ ...s })),
    }
    const result = mutator(next)
    if (result === false) return undefined
    next.updatedAt = Date.now()
    this.plans[idx] = next
    this.persist()
    return clonePlan(next)
  }

  private persist(): void {
    writeJsonDebounced(PLAN_STORE_STORAGE_KEY, this.plans)
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

export const planStore = new PlanStoreImpl()
