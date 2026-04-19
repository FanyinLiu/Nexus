import {
  SUBAGENT_DEFAULTS,
  SUBAGENT_MAX_CONCURRENT_HARD_CEILING,
  type SubagentSettings,
  type SubagentTask,
} from '../../types/subagent.ts'
import {
  SUBAGENT_SETTINGS_STORAGE_KEY,
  SUBAGENT_TASKS_STORAGE_KEY,
  readJson,
  writeJsonDebounced,
} from './core.ts'

const MAX_PERSISTED_TASKS = 200

export function loadSubagentSettings(): SubagentSettings {
  const stored = readJson<Partial<SubagentSettings>>(SUBAGENT_SETTINGS_STORAGE_KEY, {})
  return {
    enabled: Boolean(stored.enabled ?? SUBAGENT_DEFAULTS.enabled),
    maxConcurrent: clampConcurrency(stored.maxConcurrent ?? SUBAGENT_DEFAULTS.maxConcurrent),
    perTaskBudgetUsd: Number.isFinite(stored.perTaskBudgetUsd)
      ? Math.max(0, Number(stored.perTaskBudgetUsd))
      : SUBAGENT_DEFAULTS.perTaskBudgetUsd,
    dailyBudgetUsd: Number.isFinite(stored.dailyBudgetUsd)
      ? Math.max(0, Number(stored.dailyBudgetUsd))
      : SUBAGENT_DEFAULTS.dailyBudgetUsd,
  }
}

export function saveSubagentSettings(settings: SubagentSettings): void {
  writeJsonDebounced(SUBAGENT_SETTINGS_STORAGE_KEY, {
    ...settings,
    maxConcurrent: clampConcurrency(settings.maxConcurrent),
  })
}

export function loadSubagentTasks(): SubagentTask[] {
  const raw = readJson<unknown[]>(SUBAGENT_TASKS_STORAGE_KEY, [])
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is SubagentTask => !!item && typeof item === 'object' && 'id' in item)
}

export function saveSubagentTasks(tasks: SubagentTask[]): void {
  const capped = tasks.length > MAX_PERSISTED_TASKS ? tasks.slice(-MAX_PERSISTED_TASKS) : tasks
  writeJsonDebounced(SUBAGENT_TASKS_STORAGE_KEY, capped)
}

function clampConcurrency(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return SUBAGENT_DEFAULTS.maxConcurrent
  return Math.max(1, Math.min(SUBAGENT_MAX_CONCURRENT_HARD_CEILING, Math.floor(num)))
}
