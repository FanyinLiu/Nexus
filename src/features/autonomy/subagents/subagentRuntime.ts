import {
  SUBAGENT_MAX_CONCURRENT_HARD_CEILING,
  type SubagentSettings,
  type SubagentStatus,
  type SubagentTask,
} from '../../../types/subagent.ts'

/**
 * In-memory state machine for the companion's subagent dispatcher.
 *
 * The runtime is deliberately framework-agnostic and pure — it does
 * not call LLMs, touch window, or read localStorage. Hosting code is
 * responsible for:
 *
 *  1. Calling `admitTask()` when the LLM invokes the `spawn_subagent`
 *     tool. The runtime returns either `{ ok: true, task }` with the
 *     new task record, or `{ ok: false, reason }` explaining which
 *     gate rejected it (capacity, disabled, over-budget).
 *  2. Calling `startTask(id)` right before firing the LLM loop.
 *  3. Calling `recordUsage(id, prompt, completion, cost)` after each
 *     LLM step so the per-task and daily budgets stay accurate.
 *  4. Calling `completeTask(id, summary)` or `failTask(id, reason)`
 *     when the loop finishes.
 *
 * All operations return a fresh copy of the task list when mutations
 * happen, so React consumers can trivially diff against prior state.
 */

export type AdmitResult =
  | { ok: true; task: SubagentTask }
  | { ok: false; reason: AdmitRejection }

export type AdmitRejection =
  | 'disabled'
  | 'at_capacity'
  | 'daily_budget_exceeded'

export interface SubagentRuntime {
  snapshot(): SubagentTask[]
  activeCount(): number
  totalSpentUsd(): number
  admitTask(input: { parentTurnId: string; task: string; purpose: string }): AdmitResult
  startTask(id: string): SubagentTask | null
  recordUsage(id: string, promptTokens: number, completionTokens: number, costUsd: number): SubagentTask | null
  completeTask(id: string, summary: string): SubagentTask | null
  failTask(id: string, reason: string, status?: Extract<SubagentStatus, 'failed' | 'cancelled'>): SubagentTask | null
  isOverPerTaskBudget(id: string): boolean
  updateSettings(settings: SubagentSettings): void
}

export interface CreateRuntimeOptions {
  settings: SubagentSettings
  initialTasks?: SubagentTask[]
  now?: () => Date
  idGenerator?: () => string
  onChange?: (tasks: SubagentTask[]) => void
}

export function createSubagentRuntime(options: CreateRuntimeOptions): SubagentRuntime {
  let settings = clampSettings(options.settings)
  const tasks: SubagentTask[] = options.initialTasks ? [...options.initialTasks] : []
  const now = options.now ?? (() => new Date())
  const idGen = options.idGenerator ?? defaultIdGenerator
  const onChange = options.onChange ?? (() => undefined)

  const emit = () => {
    onChange(tasks.slice())
  }

  const getTask = (id: string): SubagentTask | undefined => tasks.find((t) => t.id === id)

  const mutate = (id: string, update: (task: SubagentTask) => void): SubagentTask | null => {
    const task = getTask(id)
    if (!task) return null
    update(task)
    emit()
    return { ...task }
  }

  const countActive = (): number => tasks.filter(
    (t) => t.status === 'queued' || t.status === 'running',
  ).length

  const sumSpentToday = (): number => {
    const today = startOfDay(now())
    return tasks
      .filter((t) => new Date(t.createdAt) >= today)
      .reduce((acc, t) => acc + t.usage.costUsd, 0)
  }

  return {
    snapshot() {
      return tasks.slice()
    },
    activeCount: countActive,
    totalSpentUsd: sumSpentToday,

    admitTask(input) {
      if (!settings.enabled) return { ok: false, reason: 'disabled' }
      if (countActive() >= settings.maxConcurrent) return { ok: false, reason: 'at_capacity' }
      if (settings.dailyBudgetUsd > 0 && sumSpentToday() >= settings.dailyBudgetUsd) {
        return { ok: false, reason: 'daily_budget_exceeded' }
      }

      const task: SubagentTask = {
        id: idGen(),
        parentTurnId: input.parentTurnId,
        task: input.task,
        purpose: input.purpose,
        status: 'queued',
        createdAt: now().toISOString(),
        usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 },
      }
      tasks.push(task)
      emit()
      return { ok: true, task: { ...task } }
    },

    startTask(id) {
      return mutate(id, (task) => {
        if (task.status !== 'queued') return
        task.status = 'running'
        task.startedAt = now().toISOString()
      })
    },

    recordUsage(id, promptTokens, completionTokens, costUsd) {
      return mutate(id, (task) => {
        task.usage.promptTokens += Math.max(0, promptTokens)
        task.usage.completionTokens += Math.max(0, completionTokens)
        task.usage.costUsd += Math.max(0, costUsd)
      })
    },

    completeTask(id, summary) {
      return mutate(id, (task) => {
        task.status = 'completed'
        task.finishedAt = now().toISOString()
        task.resultSummary = summary
      })
    },

    failTask(id, reason, status = 'failed') {
      return mutate(id, (task) => {
        task.status = status
        task.finishedAt = now().toISOString()
        task.failureReason = reason
      })
    },

    isOverPerTaskBudget(id) {
      if (settings.perTaskBudgetUsd <= 0) return false
      const task = getTask(id)
      if (!task) return false
      return task.usage.costUsd >= settings.perTaskBudgetUsd
    },

    updateSettings(next) {
      settings = clampSettings(next)
    },
  }
}

function clampSettings(settings: SubagentSettings): SubagentSettings {
  return {
    enabled: Boolean(settings.enabled),
    maxConcurrent: Math.max(
      1,
      Math.min(SUBAGENT_MAX_CONCURRENT_HARD_CEILING, Math.floor(settings.maxConcurrent)),
    ),
    perTaskBudgetUsd: Number.isFinite(settings.perTaskBudgetUsd)
      ? Math.max(0, settings.perTaskBudgetUsd)
      : 0,
    dailyBudgetUsd: Number.isFinite(settings.dailyBudgetUsd)
      ? Math.max(0, settings.dailyBudgetUsd)
      : 0,
    modelOverride: typeof settings.modelOverride === 'string' ? settings.modelOverride : '',
  }
}

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function defaultIdGenerator(): string {
  return `subagent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
