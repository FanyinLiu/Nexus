import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import {
  markReminderTaskTriggered,
  reconcileTriggeredTaskWithPersisted,
  refreshReminderTaskForHandoff,
  reminderAlreadyTriggered,
  sortReminderTasks,
} from '../features/reminders'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'
import { loadReminderTasks, saveReminderTasks } from '../lib/storage/reminders.ts'
import type { DebugConsoleEventDraft, ReminderTask } from '../types'

type UseReminderSchedulerOptions = {
  enabled: boolean
  tasks: ReminderTask[]
  setTasks: Dispatch<SetStateAction<ReminderTask[]>>
  locale: string
  onTrigger: (task: ReminderTask) => void | Promise<void>
  onEvent?: (event: DebugConsoleEventDraft) => void
  /**
   * When false the due task stays pending: it is neither marked triggered nor
   * delivered, and the timer retries shortly. Typing quiet uses this so a
   * reminder waits for the user to pause instead of being lost.
   */
  canTrigger?: () => boolean
}

const HOLD_RETRY_MS = 5_000

function formatSchedulerTime(value: string | undefined, locale: string) {
  const timestamp = Date.parse(value ?? '')
  if (Number.isNaN(timestamp)) {
    return 'none'
  }

  return new Intl.DateTimeFormat(locale, {
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
  locale,
  onTrigger,
  onEvent,
  canTrigger,
}: UseReminderSchedulerOptions) {
  const timerRef = useRef<number | null>(null)
  const onTriggerRef = useRef(onTrigger)
  const onEventRef = useRef(onEvent)
  const canTriggerRef = useRef(canTrigger)
  const scheduledTaskSignatureRef = useRef('')

  useEffect(() => {
    onTriggerRef.current = onTrigger
  }, [onTrigger])

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    canTriggerRef.current = canTrigger
  }, [canTrigger])

  useEffect(() => {
    if (!enabled) {
      return
    }

    setTasks((current) => {
      const normalized = sortReminderTasks(current.map((task) => {
        try {
          return refreshReminderTaskForHandoff(task)
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
        detail: `${nextTask.task.title} / ${formatSchedulerTime(nextTask.task.nextRunAt, locale)}`,
        tone: 'info',
        relatedTaskId: nextTask.task.id,
      })
    }

    const delayMs = Math.max(200, nextTask.timestamp - Date.now())
    const fireWhenAllowed = () => {
      if (canTriggerRef.current && !canTriggerRef.current()) {
        // The task stays pending and is not marked triggered. The next retry
        // re-reads the hold ref, so quiet ending mid-wait is picked up.
        timerRef.current = window.setTimeout(fireWhenAllowed, HOLD_RETRY_MS)
        return
      }
      timerRef.current = null
      const now = new Date()
      const threshold = now.getTime() + 1_000

      // Identify triggered tasks outside updater to avoid StrictMode double-fire.
      // Reconcile against persisted rows first: a paused/restored window can
      // hold a stale copy of a task another window already delivered.
      const persistedById = new Map(loadReminderTasks().map((stored) => [stored.id, stored]))
      const dueTasks = tasks.filter((task) => {
        const nextRunAt = Date.parse(task.nextRunAt ?? '')
        return task.enabled && Number.isFinite(nextRunAt) && nextRunAt <= threshold
      })
      const staleTasks = dueTasks.filter((task) => reminderAlreadyTriggered(task, persistedById.get(task.id)))
      const triggeredTasks = dueTasks.filter((task) => !reminderAlreadyTriggered(task, persistedById.get(task.id)))

      if (staleTasks.length > 0) {
        // A paused/restored window may hold the old due row. Drain it into the
        // live copy from persisted state; the task-list effect then arms the
        // next valid row instead of stalling on the stale earliest timestamp.
        const staleIds = new Set(staleTasks.map((task) => task.id))
        setTasks((current) => sortReminderTasks(current.map((task) => (
          staleIds.has(task.id)
            ? reconcileTriggeredTaskWithPersisted(task, persistedById.get(task.id))
            : task
        ))))
      }

      if (triggeredTasks.length > 0) {
        const triggeredIds = new Set(triggeredTasks.map((task) => task.id))
        const triggeredNow = triggeredTasks.map((task) => markReminderTaskTriggered(task, now))
        // Persist the trigger record synchronously before delivering. Both
        // windows read storage at trigger time; waiting for the save effect
        // would let the pet and panel deliver the same due instant.
        const nextPersisted = new Map(persistedById)
        for (const task of triggeredNow) nextPersisted.set(task.id, task)
        saveReminderTasks(sortReminderTasks([...nextPersisted.values()]))

        setTasks((current) => {
          const updated = current.map((task) =>
            triggeredIds.has(task.id) ? markReminderTaskTriggered(task, now) : task,
          )
          return sortReminderTasks(updated)
        })

        for (const task of triggeredTasks) {
          onEventRef.current?.({
            source: 'scheduler',
            title: 'Reminder trigger time reached',
            detail: `${task.title} / ${formatSchedulerTime(task.nextRunAt, locale)}`,
            tone: 'success',
            relatedTaskId: task.id,
          })
          // Wrap in catch so an onTrigger that throws (sync) or returns
          // a rejected promise doesn't surface as an unhandled rejection
          // and doesn't take down the rest of the tick loop.
          Promise.resolve(onTriggerRef.current(task)).catch((err) => {
            console.warn('[reminder] onTrigger failed:', getRedactedLogErrorMessage(err))
          })
        }
      }
    }
    timerRef.current = window.setTimeout(fireWhenAllowed, delayMs)

    return clearTimer
  }, [enabled, locale, setTasks, tasks])
}
