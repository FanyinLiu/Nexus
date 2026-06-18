import type { ChatMessage, DailyMemoryStore, MemoryItem } from '../../types'
import { normalizeChatMessagesForStorage } from './chat.ts'
import { type ChatSession, normalizeChatSessionsForStorage } from './chatSessions.ts'
import { normalizeDailyMemoryStore, normalizeMemoryItemsForStorage } from './memory.ts'

export interface ChatMemoryReadThroughSnapshot {
  chat: {
    messages: ChatMessage[]
    sessions: ChatSession[]
  }
  memory: {
    memories: MemoryItem[]
    dailyMemories: DailyMemoryStore
  }
  metadata: {
    backupId: string
    copyId: string
    generatedAt: string
    readableRowCount: number
    returnedRowCount: number
  }
}

type ReadThroughDataResponse = Awaited<
  ReturnType<NonNullable<Window['desktopPet']>['readLocalStorageReadThroughData']>
>

function isSafeReadThroughDataResponse(
  response: ReadThroughDataResponse | null | undefined,
): response is ReadThroughDataResponse {
  return response?.gate === 'nexus-v1-m4-local-storage-read-through-data'
    && response.ok === true
    && response.migrationPlan.runtimeMigrationEnabled === false
    && response.migrationPlan.readThroughMigrationEnabled === true
    && response.migrationPlan.userConfirmedReadThroughMode === true
    && response.migrationPlan.sourceLocalStoragePreserved === true
    && response.migrationPlan.destructiveMigrationDetected === false
    && response.migrationPlan.fallbackLocalStorageSupported === true
    && response.privacy.containsUserData === true
    && response.privacy.sqliteValuesReturned === true
    && response.privacy.localStorageRawValuesReturned === false
    && response.privacy.absolutePathExposed === false
    && response.privacy.sourceLocalStorageMutated === false
    && response.privacy.valuesCopiedToAuditLog === false
}

export async function loadChatMemoryReadThroughSnapshot(): Promise<ChatMemoryReadThroughSnapshot | null> {
  const readData = window.desktopPet?.readLocalStorageReadThroughData
  if (typeof readData !== 'function') return null

  const response = await readData({
    domains: ['chat', 'memory'],
    limit: 500,
  })

  if (!isSafeReadThroughDataResponse(response)) return null

  const messages = normalizeChatMessagesForStorage(response.chat.messages, 500)
  const sessions = normalizeChatSessionsForStorage(response.chat.sessions)
  const memories = normalizeMemoryItemsForStorage(response.memory.memories)
  const dailyMemories = normalizeDailyMemoryStore(response.memory.dailyMemories)
  const hasSnapshotData = messages.length > 0
    || sessions.length > 0
    || memories.length > 0
    || Object.keys(dailyMemories).length > 0

  if (!hasSnapshotData) return null

  return {
    chat: {
      messages,
      sessions,
    },
    memory: {
      memories,
      dailyMemories,
    },
    metadata: {
      backupId: response.backupId,
      copyId: response.copyId,
      generatedAt: response.generatedAt,
      readableRowCount: response.totals.readableRowCount,
      returnedRowCount: response.totals.returnedRowCount,
    },
  }
}
