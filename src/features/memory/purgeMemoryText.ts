/**
 * Remove a memory's wording from every copy this feature persists.
 *
 * Run snapshots, op-log "before" rows, and evidence quotes are the copies
 * that survive a normal delete. Clear-all empties those stores. The op-log
 * row can stay, with the wording replaced by a fixed note.
 */

import type { MemoryItem } from '../../types/memory.ts'

/** Wording stored in place of a deleted quote. It is not the deleted text. */
export const REDACTED_MEMORY_NOTE = '已删除一条记忆'

export const MEMORY_DATA_FILES = {
  longTerm: 'long-term.json',
  daily: 'daily.json',
  opLog: 'op-log.json',
  snapshots: 'run-snapshots.json',
  v1Backup: 'v1-backup.txt',
  archive: 'archive.json',
  narrative: 'narrative.json',
  agenda: 'agenda.json',
  reminders: 'reminders.json',
  chat: 'chat.json',
  chatSessions: 'chat-sessions.json',
  callbacks: 'callbacks.json',
} as const

const TEXT_FIELDS = new Set([
  'content',
  'quote',
  'evidenceQuote',
  'summary',
  'title',
  'prompt',
  'speechText',
  'place',
  'loopPlace',
  'dueText',
  'loopDueText',
  'instruction',
  'query',
  'location',
  'text',
])

export interface MemoryPurgeRequest {
  ids: readonly string[]
  needles: readonly string[]
  reminderIds?: readonly string[]
  clearAll?: boolean
  at: string
}

/** Phrases a row can leak: the line itself, the place, the time, and quotes. */
export function memoryPlaintextNeedles(memory: Pick<MemoryItem, 'content' | 'loopPlace' | 'loopDueText' | 'evidence'>): string[] {
  const values = [
    memory.content,
    memory.loopPlace,
    memory.loopDueText,
    ...(memory.evidence ?? []).map((item) => item.quote),
  ]
  return uniqueNeedles(values)
}

/**
 * Rewrite a memory-data directory's files so none of them still contain
 * the deleted wording. Unknown files are included. The map is the whole
 * directory: every key is a file name and every value is its text.
 */
export function scrubMemoryDataFiles(
  files: Readonly<Record<string, string>>,
  request: MemoryPurgeRequest,
): Record<string, string> {
  const ids = new Set(request.ids)
  const reminderIds = new Set(request.reminderIds ?? [])
  const needles = uniqueNeedles([
    ...request.needles,
    ...(request.clearAll ? collectClearNeedles(files) : []),
  ])
  const next: Record<string, string> = {}
  const write = (name: string, value: unknown) => {
    if (files[name] === undefined && name !== MEMORY_DATA_FILES.opLog) return
    next[name] = writeJson(value)
  }

  write(MEMORY_DATA_FILES.longTerm, scrubMemoryRows(readArray(files[MEMORY_DATA_FILES.longTerm]), ids, needles, request.clearAll))
  write(MEMORY_DATA_FILES.daily, scrubDaily(readRecord(files[MEMORY_DATA_FILES.daily]), needles, request.clearAll))
  write(MEMORY_DATA_FILES.snapshots, scrubSnapshots(readArray(files[MEMORY_DATA_FILES.snapshots]), ids, needles, request.clearAll))
  write(MEMORY_DATA_FILES.archive, scrubRows(readArray(files[MEMORY_DATA_FILES.archive]), ids, needles, request.clearAll))
  write(MEMORY_DATA_FILES.narrative, scrubNarrative(readRecord(files[MEMORY_DATA_FILES.narrative]), ids, needles, request.clearAll))
  write(MEMORY_DATA_FILES.agenda, scrubAgenda(readRecord(files[MEMORY_DATA_FILES.agenda]), ids, needles, request.clearAll))
  write(MEMORY_DATA_FILES.reminders, scrubReminders(readArray(files[MEMORY_DATA_FILES.reminders]), reminderIds, needles, request.clearAll))
  write(MEMORY_DATA_FILES.chat, scrubChatList(readArray(files[MEMORY_DATA_FILES.chat]), needles))
  write(MEMORY_DATA_FILES.chatSessions, scrubSessions(readArray(files[MEMORY_DATA_FILES.chatSessions]), needles))
  write(MEMORY_DATA_FILES.callbacks, scrubCallbacks(readArray(files[MEMORY_DATA_FILES.callbacks]), ids, request.clearAll))
  write(MEMORY_DATA_FILES.opLog, scrubOpLog(readArray(files[MEMORY_DATA_FILES.opLog]), ids, needles, request))
  if (files[MEMORY_DATA_FILES.v1Backup] !== undefined) {
    next[MEMORY_DATA_FILES.v1Backup] = scrubBackup(files[MEMORY_DATA_FILES.v1Backup], ids, needles, request.clearAll)
  }

  for (const [name, text] of Object.entries(next)) {
    next[name] = replaceNeedles(text, needles)
  }
  for (const [name, text] of Object.entries(files)) {
    if (next[name] !== undefined) continue
    next[name] = replaceNeedles(text, needles)
  }
  return next
}

/** Chat messages with the deleted wording removed from every text field. */
export function scrubChatMessages<T>(messages: readonly T[], needles: readonly string[]): T[] {
  return scrubChatList(messages, uniqueNeedles(needles)) as T[]
}

/** Replace deleted wording in a free-form file such as the persona memory note. */
export function redactMemoryPlaintext(text: string, needles: readonly string[]): string {
  return replaceNeedles(text, uniqueNeedles(needles))
}

function scrubMemoryRows(rows: unknown[], ids: Set<string>, needles: string[], clearAll: boolean | undefined): unknown[] {
  if (clearAll) return []
  return rows
    .filter((row) => !isRecord(row) || !ids.has(stringField(row, 'id')))
    .map((row) => scrubValue(row, needles))
}

function scrubRows(rows: unknown[], ids: Set<string>, needles: string[], clearAll: boolean | undefined): unknown[] {
  return scrubMemoryRows(rows, ids, needles, clearAll)
}

function scrubDaily(store: Record<string, unknown>, needles: string[], clearAll: boolean | undefined): Record<string, unknown> {
  if (clearAll) return {}
  const next: Record<string, unknown> = {}
  for (const [day, entries] of Object.entries(store)) {
    if (!Array.isArray(entries)) continue
    const kept = entries
      .filter((entry) => !isRecord(entry) || !hits(stringField(entry, 'content'), needles))
      .map((entry) => scrubValue(entry, needles))
    if (kept.length) next[day] = kept
  }
  return next
}

function scrubSnapshots(runs: unknown[], ids: Set<string>, needles: string[], clearAll: boolean | undefined): unknown[] {
  if (clearAll) return []
  return runs.map((run) => {
    if (!isRecord(run) || !Array.isArray(run.memories)) return scrubValue(run, needles)
    return {
      ...run,
      memories: scrubMemoryRows(run.memories, ids, needles, false),
    }
  })
}

function scrubNarrative(store: Record<string, unknown>, ids: Set<string>, needles: string[], clearAll: boolean | undefined): Record<string, unknown> {
  if (clearAll) return { ...store, threads: [] }
  const threads = Array.isArray(store.threads) ? store.threads : []
  return {
    ...store,
    threads: threads.filter((thread) => {
      if (!isRecord(thread)) return false
      const memoryIds = Array.isArray(thread.memoryIds) ? thread.memoryIds.map((id) => String(id)) : []
      if (memoryIds.some((id) => ids.has(id))) return false
      return !hits(stringField(thread, 'title'), needles) && !hits(stringField(thread, 'summary'), needles)
    }).map((thread) => scrubValue(thread, needles)),
  }
}

function scrubAgenda(store: Record<string, unknown>, ids: Set<string>, needles: string[], clearAll: boolean | undefined): Record<string, unknown> {
  const items = Array.isArray(store.items) ? store.items : []
  const kept = items.filter((item) => {
    if (!isRecord(item)) return false
    if (clearAll && item.kind === 'open_loop') return false
    if (ids.has(stringField(item, 'sourceId'))) return false
    return !hits(stringField(item, 'summary'), needles)
  }).map((item) => scrubValue(item, needles))
  return { ...store, items: kept }
}

function scrubReminders(tasks: unknown[], reminderIds: Set<string>, needles: string[], clearAll: boolean | undefined): unknown[] {
  return tasks.filter((task) => {
    if (!isRecord(task)) return false
    if (reminderIds.has(stringField(task, 'id'))) return false
    if (clearAll && taskHits(task, needles)) return false
    return !taskHits(task, needles)
  }).map((task) => scrubValue(task, needles))
}

function taskHits(task: Record<string, unknown>, needles: string[]): boolean {
  if (hits(stringField(task, 'title'), needles)) return true
  if (hits(stringField(task, 'prompt'), needles)) return true
  if (hits(stringField(task, 'speechText'), needles)) return true
  return isRecord(task.action) && objectHits(task.action, needles)
}

function scrubChatList(messages: readonly unknown[], needles: string[]): unknown[] {
  return messages.map((message) => scrubValue(message, needles))
}

function scrubSessions(sessions: unknown[], needles: string[]): unknown[] {
  return sessions.map((session) => {
    if (!isRecord(session)) return scrubValue(session, needles)
    const messages = Array.isArray(session.messages) ? scrubChatList(session.messages, needles) : session.messages
    return scrubValue({ ...session, messages }, needles)
  })
}

function scrubCallbacks(entries: unknown[], ids: Set<string>, clearAll: boolean | undefined): unknown[] {
  if (clearAll) return []
  return entries.filter((entry) => !isRecord(entry) || !ids.has(stringField(entry, 'memoryId')))
}

function scrubOpLog(entries: unknown[], ids: Set<string>, needles: string[], request: MemoryPurgeRequest): unknown[] {
  const scrubbed = entries.map((entry) => scrubOp(entry, ids, needles, request.clearAll === true))
  scrubbed.push(request.clearAll ? clearOp(request) : deleteOp(request))
  return scrubbed
}

function scrubOp(entry: unknown, ids: Set<string>, needles: string[], clearAll: boolean): unknown {
  if (!isRecord(entry)) return entry
  const before = Array.isArray(entry.before)
    ? entry.before.filter((row) => !isRecord(row) || !ids.has(stringField(row, 'id')))
      .map((row) => scrubValue(row, needles))
    : []
  const evidenceQuote = typeof entry.evidenceQuote === 'string' && hits(entry.evidenceQuote, needles)
    ? REDACTED_MEMORY_NOTE
    : entry.evidenceQuote
  const reason = typeof entry.reason === 'string' && hits(entry.reason, needles)
    ? 'user-deleted'
    : entry.reason
  const scrubbed = scrubValue({ ...entry, evidenceQuote, reason, before }, needles)
  const record = isRecord(scrubbed) ? scrubbed : {}
  if (clearAll || before.length === 0) delete record.before
  return record
}

function deleteOp(request: MemoryPurgeRequest): Record<string, unknown> {
  const id = request.ids[0] ?? 'memory'
  return {
    id: `memory-op-user-delete-${id}`,
    at: request.at,
    actor: 'user',
    op: 'DELETE',
    targetIds: [...request.ids],
    reason: 'user-deleted',
    evidenceQuote: REDACTED_MEMORY_NOTE,
  }
}

function clearOp(request: MemoryPurgeRequest): Record<string, unknown> {
  return {
    id: 'memory-op-user-clear',
    at: request.at,
    actor: 'user',
    op: 'DELETE',
    targetIds: [...request.ids],
    reason: 'user-deleted',
    evidenceQuote: REDACTED_MEMORY_NOTE,
  }
}

function scrubBackup(raw: string, ids: Set<string>, needles: string[], clearAll: boolean | undefined): string {
  const replaced = replaceNeedles(raw, needles)
  try {
    const parsed = JSON.parse(replaced) as unknown
    if (!Array.isArray(parsed)) return replaced
    return writeJson(scrubMemoryRows(parsed, ids, needles, clearAll))
  } catch {
    return clearAll ? '[]' : replaced
  }
}

function scrubValue(value: unknown, needles: string[]): unknown {
  if (typeof value === 'string') return hits(value, needles) ? REDACTED_MEMORY_NOTE : value
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, needles))
  if (!isRecord(value)) return value
  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue
    next[key] = TEXT_FIELDS.has(key) || typeof item === 'object'
      ? scrubValue(item, needles)
      : item
  }
  return next
}

function objectHits(value: unknown, needles: string[]): boolean {
  if (typeof value === 'string') return hits(value, needles)
  if (Array.isArray(value)) return value.some((item) => objectHits(item, needles))
  if (!isRecord(value)) return false
  return Object.values(value).some((item) => objectHits(item, needles))
}

function hits(value: string, needles: string[]): boolean {
  const text = value.trim()
  if (!text) return false
  return needles.some((needle) => {
    if (!needle) return false
    if (text.includes(needle)) return true
    return text.length >= 12 && needle.includes(text)
  })
}

function replaceNeedles(text: string, needles: string[]): string {
  let next = text
  for (const needle of needles) {
    if (needle && next.includes(needle)) next = next.split(needle).join(REDACTED_MEMORY_NOTE)
  }
  return next
}

function collectClearNeedles(files: Readonly<Record<string, string>>): string[] {
  const sources = [
    MEMORY_DATA_FILES.longTerm,
    MEMORY_DATA_FILES.daily,
    MEMORY_DATA_FILES.snapshots,
    MEMORY_DATA_FILES.opLog,
    MEMORY_DATA_FILES.archive,
    MEMORY_DATA_FILES.narrative,
    MEMORY_DATA_FILES.v1Backup,
  ]
  const found: string[] = []
  for (const name of sources) {
    const raw = files[name]
    if (!raw) continue
    try {
      collectFieldText(JSON.parse(raw) as unknown, found)
    } catch {
      found.push(raw)
    }
  }
  return found
}

function collectFieldText(value: unknown, found: string[]): void {
  if (typeof value === 'string') return
  if (Array.isArray(value)) {
    value.forEach((item) => collectFieldText(item, found))
    return
  }
  if (!isRecord(value)) return
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && TEXT_FIELDS.has(key)) found.push(item)
    else collectFieldText(item, found)
  }
}

function uniqueNeedles(values: readonly (string | undefined)[]): string[] {
  const unique = new Set<string>()
  for (const value of values) {
    const text = value?.trim()
    if (text && text.length >= 2 && text !== REDACTED_MEMORY_NOTE) unique.add(text)
  }
  return [...unique].sort((left, right) => right.length - left.length)
}

function readArray(raw: string | undefined): unknown[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function readRecord(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeJson(value: unknown): string {
  return JSON.stringify(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key].trim() : ''
}
