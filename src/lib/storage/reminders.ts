import type { ReminderTask, ReminderTaskAction, ReminderTaskSchedule } from '../../types'
import { readJson, REMINDER_TASKS_STORAGE_KEY, writeJson } from './core.ts'

const defaultReminderTasks: ReminderTask[] = []
const DEFAULT_CREATED_AT = '1970-01-01T00:00:00.000Z'

function normalizeReminderTaskAction(action: ReminderTaskAction | null | undefined): ReminderTaskAction {
  if (!action || action.kind === 'notice') {
    return { kind: 'notice' }
  }

  if (action.kind === 'weather') {
    return {
      kind: 'weather',
      location: String(action.location ?? '').trim(),
    }
  }

  if (action.kind === 'chat_action') {
    const instruction = String(action.instruction ?? '').trim()
    if (!instruction) {
      return { kind: 'notice' }
    }
    return {
      kind: 'chat_action',
      instruction,
    }
  }

  const query = String(action.query ?? '').trim()
  if (!query) {
    return { kind: 'notice' }
  }
  return {
    kind: 'web_search',
    query,
    limit: Math.max(1, Math.min(Number(action.limit) || 5, 8)),
  }
}

function normalizeIsoString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const timestamp = Date.parse(trimmed)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
}

function clampEveryMinutes(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 1
  return Math.min(24 * 60, Math.max(1, Math.round(numeric)))
}

function normalizeReminderTaskSchedule(
  value: unknown,
  fallbackAnchorAt: string,
): ReminderTaskSchedule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const obj = value as Record<string, unknown>
  if (obj.kind === 'at') {
    const at = normalizeIsoString(obj.at)
    return at ? { kind: 'at', at } : null
  }

  if (obj.kind === 'every') {
    return {
      kind: 'every',
      everyMinutes: clampEveryMinutes(obj.everyMinutes),
      anchorAt: normalizeIsoString(obj.anchorAt) ?? fallbackAnchorAt,
    }
  }

  if (obj.kind === 'cron') {
    const expression = typeof obj.expression === 'string' ? obj.expression.trim() : ''
    const parts = expression.split(/\s+/u).filter(Boolean)
    return parts.length === 5 ? { kind: 'cron', expression: parts.join(' ') } : null
  }

  return null
}

function normalizeReminderTaskRecord(value: unknown): ReminderTask | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const obj = value as Record<string, unknown>
  const id = String(obj.id ?? '').trim()
  const title = String(obj.title ?? '').trim()
  const prompt = String(obj.prompt ?? '').trim()
  if (!id || !title || !prompt) {
    return null
  }

  const createdAt = normalizeIsoString(obj.createdAt)
    ?? normalizeIsoString(obj.updatedAt)
    ?? DEFAULT_CREATED_AT
  const updatedAt = normalizeIsoString(obj.updatedAt) ?? createdAt
  const schedule = normalizeReminderTaskSchedule(obj.schedule, createdAt)
  if (!schedule) {
    return null
  }

  const task: ReminderTask = {
    id,
    title,
    prompt,
    action: normalizeReminderTaskAction(obj.action as ReminderTaskAction | null | undefined),
    enabled: obj.enabled !== false,
    createdAt,
    updatedAt,
    schedule,
  }
  const speechText = String(obj.speechText ?? '').trim()
  const lastTriggeredAt = normalizeIsoString(obj.lastTriggeredAt)
  const nextRunAt = normalizeIsoString(obj.nextRunAt)
  if (speechText) task.speechText = speechText
  if (lastTriggeredAt) task.lastTriggeredAt = lastTriggeredAt
  if (nextRunAt) task.nextRunAt = nextRunAt
  return task
}

function normalizeReminderTasks(value: unknown): ReminderTask[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(normalizeReminderTaskRecord)
    .filter((task): task is ReminderTask => Boolean(task))
}

export function loadReminderTasks(): ReminderTask[] {
  const raw = readJson<unknown>(REMINDER_TASKS_STORAGE_KEY, defaultReminderTasks)
  const tasks = normalizeReminderTasks(raw)
  if (!Array.isArray(raw) || JSON.stringify(raw) !== JSON.stringify(tasks)) {
    writeJson(REMINDER_TASKS_STORAGE_KEY, tasks)
  }
  return tasks
}

export function saveReminderTasks(tasks: ReminderTask[]) {
  writeJson(REMINDER_TASKS_STORAGE_KEY, normalizeReminderTasks(tasks))
}
