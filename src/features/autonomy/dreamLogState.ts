import type { MemoryDreamLog, MemoryDreamResult } from '../../types'

export const DREAM_LOG_MUTATION_LOCK_NAME = 'nexus:autonomy:dream-log:mutation'

export type DreamLogLock = <T>(work: () => Promise<T> | T) => Promise<T>
export type DreamLogMutation = (latest: MemoryDreamLog) => MemoryDreamLog

function isMemoryDreamResult(value: unknown): value is MemoryDreamResult {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.mergedTopics === 'number'
    && Number.isFinite(record.mergedTopics)
    && typeof record.prunedEntries === 'number'
    && Number.isFinite(record.prunedEntries)
    && typeof record.newEntries === 'number'
    && Number.isFinite(record.newEntries)
    && typeof record.startedAt === 'string'
    && typeof record.completedAt === 'string'
}

export function parseDreamLogSnapshot(value: unknown): MemoryDreamLog | null {
  if (typeof value !== 'object' || value === null) return null

  const record = value as Record<string, unknown>
  const lastDreamAt = record.lastDreamAt
  const sessionsSinceDream = record.sessionsSinceDream
  if (!(lastDreamAt === null || typeof lastDreamAt === 'string')) return null
  if (typeof sessionsSinceDream !== 'number' || !Number.isFinite(sessionsSinceDream)) return null
  if (!Array.isArray(record.history)) return null

  return {
    lastDreamAt,
    sessionsSinceDream: Math.max(0, Math.floor(sessionsSinceDream)),
    history: record.history.filter(isMemoryDreamResult).slice(-10),
  }
}

type NavigatorWithLocks = Navigator & {
  locks?: {
    request<T>(name: string, callback: () => Promise<T> | T): Promise<T>
  }
}

let fallbackQueue: Promise<void> = Promise.resolve()

function withFallbackDreamLogLock<T>(work: () => Promise<T> | T): Promise<T> {
  const previous = fallbackQueue
  let release!: () => void
  fallbackQueue = new Promise<void>((resolve) => {
    release = resolve
  })

  return previous.then(work).finally(release)
}

export const withDreamLogMutationLock: DreamLogLock = <T>(work: () => Promise<T> | T) => {
  const lockManager = typeof navigator !== 'undefined'
    ? (navigator as NavigatorWithLocks).locks
    : undefined

  if (lockManager?.request) {
    return lockManager.request<T>(DREAM_LOG_MUTATION_LOCK_NAME, async () => work())
  }

  return withFallbackDreamLogLock(work)
}

export function readDreamLogAtomically(
  readLatest: () => MemoryDreamLog,
  apply: (next: MemoryDreamLog) => void,
  lock: DreamLogLock = withDreamLogMutationLock,
): Promise<MemoryDreamLog> {
  return lock(() => {
    const latest = readLatest()
    apply(latest)
    return latest
  })
}

export function mutateDreamLogAtomically(
  readLatest: () => MemoryDreamLog,
  mutate: DreamLogMutation,
  write: (next: MemoryDreamLog) => void,
  apply: (next: MemoryDreamLog) => void,
  lock: DreamLogLock = withDreamLogMutationLock,
): Promise<MemoryDreamLog> {
  return lock(() => {
    const latest = readLatest()
    const next = mutate(latest)
    write(next)
    apply(next)
    return next
  })
}
