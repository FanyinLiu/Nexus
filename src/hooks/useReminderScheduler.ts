import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import {
  markReminderTaskTriggered,
  refreshReminderTask,
  sortReminderTasks,
} from '../features/reminders'
import type { DebugConsoleEventDraft, ReminderTask } from '../types'

type UseReminderSchedulerOptions = {
  enabled: boolean
  tasks: ReminderTask[]
  setTasks: Dispatch<SetStateAction<ReminderTask[]>>
  onTrigger: (task: ReminderTask) => void | Promise<void>
  onEvent?: (event: DebugConsoleEventDraft) => void
}

function formatSchedulerTime(value?: string) {
  const timestamp = Date.parse(value ?? '')
  if (Number.isNaN(timestamp)) {
    return 'none'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

export function useReminderScheduler({
  enabled,
  tasks,
  setTasks,
  onTrigger,
  onEvent,
}: UseReminderSchedulerOptions) {
  const timerRef = useRef<number | null>(null)
  const onTriggerRef = useRef(onTrigger)
  const onEventRef = useRef(onEvent)
  const scheduledTaskSignatureRef = useRef('')

  useEffect(() => {
    onTriggerRef.current = onTrigger
  }, [onTrigger])

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (!enabled) {
      return
    }

    setTasks((current) => {
      const normalized = sortReminderTasks(current.map((task) => {
        try {
          return refreshReminderTask(task)
        } catch {
          return {
            ...task,
            nextRunAt: undefined,
          }
        }
      }))
      const unchanged = normalized.every((task, index) => (
        task.id === current[index]?.id
        && task.nextRunAt === current[index]?.nextRunAt
        && task.updatedAt === current[index]?.updatedAt
      ))

      if (!unchanged) {
        onEventRef.current?.({
          source: 'scheduler',
          title: 'Reminder schedule refreshed',
          detail: `${normalized.length} total tasks; next run times recomputed`,
          tone: 'info',
        })
      }

      return unchanged ? current : normalized
    })
  }, [enabled, setTasks])

  useEffect(() => {
    if (!enabled) {
      scheduledTaskSignatureRef.current = ''
      return undefined
    }

    const clearTimer = () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const enabledTasks = tasks.filter((task) => task.enabled && task.nextRunAt)
    if (!enabledTasks.length) {
      clearTimer()
      scheduledTaskSignatureRef.current = ''
      return clearTimer
    }

    const nextTask = enabledTasks
      .map((task) => ({
        task,
        timestamp: Date.parse(task.nextRunAt ?? ''),
      }))
      .filter((entry) => Number.isFinite(entry.timestamp))
      .sort((left, right) => left.timestamp - right.timestamp)[0]

    if (!nextTask) {
      clearTimer()
      scheduledTaskSignatureRef.current = ''
      return clearTimer
    }

    const nextSignature = `${nextTask.task.id}:${nextTask.task.nextRunAt ?? ''}`
    if (scheduledTaskSignatureRef.current !== nextSignature) {
      scheduledTaskSignatureRef.current = nextSignature
      onEventRef.current?.({
        source: 'scheduler',
        title: 'Next reminder scheduled',
        detail: `${nextTask.task.title} / ${formatSchedulerTime(nextTask.task.nextRunAt)}`,
        tone: 'info',
        relatedTaskId: nextTask.task.id,
      })
    }

    const delayMs = Math.max(200, nextTask.timestamp - Date.now())
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      const now = new Date()
      const threshold = now.getTime() + 1_000

      // Identify triggered tasks outside updater to avoid StrictMode double-fire
      const triggeredTasks = tasks.filter((task) => {
        const nextRunAt = Date.parse(task.nextRunAt ?? '')
        return task.enabled && Number.isFinite(nextRunAt) && nextRunAt <= threshold
      })

      if (triggeredTasks.length > 0) {
        setTasks((current) => {
          const triggeredIds = new Set(triggeredTasks.map((t) => t.id))
          const updated = current.map((task) =>
            triggeredIds.has(task.id) ? markReminderTaskTriggered(task, now) : task,
          )
          return sortReminderTasks(updated)
        })

        for (const task of triggeredTasks) {
          onEventRef.current?.({
            source: 'scheduler',
            title: 'Reminder trigger time reached',
            detail: `${task.title} / ${formatSchedulerTime(task.nextRunAt)}`,
            tone: 'success',
            relatedTaskId: task.id,
          })
          // Wrap in catch so an onTrigger that throws (sync) or returns
          // a rejected promise doesn't surface as an unhandled rejection
          // and doesn't take down the rest of the tick loop.
          Promise.resolve(onTriggerRef.current(task)).catch((err) => {
            console.warn('[reminder] onTrigger failed:', err)
          })
        }
      }
    }, delayMs)

    return clearTimer
  }, [enabled, setTasks, tasks])
}
