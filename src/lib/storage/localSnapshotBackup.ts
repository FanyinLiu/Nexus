import {
  AUTONOMY_RELATIONSHIP_HISTORY_STORAGE_KEY,
  AUTONOMY_RELATIONSHIP_STORAGE_KEY,
  CHAT_SESSIONS_STORAGE_KEY,
  CHAT_STORAGE_KEY,
  DAILY_MEMORY_STORAGE_KEY,
  LEGACY_MEMORY_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
} from './core.ts'

export const CHAT_MEMORY_LOCAL_STORAGE_SNAPSHOT_KEYS = [
  CHAT_STORAGE_KEY,
  CHAT_SESSIONS_STORAGE_KEY,
  LEGACY_MEMORY_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
  DAILY_MEMORY_STORAGE_KEY,
  AUTONOMY_RELATIONSHIP_STORAGE_KEY,
  AUTONOMY_RELATIONSHIP_HISTORY_STORAGE_KEY,
] as const

export type LocalStorageSnapshotEntry = {
  key: string
  value: string
}

export function collectChatMemoryLocalStorageSnapshotEntries(
  storage: Storage | null | undefined = typeof window !== 'undefined' ? window.localStorage : null,
): LocalStorageSnapshotEntry[] {
  if (!storage) return []

  const entries: LocalStorageSnapshotEntry[] = []
  for (const key of CHAT_MEMORY_LOCAL_STORAGE_SNAPSHOT_KEYS) {
    try {
      const value = storage.getItem(key)
      if (typeof value === 'string') entries.push({ key, value })
    } catch {
      // localStorage may be unavailable in private mode or during teardown.
    }
  }
  return entries
}

export async function backupChatMemoryLocalStorageSnapshot(
  reason = 'manual',
) {
  const entries = collectChatMemoryLocalStorageSnapshotEntries()
  if (!entries.length) return null
  const bridge = typeof window !== 'undefined' ? window.desktopPet : undefined
  if (!bridge?.backupLocalStorageSnapshot) return null
  return bridge.backupLocalStorageSnapshot({ reason, entries })
}

export async function copyChatMemoryLocalStorageSnapshotBackup(
  backupId: string,
) {
  const trimmedBackupId = backupId.trim()
  if (!trimmedBackupId) return null
  const bridge = typeof window !== 'undefined' ? window.desktopPet : undefined
  if (!bridge?.copyLocalStorageSnapshot) return null
  return bridge.copyLocalStorageSnapshot({ backupId: trimmedBackupId })
}
