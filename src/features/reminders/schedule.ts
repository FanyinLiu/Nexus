import { resolveLocalizedText } from '../../lib/uiLanguage.ts'
import type { ReminderTask, ReminderTaskAction, ReminderTaskSchedule, UiLanguage } from '../../types'

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS
const CRON_SEARCH_LIMIT_MINUTES = 366 * 24 * 60

export type ReminderTaskDraftInput = {
  title: string
  prompt: string
  speechText?: string
  action?: ReminderTaskAction
  enabled?: boolean
  schedule: ReminderTaskSchedule
}

export type ReminderTaskUpdateInput = Partial<Omit<ReminderTask, 'id' | 'createdAt'>>

function startOfNextMinute(date: Date) {
  const next = new Date(date)
  next.setSeconds(0, 0)
  next.setMinutes(next.getMinutes() + 1)
  return next
}

function clampEveryMinutes(value: number) {
  return Math.min(24 * 60, Math.max(1, Math.round(value)))
}

function resolveReminderScheduleLocale(uiLanguage: UiLanguage) {
  switch (uiLanguage) {
    case 'en-US':
      return 'en-US'
    case 'zh-TW':
      return 'zh-TW'
    case 'ja':
      return 'ja-JP'
    case 'ko':
      return 'ko-KR'
    case 'zh-CN':
    default:
      return 'zh-CN'
  }
}

function pickReminderScheduleText(
  uiLanguage: UiLanguage,
  zhCN: string,
  enUS: string,
  zhTW = zhCN,
) {
  return resolveLocalizedText(uiLanguage, {
    'zh-CN': zhCN,
    'en-US': enUS,
    'zh-TW': zhTW,
  })
}

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
    return {
      kind: 'chat_action',
      instruction: String(action.instruction ?? '').trim(),
    }
  }

  return {
    kind: 'web_search',
    query: String(action.query ?? '').trim(),
    limit: Math.max(1, Math.min(Number(action.limit) || 5, 8)),
  }
}

function parseCronField(field: string, min: number, max: number) {
  const normalized = String(field ?? '').trim()
  if (!normalized) {
    throw new Error('cron 字段不能为空。')
  }

  const allowed = new Set<number>()

  const addRange = (start: number, end: number, step = 1) => {
    const safeStep = Math.max(1, step)
    for (let value = start; value <= end; value += safeStep) {
      if (value >= min && value <= max) {
        allowed.add(value)
      }
    }
  }

  for (const part of normalized.split(',')) {
    const token = part.trim()
    if (!token) continue

    if (token === '*') {
      addRange(min, max)
      continue
    }

    const stepMatch = token.match(/^\*\/(\d{1,3})$/u)
    if (stepMatch) {
      addRange(min, max, Number(stepMatch[1]))
      continue
    }

    const rangeStepMatch = token.match(/^(\d{1,2})-(\d{1,2})\/(\d{1,3})$/u)
    if (rangeStepMatch) {
      addRange(Number(rangeStepMatch[1]), Number(rangeStepMatch[2]), Number(rangeStepMatch[3]))
      continue
    }

    const rangeMatch = token.match(/^(\d{1,2})-(\d{1,2})$/u)
    if (rangeMatch) {
      addRange(Number(rangeMatch[1]), Number(rangeMatch[2]))
      continue
    }

    const singleValue = Number(token)
    if (!Number.isInteger(singleValue) || singleValue < min || singleValue > max) {
      throw new Error(`cron 字段超出范围：${token}`)
    }
    allowed.add(singleValue)
  }

  if (!allowed.size) {
    throw new Error('cron 字段没有可用取值。')
  }

  return allowed
}

function normalizeCronWeekday(day: number) {
  return day === 7 ? 0 : day
}

function parseCronExpression(expression: string) {
  const parts = String(expression ?? '').trim().split(/\s+/u)
  if (parts.length !== 5) {
    throw new Error('cron 表达式需要 5 段：分 时 日 月 周。')
  }

  return {
    minute: parseCronField(parts[0], 0, 59),
    hour: parseCronField(parts[1], 0, 23),
    dayOfMonth: parseCronField(parts[2], 1, 31),
    month: parseCronField(parts[3], 1, 12),
    dayOfWeek: new Set([...parseCronField(parts[4], 0, 7)].map(normalizeCronWeekday)),
  }
}

function matchesCronDate(date: Date, expression: ReturnType<typeof parseCronExpression>) {
  return (
    expression.minute.has(date.getMinutes())
    && expression.hour.has(date.getHours())
    && expression.dayOfMonth.has(date.getDate())
    && expression.month.has(date.getMonth() + 1)
    && expression.dayOfWeek.has(date.getDay())
  )
}

function computeNextCronRun(expression: string, from = new Date()) {
  const parsed = parseCronExpression(expression)
  const cursor = startOfNextMinute(from)

  for (let index = 0; index < CRON_SEARCH_LIMIT_MINUTES; index += 1) {
    if (matchesCronDate(cursor, parsed)) {
      return cursor.toISOString()
    }

    cursor.setMinutes(cursor.getMinutes() + 1)
  }

  throw new Error('cron 表达式在未来一年内没有可命中的时间。')
}

function computeNextEveryRun(
  schedule: Extract<ReminderTaskSchedule, { kind: 'every' }>,
  from = new Date(),
) {
  const everyMinutes = clampEveryMinutes(schedule.everyMinutes)
  const intervalMs = everyMinutes * MINUTE_MS
  const anchorAt = Date.parse(schedule.anchorAt ?? from.toISOString())
  const anchorTime = Number.isNaN(anchorAt) ? from.getTime() : anchorAt
  const elapsed = Math.max(0, from.getTime() - anchorTime)
  const nextOffset = Math.floor(elapsed / intervalMs) + 1
  return new Date(anchorTime + nextOffset * intervalMs).toISOString()
}

function computeNextAtRun(
  schedule: Extract<ReminderTaskSchedule, { kind: 'at' }>,
  from = new Date(),
) {
  const targetAt = Date.parse(schedule.at)
  if (Number.isNaN(targetAt)) {
    throw new Error('提醒时间格式无效。')
  }

  if (targetAt <= from.getTime()) {
    return ''
  }

  return new Date(targetAt).toISOString()
}

export function computeNextReminderRun(schedule: ReminderTaskSchedule, from = new Date()) {
  if (schedule.kind === 'at') {
    return computeNextAtRun(schedule, from)
  }

  if (schedule.kind === 'every') {
    return computeNextEveryRun(schedule, from)
  }

  return computeNextCronRun(schedule.expression, from)
}

export function refreshReminderTask(task: ReminderTask, from = new Date()) {
  const nextRunAt = task.enabled ? computeNextReminderRun(task.schedule, from) : ''

  return {
    ...task,
    nextRunAt: nextRunAt || undefined,
  }
}

export function createReminderTask(
  createId: (prefix: string) => string,
  input: ReminderTaskDraftInput,
  now = new Date(),
): ReminderTask {
  const createdAt = now.toISOString()
  const nextTask: ReminderTask = {
    id: createId('reminder'),
    title: input.title.trim(),
    prompt: input.prompt.trim(),
    speechText: input.speechText?.trim() || undefined,
    action: normalizeReminderTaskAction(input.action),
    enabled: input.enabled !== false,
    createdAt,
    updatedAt: createdAt,
    schedule: input.schedule.kind === 'every'
      ? {
          ...input.schedule,
          everyMinutes: clampEveryMinutes(input.schedule.everyMinutes),
          anchorAt: input.schedule.anchorAt || createdAt,
        }
      : input.schedule,
  }

  return refreshReminderTask(nextTask, now)
}

export function addReminderTaskToCollection(
  tasks: ReminderTask[],
  createId: (prefix: string) => string,
  input: ReminderTaskDraftInput,
  now = new Date(),
) {
  const createdTask = createReminderTask(createId, input, now)
  return {
    createdTask,
    tasks: sortReminderTasks([
      createdTask,
      ...tasks,
    ]),
  }
}

export function updateReminderTask(
  task: ReminderTask,
  updates: ReminderTaskUpdateInput,
  now = new Date(),
) {
  const nextTask: ReminderTask = {
    ...task,
    ...updates,
    speechText: updates.speechText?.trim() || undefined,
    action: normalizeReminderTaskAction(updates.action ?? task.action),
    updatedAt: now.toISOString(),
  }

  if (nextTask.schedule.kind === 'every') {
    const fallbackAnchorAt = task.schedule.kind === 'every'
      ? task.schedule.anchorAt
      : task.createdAt
    nextTask.schedule = {
      ...nextTask.schedule,
      everyMinutes: clampEveryMinutes(nextTask.schedule.everyMinutes),
      anchorAt: nextTask.schedule.anchorAt || fallbackAnchorAt,
    }
  }

  try {
    return refreshReminderTask(nextTask, now)
  } catch {
    return {
      ...nextTask,
      nextRunAt: undefined,
    }
  }
}

export function updateReminderTaskInCollection(
  tasks: ReminderTask[],
  id: string,
  updates: ReminderTaskUpdateInput,
  now = new Date(),
) {
  let updatedTask: ReminderTask | null = null
  const nextTasks = sortReminderTasks(tasks.map((task) => {
    if (task.id !== id) {
      return task
    }

    updatedTask = updateReminderTask(task, updates, now)
    return updatedTask
  }))

  return {
    updatedTask,
    tasks: nextTasks,
  }
}

export function removeReminderTaskFromCollection(tasks: ReminderTask[], id: string) {
  let removedTask: ReminderTask | null = null
  const nextTasks = tasks.filter((task) => {
    if (task.id === id) {
      removedTask = task
      return false
    }

    return true
  })

  return {
    removedTask,
    tasks: nextTasks,
  }
}

export function markReminderTaskTriggered(task: ReminderTask, triggeredAt = new Date()) {
  return refreshReminderTask(
    {
      ...task,
      lastTriggeredAt: triggeredAt.toISOString(),
      updatedAt: triggeredAt.toISOString(),
    },
    triggeredAt,
  )
}

export function sortReminderTasks(tasks: ReminderTask[]) {
  return [...tasks].sort((left, right) => {
    const leftNext = Date.parse(left.nextRunAt ?? '') || Date.now() + DAY_MS * 400
    const rightNext = Date.parse(right.nextRunAt ?? '') || Date.now() + DAY_MS * 400

    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1
    }

    if (leftNext !== rightNext) {
      return leftNext - rightNext
    }

    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  })
}

export function formatReminderScheduleSummary(task: ReminderTask) {
  if (task.schedule.kind === 'at') {
    const at = Date.parse(task.schedule.at)
    if (Number.isNaN(at)) {
      return '一次性提醒'
    }

    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(at))
  }

  if (task.schedule.kind === 'every') {
    return `每 ${clampEveryMinutes(task.schedule.everyMinutes)} 分钟`
  }

  return `Cron: ${task.schedule.expression}`
}

export function formatReminderScheduleSummaryForUi(task: ReminderTask, uiLanguage: UiLanguage = 'zh-CN') {
  if (task.schedule.kind === 'at') {
    const at = Date.parse(task.schedule.at)
    if (Number.isNaN(at)) {
      return pickReminderScheduleText(uiLanguage, '一次性提醒', 'One-time reminder', '單次提醒')
    }

    return new Intl.DateTimeFormat(resolveReminderScheduleLocale(uiLanguage), {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(at))
  }

  if (task.schedule.kind === 'every') {
    const minutes = clampEveryMinutes(task.schedule.everyMinutes)
    return pickReminderScheduleText(uiLanguage, `每 ${minutes} 分钟`, `Every ${minutes} min`, `每 ${minutes} 分鐘`)
  }

  return `Cron: ${task.schedule.expression}`
}
