import { useCallback, useEffect, useRef, useState } from 'react'
import {
  findTriggeredTasks,
  markTaskTriggered,
  type ContextSnapshot,
} from '../features/autonomy/contextScheduler'
import {
  AUTONOMY_CONTEXT_TRIGGERS_STORAGE_KEY,
  readJson,
  writeJson,
} from '../lib/storage'
import type {
  AppSettings,
  AutonomousAction,
  ContextTriggeredTask,
  FocusState,
} from '../types'

export type UseContextSchedulerOptions = {
  settingsRef: React.RefObject<AppSettings>
  focusStateRef: React.RefObject<FocusState>
  idleSecondsRef: React.RefObject<number>
  onAction: (action: AutonomousAction, task: ContextTriggeredTask) => void
}

export function useContextScheduler({
  settingsRef,
  focusStateRef,
  idleSecondsRef,
  onAction,
}: UseContextSchedulerOptions) {
  const [tasks, setTasks] = useState<ContextTriggeredTask[]>(
    () => readJson(AUTONOMY_CONTEXT_TRIGGERS_STORAGE_KEY, []),
  )
  const tasksRef = useRef(tasks)
  const onActionRef = useRef(onAction)
  const previousFocusRef = useRef<FocusState>('active')
  const previousWindowRef = useRef<string | null>(null)
  const previousClipboardRef = useRef<string | null>(null)

  useEffect(() => {
    tasksRef.current = tasks
    writeJson(AUTONOMY_CONTEXT_TRIGGERS_STORAGE_KEY, tasks)
  }, [tasks])

  useEffect(() => {
    onActionRef.current = onAction
  }, [onAction])

  /**
   * Call this on each autonomy tick to evaluate context triggers.
   */
  const evaluateTriggers = useCallback(async () => {
    const settings = settingsRef.current
    if (!settings.autonomyEnabled || !settings.autonomyContextTriggersEnabled) return
    if (tasksRef.current.length === 0) return

    // Build snapshot — single call for both active window and clipboard
    let activeWindowTitle: string | null = null
    let clipboardText: string | null = null

    try {
      const needsWindow = settings.activeWindowContextEnabled
      const needsClipboard = settings.clipboardContextEnabled
      if (needsWindow || needsClipboard) {
        const ctx = await window.desktopPet?.getDesktopContext?.({
          includeActiveWindow: needsWindow,
          includeClipboard: needsClipboard,
        })
        // 竞态条件防护：异步操作后验证设置是否变化
        if (settingsRef.current !== settings) {
          return
        }
        activeWindowTitle = ctx?.activeWindowTitle ?? null
        clipboardText = ctx?.clipboardText ?? null
      }
    } catch {
      // Desktop context not available
    }

    const snapshot: ContextSnapshot = {
      focusState: focusStateRef.current,
      previousFocusState: previousFocusRef.current,
      activeWindowTitle,
      previousActiveWindowTitle: previousWindowRef.current,
      clipboardText,
      previousClipboardText: previousClipboardRef.current,
      currentHour: new Date().getHours(),
      idleSeconds: idleSecondsRef.current,
    }

    // Save current values for next comparison
    previousFocusRef.current = focusStateRef.current
    previousWindowRef.current = activeWindowTitle
    previousClipboardRef.current = clipboardText

    const triggered = findTriggeredTasks(tasksRef.current, snapshot)

    if (triggered.length > 0) {
      setTasks((prev) => {
        const next = [...prev]
        for (const task of triggered) {
          const idx = next.findIndex((t) => t.id === task.id)
          if (idx >= 0) {
            next[idx] = markTaskTriggered(next[idx])
          }
          onActionRef.current(task.action, task)
        }
        return next
      })
    }
  }, [settingsRef, focusStateRef, idleSecondsRef])

  const addTask = useCallback((task: ContextTriggeredTask) => {
    setTasks((prev) => [...prev, task])
  }, [])

  const removeTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }, [])

  const toggleTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.map((t) =>
      t.id === taskId ? { ...t, enabled: !t.enabled } : t,
    ))
  }, [])

  return {
    tasks,
    evaluateTriggers,
    addTask,
    removeTask,
    toggleTask,
  }
}
