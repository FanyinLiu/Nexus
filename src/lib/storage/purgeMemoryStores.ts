/**
 * Persist a memory delete without leaving the wording on disk.
 *
 * The op log keeps a redacted row. Run snapshots, evidence quotes, reminder
 * copies, and the other memory files lose the text. A session-only buffer
 * can still undo one delete until reload. One row goes through
 * `memoryVectorRemove`. Clearing the archive goes through `memoryVectorClear`,
 * which flushes the vector snapshot and vacuums local-data pages.
 */

import { formatMemoriesForPersonaFile } from '../../features/memory/memoryPersistence.ts'
import { ARCHIVE_STORAGE_KEY } from '../../features/memory/coldArchive.ts'
import {
  clearDeletedMemorySession,
  holdDeletedMemory,
} from '../../features/memory/deletedMemorySession.ts'
import { NARRATIVE_STORAGE_KEY } from '../../features/memory/narrativeMemory.ts'
import {
  MEMORY_DATA_FILES,
  memoryPlaintextNeedles,
  redactMemoryPlaintext,
  scrubMemoryDataFiles,
  type MemoryPurgeRequest,
} from '../../features/memory/purgeMemoryText.ts'
import type { DailyMemoryStore, MemoryItem } from '../../types/memory.ts'
import { loadMemories } from './memory.ts'
import {
  cancelDebouncedWrite,
  CHAT_SESSIONS_STORAGE_KEY,
  CHAT_STORAGE_KEY,
  DAILY_MEMORY_STORAGE_KEY,
  MEMORY_CALLBACK_QUEUE_STORAGE_KEY,
  MEMORY_OP_LOG_STORAGE_KEY,
  MEMORY_RUN_SNAPSHOT_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
  MEMORY_V1_BACKUP_STORAGE_KEY,
  PROACTIVE_AGENDA_STORAGE_KEY,
  REMINDER_TASKS_STORAGE_KEY,
  writeJson,
} from './core.ts'

/** Chat state listens and drops the same wording from the open transcript. */
export const MEMORY_PLAINTEXT_PURGED_EVENT = 'nexus:memory-plaintext-purged'

/** The portrait re-reads the op log after a redacted delete row is written. */
export const MEMORY_OP_LOG_CHANGED_EVENT = 'nexus:memory-op-log-changed'

const FILE_TO_KEY: Record<string, string> = {
  [MEMORY_DATA_FILES.longTerm]: MEMORY_STORAGE_KEY,
  [MEMORY_DATA_FILES.daily]: DAILY_MEMORY_STORAGE_KEY,
  [MEMORY_DATA_FILES.opLog]: MEMORY_OP_LOG_STORAGE_KEY,
  [MEMORY_DATA_FILES.snapshots]: MEMORY_RUN_SNAPSHOT_STORAGE_KEY,
  [MEMORY_DATA_FILES.v1Backup]: MEMORY_V1_BACKUP_STORAGE_KEY,
  [MEMORY_DATA_FILES.archive]: ARCHIVE_STORAGE_KEY,
  [MEMORY_DATA_FILES.narrative]: NARRATIVE_STORAGE_KEY,
  [MEMORY_DATA_FILES.agenda]: PROACTIVE_AGENDA_STORAGE_KEY,
  [MEMORY_DATA_FILES.reminders]: REMINDER_TASKS_STORAGE_KEY,
  [MEMORY_DATA_FILES.chat]: CHAT_STORAGE_KEY,
  [MEMORY_DATA_FILES.chatSessions]: CHAT_SESSIONS_STORAGE_KEY,
  [MEMORY_DATA_FILES.callbacks]: MEMORY_CALLBACK_QUEUE_STORAGE_KEY,
}

/**
 * Read the memory files this feature persists.
 * Missing keys are omitted. Callers can write the map into a directory.
 */
export function readMemoryDataFiles(): Record<string, string> {
  const storage = currentStorage()
  if (!storage) return {}
  const files: Record<string, string> = {}
  for (const [file, key] of Object.entries(FILE_TO_KEY)) {
    const raw = storage.getItem(key)
    if (raw !== null) files[file] = raw
  }
  return files
}

/**
 * Delete one memory's wording from the persisted stores.
 * The row is held in the session buffer and is not written back.
 */
export function purgeDeletedMemory(memory: MemoryItem, at = new Date().toISOString()): void {
  holdDeletedMemory(memory)
  const needles = memoryPlaintextNeedles(memory)
  applyPurge({
    ids: [memory.id],
    needles,
    reminderIds: memory.loopReminderTaskId ? [memory.loopReminderTaskId] : [],
    at,
  })
  void refreshPersona(needles)
  requestVectorPurge([memory.id], false)
}

/**
 * Clear-all removes every stored copy of the current memories and diary.
 * It does not keep a session undo.
 */
export function purgeClearedMemories(
  memories: readonly MemoryItem[],
  daily: DailyMemoryStore,
  at = new Date().toISOString(),
): void {
  clearDeletedMemorySession()
  const needles = [
    ...memories.flatMap((memory) => memoryPlaintextNeedles(memory)),
    ...Object.values(daily).flatMap((entries) => entries.map((entry) => entry.content)),
  ]
  const reminderIds = memories.flatMap((memory) => memory.loopReminderTaskId ? [memory.loopReminderTaskId] : [])
  applyPurge({
    ids: memories.map((memory) => memory.id),
    needles,
    reminderIds,
    clearAll: true,
    at,
  })
  void refreshPersona(needles)
  requestVectorPurge(memories.map((memory) => memory.id), true)
}

function applyPurge(request: MemoryPurgeRequest): void {
  const storage = currentStorage()
  if (!storage) return
  const next = scrubMemoryDataFiles(readMemoryDataFiles(), request)
  for (const [file, text] of Object.entries(next)) {
    const key = FILE_TO_KEY[file]
    if (!key) continue
    cancelDebouncedWrite(key)
    if (file === MEMORY_DATA_FILES.v1Backup) {
      storage.setItem(key, text)
      continue
    }
    try {
      writeJson(key, JSON.parse(text) as unknown)
    } catch {
      storage.setItem(key, text)
    }
  }
  window.dispatchEvent(new CustomEvent(MEMORY_PLAINTEXT_PURGED_EVENT, {
    detail: { ids: [...request.ids], needles: [...request.needles] },
  }))
  window.dispatchEvent(new CustomEvent(MEMORY_OP_LOG_CHANGED_EVENT))
}

function currentStorage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

async function refreshPersona(needles: readonly string[]): Promise<void> {
  const pet = window.desktopPet
  if (!pet?.personaLoadMemory || !pet.personaSaveMemory) return
  try {
    const existing = await pet.personaLoadMemory()
    const formatted = formatMemoriesForPersonaFile(loadMemories(), existing ?? '')
    await pet.personaSaveMemory({ content: redactMemoryPlaintext(formatted, needles) })
  } catch {
    // Persona memory is a best-effort mirror of the store we already purged.
  }
}

/**
 * Ask the vector store to drop the ids. Clear-all uses the wipe hook so
 * the snapshot and the database free pages go with the rows. A single
 * delete only removes those ids.
 */
function requestVectorPurge(ids: readonly string[], clearAll: boolean): void {
  const pet = window.desktopPet
  if (!pet) return
  if (clearAll && typeof pet.memoryVectorClear === 'function') {
    void pet.memoryVectorClear().catch(() => undefined)
    return
  }
  if (ids.length && pet.memoryVectorRemove) {
    void pet.memoryVectorRemove({ ids: [...ids] }).catch(() => undefined)
  }
}
