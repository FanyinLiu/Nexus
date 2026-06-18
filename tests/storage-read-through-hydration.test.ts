import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadChatMemoryReadThroughSnapshot } from '../src/lib/storage/readThroughHydration.ts'

function installDesktopBridge(response: unknown) {
  const writes: Array<{ key: string; value: string }> = []
  let requestPayload: unknown = null
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: () => null,
        setItem: (key: string, value: string) => {
          writes.push({ key, value })
        },
        removeItem: () => undefined,
        clear: () => undefined,
      },
      desktopPet: {
        readLocalStorageReadThroughData: async (payload: unknown) => {
          requestPayload = payload
          return response
        },
      },
    },
    configurable: true,
    writable: true,
  })
  return {
    writes,
    getRequestPayload: () => requestPayload,
  }
}

function readThroughDataResponse(overrides: Record<string, unknown> = {}) {
  return {
    gate: 'nexus-v1-m4-local-storage-read-through-data',
    ok: true,
    status: 'read-through-data-ready',
    generatedAt: '2026-06-18T14:00:00.000Z',
    backupId: 'local-storage-backup-hydration-test',
    copyId: 'local-storage-copy-hydration-test',
    copiedAt: '2026-06-18T13:59:00.000Z',
    copyStatus: 'copied',
    domains: ['chat', 'memory'],
    limit: 500,
    chat: {
      selected: true,
      messages: [
        {
          id: 'hydrate-user',
          role: 'user',
          content: ' private hydration chat sample ',
          createdAt: '2026-06-18T13:58:00.000Z',
        },
      ],
      sessions: [],
      sessionCount: 1,
      messageCount: 1,
      returnedMessageCount: 1,
      returnedSessionCount: 0,
    },
    memory: {
      selected: true,
      memories: [
        {
          id: 'hydrate-memory',
          content: ' private hydration memory sample ',
          category: 'preference',
          source: 'chat',
          enabled: true,
          createdAt: '2026-06-18T13:58:30.000Z',
        },
      ],
      dailyMemories: {
        '2026-06-18': [
          {
            id: 'hydrate-daily',
            day: '2026-06-18',
            role: 'assistant',
            content: ' private hydration daily sample ',
            source: 'chat',
            createdAt: '2026-06-18T13:59:00.000Z',
          },
        ],
      },
      memoryCount: 1,
      dailyMemoryEntryCount: 1,
      returnedMemoryCount: 1,
      returnedDailyMemoryEntryCount: 1,
      dayCount: 1,
    },
    totals: {
      readableRowCount: 3,
      returnedRowCount: 3,
    },
    migrationPlan: {
      runtimeMigrationEnabled: false,
      readThroughMigrationEnabled: true,
      userConfirmedReadThroughMode: true,
      sourceLocalStoragePreserved: true,
      destructiveMigrationDetected: false,
      fallbackLocalStorageSupported: true,
    },
    privacy: {
      containsUserData: true,
      sqliteValuesReturned: true,
      localStorageRawValuesReturned: false,
      absolutePathExposed: false,
      sourceLocalStorageMutated: false,
      valuesCopiedToAuditLog: false,
    },
    nextActions: ['hydrate-renderer-chat-memory-state-without-localstorage-writeback'],
    ...overrides,
  }
}

test('read-through hydration normalizes IPC data without writing localStorage', async () => {
  const bridge = installDesktopBridge(readThroughDataResponse())

  const snapshot = await loadChatMemoryReadThroughSnapshot()

  assert.deepEqual(bridge.getRequestPayload(), {
    domains: ['chat', 'memory'],
    limit: 500,
  })
  assert.equal(snapshot?.chat.messages[0]?.content, 'private hydration chat sample')
  assert.equal(snapshot?.memory.memories[0]?.content, 'private hydration memory sample')
  assert.equal(snapshot?.memory.dailyMemories['2026-06-18']?.[0]?.content, 'private hydration daily sample')
  assert.equal(snapshot?.metadata.copyId, 'local-storage-copy-hydration-test')
  assert.equal(bridge.writes.length, 0)
})

test('read-through hydration rejects unconfirmed or unsafe data responses', async () => {
  installDesktopBridge(readThroughDataResponse({
    migrationPlan: {
      runtimeMigrationEnabled: false,
      readThroughMigrationEnabled: true,
      userConfirmedReadThroughMode: false,
      sourceLocalStoragePreserved: true,
      destructiveMigrationDetected: false,
      fallbackLocalStorageSupported: true,
    },
  }))
  assert.equal(await loadChatMemoryReadThroughSnapshot(), null)

  installDesktopBridge(readThroughDataResponse({
    privacy: {
      containsUserData: true,
      sqliteValuesReturned: true,
      localStorageRawValuesReturned: false,
      absolutePathExposed: false,
      sourceLocalStorageMutated: false,
      valuesCopiedToAuditLog: true,
    },
  }))
  assert.equal(await loadChatMemoryReadThroughSnapshot(), null)
})
