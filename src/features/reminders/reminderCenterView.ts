import type { ReminderTask } from '../../types'

export type ReminderCenterSummary = {
  totalCount: number
  enabledCount: number
  nextTask: ReminderTask | undefined
}

function getNextRunTime(task: ReminderTask) {
  const timestamp = Date.parse(task.nextRunAt ?? '')
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY
}

export function resolveReminderCenterSummary(tasks: ReminderTask[]): ReminderCenterSummary {
  const enabledTasks = tasks.filter((task) => task.enabled)
  const nextTask = enabledTasks
    .filter((task) => task.nextRunAt)
    .sort((left, right) => getNextRunTime(left) - getNextRunTime(right))[0]

  return {
    totalCount: tasks.length,
    enabledCount: enabledTasks.length,
    nextTask,
  }
}
