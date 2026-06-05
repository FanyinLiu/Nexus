import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createId,
  loadReminderTasks,
  onStorageChange,
  REMINDER_TASKS_STORAGE_KEY,
  saveReminderTasks,
} from '../../lib'
import {
  addReminderTaskToCollection,
  removeReminderTaskFromCollection,
  updateReminderTaskInCollection,
  type ReminderTaskDraftInput,
} from '../../features/reminders'
import type { ReminderTask } from '../../types'

export function useReminderTaskStore() {
  const [reminderTasks, setReminderTasks] = useState<ReminderTask[]>(() => loadReminderTasks())
  const reminderTasksRef = useRef(reminderTasks)
  const reminderTasksSaveSkipRef = useRef(true)
  const lastSavedReminderTasksSignatureRef = useRef('')

  const applyRemoteReminderTasks = useCallback((nextTasks: ReminderTask[]) => {
    const signature = JSON.stringify(nextTasks)
    if (signature === JSON.stringify(reminderTasksRef.current)) {
      return
    }
    reminderTasksSaveSkipRef.current = true
    lastSavedReminderTasksSignatureRef.current = signature
    reminderTasksRef.current = nextTasks
    setReminderTasks(nextTasks)
  }, [])

  useEffect(() => {
    reminderTasksRef.current = reminderTasks
  }, [reminderTasks])

  useEffect(() => {
    const signature = JSON.stringify(reminderTasks)
    if (reminderTasksSaveSkipRef.current) {
      reminderTasksSaveSkipRef.current = false
      lastSavedReminderTasksSignatureRef.current = signature
      return
    }
    if (signature === lastSavedReminderTasksSignatureRef.current) {
      return
    }
    lastSavedReminderTasksSignatureRef.current = signature
    saveReminderTasks(reminderTasks)
  }, [reminderTasks])

  useEffect(() => {
    const unsubscribe = onStorageChange(
      REMINDER_TASKS_STORAGE_KEY,
      () => applyRemoteReminderTasks(loadReminderTasks()),
    )
    return unsubscribe
  }, [applyRemoteReminderTasks])

  const addReminderTask = useCallback((input: ReminderTaskDraftInput) => {
    const result = addReminderTaskToCollection(reminderTasksRef.current, createId, input)
    reminderTasksRef.current = result.tasks
    setReminderTasks(result.tasks)
    return result.createdTask
  }, [])

  const updateReminderTask = useCallback((
    id: string,
    updates: Partial<Omit<ReminderTask, 'id' | 'createdAt'>>,
  ) => {
    const result = updateReminderTaskInCollection(reminderTasksRef.current, id, updates)
    reminderTasksRef.current = result.tasks
    setReminderTasks(result.tasks)
    return result.updatedTask
  }, [])

  const removeReminderTask = useCallback((id: string) => {
    const result = removeReminderTaskFromCollection(reminderTasksRef.current, id)
    reminderTasksRef.current = result.tasks
    setReminderTasks(result.tasks)
    return result.removedTask
  }, [])

  return {
    reminderTasks,
    setReminderTasks,
    reminderTasksRef,
    addReminderTask,
    updateReminderTask,
    removeReminderTask,
  }
}
