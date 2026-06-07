import {
  BACKGROUND_TASKS_STORAGE_KEY,
  createId,
  readJsonValidated,
  writeJsonDebounced,
} from '../../lib/storage/core.ts'

export type BackgroundTaskStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'orphaned'

export type BackgroundTask = {
  id: string
  label: string
  status: BackgroundTaskStatus
  startedAt: number
  endedAt?: number
  traceId?: string
  summary?: string
}

export type BackgroundTaskListener = (tasks: BackgroundTask[]) => void

const BACKGROUND_TASK_STATUSES = new Set<BackgroundTaskStatus>([
  'running',
  'completed',
  'failed',
  'cancelled',
  'orphaned',
])

function cloneTask(task: BackgroundTask): BackgroundTask {
  return { ...task }
}

function normalizeBackgroundTask(value: unknown): BackgroundTask | null {
  if (!value || typeof value !== 'object') return null
  const task = value as Partial<BackgroundTask>
  if (typeof task.id !== 'string' || typeof task.label !== 'string') return null
  if (!BACKGROUND_TASK_STATUSES.has(task.status as BackgroundTaskStatus)) return null
  if (typeof task.startedAt !== 'number' || !Number.isFinite(task.startedAt)) return null
  return {
    id: task.id,
    label: task.label,
    status: task.status as BackgroundTaskStatus,
    startedAt: task.startedAt,
    ...(typeof task.endedAt === 'number' && Number.isFinite(task.endedAt) ? { endedAt: task.endedAt } : {}),
    ...(typeof task.traceId === 'string' ? { traceId: task.traceId } : {}),
    ...(typeof task.summary === 'string' ? { summary: task.summary } : {}),
  }
}

class BackgroundTaskStoreImpl {
  private tasks: BackgroundTask[] = []
  private runtime = new Map<string, AbortController>()
  private listeners = new Set<BackgroundTaskListener>()
  private hydrated = false

  hydrate(): void {
    if (this.hydrated) return
    const stored = readJsonValidated<BackgroundTask[]>(BACKGROUND_TASKS_STORAGE_KEY, [], (parsed) => (
      Array.isArray(parsed)
        ? parsed.map(normalizeBackgroundTask).filter((task): task is BackgroundTask => Boolean(task))
        : null
    ))
    // Any task that was 'running' at last save survived a process exit —
    // surface it as orphaned so the UI can offer cleanup.
    this.tasks = stored.map((task) => (
      task.status === 'running' ? { ...task, status: 'orphaned' } : task
    ))
    this.hydrated = true
  }

  list(): BackgroundTask[] {
    this.hydrate()
    return this.tasks.map(cloneTask)
  }

  get(id: string): BackgroundTask | undefined {
    this.hydrate()
    const task = this.tasks.find((t) => t.id === id)
    return task ? cloneTask(task) : undefined
  }

  start(input: { label: string; traceId?: string }): {
    task: BackgroundTask
    signal: AbortSignal
  } {
    this.hydrate()
    const controller = new AbortController()
    const task: BackgroundTask = {
      id: createId('bgtask'),
      label: input.label,
      status: 'running',
      startedAt: Date.now(),
      traceId: input.traceId,
    }
    this.tasks.unshift(task)
    this.runtime.set(task.id, controller)
    this.persist()
    return { task: cloneTask(task), signal: controller.signal }
  }

  markFinished(id: string, summary?: string): void {
    this.update(id, (task) => {
      if (task.status !== 'running') return
      task.status = 'completed'
      task.endedAt = Date.now()
      task.summary = summary
    })
    this.runtime.delete(id)
  }

  markFailed(id: string, error: string): void {
    this.update(id, (task) => {
      if (task.status !== 'running') return
      task.status = 'failed'
      task.endedAt = Date.now()
      task.summary = error
    })
    this.runtime.delete(id)
  }

  cancel(id: string): void {
    const controller = this.runtime.get(id)
    if (controller) {
      controller.abort()
      this.runtime.delete(id)
    }
    this.update(id, (task) => {
      if (task.status !== 'running') return
      task.status = 'cancelled'
      task.endedAt = Date.now()
    })
  }

  remove(id: string): void {
    this.hydrate()
    const before = this.tasks.length
    this.tasks = this.tasks.filter((t) => t.id !== id)
    this.runtime.delete(id)
    if (this.tasks.length !== before) this.persist()
  }

  clear(): void {
    for (const controller of this.runtime.values()) controller.abort()
    this.runtime.clear()
    this.tasks = []
    this.hydrated = true
    this.persist()
  }

  subscribe(listener: BackgroundTaskListener): () => void {
    this.hydrate()
    this.listeners.add(listener)
    listener(this.list())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private update(id: string, mutator: (task: BackgroundTask) => void): void {
    this.hydrate()
    const idx = this.tasks.findIndex((t) => t.id === id)
    if (idx < 0) return
    const next: BackgroundTask = { ...this.tasks[idx] }
    mutator(next)
    this.tasks[idx] = next
    this.persist()
  }

  private persist(): void {
    writeJsonDebounced(BACKGROUND_TASKS_STORAGE_KEY, this.tasks)
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

export const backgroundTaskStore = new BackgroundTaskStoreImpl()
