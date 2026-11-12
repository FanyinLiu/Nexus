import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  openSqliteDatabase,
  resolveLocalDataPaths,
} from '../electron/services/localDataStoreCore.js'

register(new URL('./helpers/local-data-ipc-electron-hooks.mjs', import.meta.url))

type IpcHandler = (event: unknown, payload: unknown) => Promise<Record<string, unknown>>
type OwnerWindow = { webContents: { getURL: () => string } }

type TestState = {
  handlers: Map<string, IpcHandler>
  userData: string | null
  ownerWindows: Map<object, OwnerWindow>
}

type LocalDataStore = {
  readLocalDataDomainRecords: (
    domainId: string,
    options: { userDataPath: string },
  ) => Promise<Array<{ recordId: string, payload: Record<string, unknown> }>>
}

type LocalDataModules = {
  bindWindowCapability: (webContents: object, viewKind: string) => void
  store: LocalDataStore
}

const TRUSTED_URL = 'http://localhost:5173/?view=panel'
const MIGRATION_FLAGS = [
  'NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION',
  'NEXUS_ENABLE_LOCAL_DATA_MEMORY_MIGRATION',
  'NEXUS_ENABLE_LOCAL_DATA_COMPANION_MIGRATION',
] as const

function testState(): TestState {
  const holder = globalThis as { __nexusLocalDataIpcTestState?: TestState }
  holder.__nexusLocalDataIpcTestState ??= {
    handlers: new Map(),
    userData: null,
    ownerWindows: new Map(),
  }
  return holder.__nexusLocalDataIpcTestState
}

function setMigrationIpcEnabled(enabled: boolean) {
  for (const flag of MIGRATION_FLAGS) {
    if (enabled) process.env[flag] = '1'
    else delete process.env[flag]
  }
}

function useTempUserData(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'nexus-local-data-ipc-'))
  testState().userData = dir
  return dir
}

function assertNoLocalDataStore(userDataPath: string) {
  assert.equal(existsSync(path.join(userDataPath, 'local-data')), false)
}

let modulesPromise: Promise<LocalDataModules> | null = null

async function loadModules(): Promise<LocalDataModules> {
  if (!modulesPromise) {
    modulesPromise = (async () => {
      const [ipc, capabilities, store] = await Promise.all([
        import('../electron/ipc/localDataIpc.js'),
        import('../electron/ipc/windowCapabilities.js'),
        import('../electron/services/localDataStore.js'),
      ])
      ipc.register()
      return {
        bindWindowCapability: capabilities.bindWindowCapability,
        store: store as unknown as LocalDataStore,
      }
    })()
  }
  return modulesPromise
}

async function handlerFor(channel: string): Promise<IpcHandler> {
  await loadModules()
  const handler = testState().handlers.get(channel)
  assert.equal(typeof handler, 'function', `${channel} handler was not registered`)
  return handler
}

let nextSenderId = 1

async function trustedEvent(channel: string, viewKind = 'panel'): Promise<Record<string, unknown>> {
  const modules = await loadModules()
  const sender = { id: nextSenderId++ }
  const ownerWindow = { webContents: { getURL: () => TRUSTED_URL } }
  testState().ownerWindows.set(sender, ownerWindow)
  modules.bindWindowCapability(sender, viewKind)
  return { sender, senderFrame: { parent: null, url: TRUSTED_URL }, channel }
}

function eventFromUnknownWindow(channel: string): Record<string, unknown> {
  return { sender: {}, senderFrame: { parent: null, url: TRUSTED_URL }, channel }
}

async function eventFromForeignFrame(channel: string): Promise<Record<string, unknown>> {
  const modules = await loadModules()
  const sender = { id: nextSenderId++ }
  testState().ownerWindows.set(sender, { webContents: { getURL: () => TRUSTED_URL } })
  modules.bindWindowCapability(sender, 'panel')
  return {
    sender,
    senderFrame: { parent: null, url: 'http://untrusted.example/?view=panel' },
    channel,
  }
}

function chatApplyPayloadWithSessions(sessionIds: string[]) {
  return {
    confirmed: true,
    migrationPackage: {
      schemaVersion: 1,
      createdAt: '2026-06-19T11:00:00.000Z',
      source: {
        sessionsKeyPresent: true,
        legacyFlatChatKeyPresent: false,
        legacyFlatChatUsed: false,
      },
      sessions: sessionIds.map((sessionId, index) => ({
        id: sessionId,
        startedAt: 1_781_000_000_000 + index,
        lastActiveAt: 1_781_000_100_000 + index,
        title: '  synthetic session  ',
        messages: [{
          id: `message-${index + 1}`,
          role: 'user',
          content: 'synthetic chat line',
          createdAt: '2026-06-19T08:00:00.000Z',
        }],
      })),
    },
  }
}

function chatApplyPayload() {
  return chatApplyPayloadWithSessions(['session-1'])
}

function memoryApplyPayloadWithIds(longTermId: string, dailyId: string) {
  return {
    confirmed: true,
    migrationPackage: {
      schemaVersion: 1,
      createdAt: '2026-06-19T11:00:00.000Z',
      source: {
        longTermKeyPresent: true,
        legacyLongTermKeyPresent: false,
        dailyKeyPresent: true,
        legacyLongTermUsed: false,
      },
      longTerm: [{
        id: longTermId,
        content: 'synthetic memory line',
        category: '  preference  ',
        source: 'chat',
        kind: 'preference',
        enabled: true,
        createdAt: '2026-06-19T10:00:00.000Z',
      }],
      daily: [{
        id: dailyId,
        day: '2026-06-19',
        role: 'user',
        content: 'synthetic daily line',
        source: 'chat',
        createdAt: '2026-06-19T10:30:00.000Z',
      }],
    },
  }
}

function memoryApplyPayload() {
  return memoryApplyPayloadWithIds('memory-1', 'daily-1')
}

function companionApplyPayload() {
  return {
    confirmed: true,
    migrationPackage: {
      schemaVersion: 1,
      createdAt: '2026-07-09T20:00:00.000Z',
      source: {
        relationshipKeysPresent: ['nexus:autonomy:relationship'],
        taskKeysPresent: ['nexus:plans'],
        invalidKeys: [],
      },
      relationship: [{
        id: 'relationship-state',
        storageKey: 'nexus:autonomy:relationship',
        value: { tone: 'synthetic' },
      }],
      tasks: [{
        id: 'plans',
        storageKey: 'nexus:plans',
        value: [{ id: 'plan-1', title: 'synthetic plan', done: false }],
      }],
    },
  }
}

async function readDomain(userDataPath: string, domainId: string) {
  const modules = await loadModules()
  return modules.store.readLocalDataDomainRecords(domainId, { userDataPath })
}

// Test-only failure injection: SQLite aborts the matching insert, leaving the
// surrounding apply transaction open so its ROLLBACK path is exercised.
async function installChatInsertAbortTrigger(userDataPath: string, recordId: string) {
  const { databasePath } = await resolveLocalDataPaths({ userDataPath })
  const db = openSqliteDatabase(databasePath)
  try {
    const escapedRecordId = recordId.replaceAll("'", "''")
    db.exec(`
      CREATE TRIGGER synthetic_chat_insert_abort
      BEFORE INSERT ON local_data_records
      WHEN NEW.domain_id = 'chat-sessions' AND NEW.record_id = '${escapedRecordId}'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic middle-of-apply failure');
      END;
    `)
  } finally {
    db.close()
  }
}

test('chat migration apply and rollback run through the IPC handler with the validated package', async () => {
  setMigrationIpcEnabled(true)
  const dir = useTempUserData()
  try {
    const apply = await handlerFor('local-data:chat-migration-apply')
    const applied = await apply(await trustedEvent('local-data:chat-migration-apply'), chatApplyPayload())
    assert.equal(applied.ok, true)
    assert.equal(applied.applied, true)
    assert.equal(applied.recordsWritten, 1)

    const records = await readDomain(dir, 'chat-sessions')
    assert.equal(records.length, 1)
    assert.equal(records[0].recordId, 'session-1')
    // The stored title is trimmed, so apply received the validated package and
    // not the raw renderer payload.
    assert.equal(records[0].payload.title, 'synthetic session')
    const messages = records[0].payload.messages as Array<{ content: string }>
    assert.equal(messages[0].content, 'synthetic chat line')

    const rollback = await handlerFor('local-data:chat-migration-rollback')
    const rolledBack = await rollback(await trustedEvent('local-data:chat-migration-rollback'), { confirmed: true })
    assert.equal(rolledBack.ok, true)
    assert.equal(rolledBack.recordsDeleted, 1)
    assert.deepEqual(await readDomain(dir, 'chat-sessions'), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory migration apply and rollback run through the IPC handler with the validated package', async () => {
  setMigrationIpcEnabled(true)
  const dir = useTempUserData()
  try {
    const apply = await handlerFor('local-data:memory-migration-apply')
    const applied = await apply(await trustedEvent('local-data:memory-migration-apply'), memoryApplyPayload())
    assert.equal(applied.ok, true)
    assert.equal(applied.applied, true)
    assert.equal(applied.recordsWritten, 2)

    const longTerm = await readDomain(dir, 'memory-long-term')
    const daily = await readDomain(dir, 'memory-daily')
    assert.equal(longTerm.length, 1)
    assert.equal(longTerm[0].recordId, 'memory-1')
    // Category is trimmed by the payload schema, proving the validated input
    // crossed the IPC boundary into apply.
    assert.equal(longTerm[0].payload.category, 'preference')
    assert.equal(daily.length, 1)
    assert.equal(daily[0].payload.content, 'synthetic daily line')

    const rollback = await handlerFor('local-data:memory-migration-rollback')
    const rolledBack = await rollback(await trustedEvent('local-data:memory-migration-rollback'), { confirmed: true })
    assert.equal(rolledBack.ok, true)
    assert.equal(rolledBack.recordsDeleted, 2)
    assert.deepEqual(await readDomain(dir, 'memory-long-term'), [])
    assert.deepEqual(await readDomain(dir, 'memory-daily'), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('companion migration apply and rollback run through the IPC handler', async () => {
  setMigrationIpcEnabled(true)
  const dir = useTempUserData()
  try {
    const apply = await handlerFor('local-data:companion-migration-apply')
    const applied = await apply(await trustedEvent('local-data:companion-migration-apply'), companionApplyPayload())
    assert.equal(applied.ok, true)
    assert.equal(applied.applied, true)
    assert.equal(applied.recordsWritten, 2)

    const relationship = await readDomain(dir, 'companion-relationship')
    const tasks = await readDomain(dir, 'companion-tasks')
    assert.equal(relationship.length, 1)
    assert.deepEqual(relationship[0].payload.value, { tone: 'synthetic' })
    assert.equal(tasks.length, 1)
    assert.deepEqual(tasks[0].payload.value, [{ id: 'plan-1', title: 'synthetic plan', done: false }])

    const rollback = await handlerFor('local-data:companion-migration-rollback')
    const rolledBack = await rollback(await trustedEvent('local-data:companion-migration-rollback'), { confirmed: true })
    assert.equal(rolledBack.ok, true)
    assert.equal(rolledBack.recordsDeleted, 2)
    assert.deepEqual(await readDomain(dir, 'companion-relationship'), [])
    assert.deepEqual(await readDomain(dir, 'companion-tasks'), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('chat migration apply clears records that are not part of the package', async () => {
  setMigrationIpcEnabled(true)
  const dir = useTempUserData()
  try {
    const channel = 'local-data:chat-migration-apply'
    const apply = await handlerFor(channel)
    const seeded = await apply(
      await trustedEvent(channel),
      chatApplyPayloadWithSessions(['session-pre-existing']),
    )
    assert.equal(seeded.ok, true)
    assert.deepEqual(
      (await readDomain(dir, 'chat-sessions')).map((record) => record.recordId),
      ['session-pre-existing'],
    )

    const applied = await apply(await trustedEvent(channel), chatApplyPayload())
    assert.equal(applied.ok, true)
    assert.equal(applied.recordsWritten, 1)

    const records = await readDomain(dir, 'chat-sessions')
    assert.deepEqual(records.map((record) => record.recordId), ['session-1'])
    assert.equal(records.some((record) => record.recordId === 'session-pre-existing'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory migration apply clears both memory domains before inserting the package', async () => {
  setMigrationIpcEnabled(true)
  const dir = useTempUserData()
  try {
    const channel = 'local-data:memory-migration-apply'
    const apply = await handlerFor(channel)
    const seeded = await apply(
      await trustedEvent(channel),
      memoryApplyPayloadWithIds('memory-pre-existing', 'daily-pre-existing'),
    )
    assert.equal(seeded.ok, true)
    assert.deepEqual(
      (await readDomain(dir, 'memory-long-term')).map((record) => record.recordId),
      ['memory-pre-existing'],
    )
    assert.deepEqual(
      (await readDomain(dir, 'memory-daily')).map((record) => record.recordId),
      ['daily-pre-existing'],
    )

    const applied = await apply(await trustedEvent(channel), memoryApplyPayload())
    assert.equal(applied.ok, true)
    assert.equal(applied.recordsWritten, 2)

    const longTerm = await readDomain(dir, 'memory-long-term')
    const daily = await readDomain(dir, 'memory-daily')
    assert.deepEqual(longTerm.map((record) => record.recordId), ['memory-1'])
    assert.deepEqual(daily.map((record) => record.recordId), ['daily-1'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('chat migration apply rolls back every mutation when an insert fails mid-transaction', async () => {
  setMigrationIpcEnabled(true)
  const dir = useTempUserData()
  try {
    const channel = 'local-data:chat-migration-apply'
    const apply = await handlerFor(channel)
    const seeded = await apply(
      await trustedEvent(channel),
      chatApplyPayloadWithSessions(['session-pre-existing']),
    )
    assert.equal(seeded.ok, true)

    // The abort fires on the second insert, after the domain DELETE and the
    // first insert have already mutated the transaction.
    await installChatInsertAbortTrigger(dir, 'session-2')

    const failed = await apply(
      await trustedEvent(channel),
      chatApplyPayloadWithSessions(['session-1', 'session-2']),
    )
    assert.equal(failed.ok, false)
    assert.equal(failed.applied, false)
    assert.equal(failed.recordsWritten, 0)

    const records = await readDomain(dir, 'chat-sessions')
    assert.deepEqual(records.map((record) => record.recordId), ['session-pre-existing'])
    assert.equal(records.some((record) => record.recordId === 'session-1'), false)
    assert.equal(records.some((record) => record.recordId === 'session-2'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('chat migration rollback empties the domain instead of restoring pre-apply records', async () => {
  setMigrationIpcEnabled(true)
  const dir = useTempUserData()
  try {
    const applyChannel = 'local-data:chat-migration-apply'
    const apply = await handlerFor(applyChannel)
    const seeded = await apply(
      await trustedEvent(applyChannel),
      chatApplyPayloadWithSessions(['session-pre-apply']),
    )
    assert.equal(seeded.ok, true)

    const applied = await apply(await trustedEvent(applyChannel), chatApplyPayload())
    assert.equal(applied.ok, true)

    const rollbackChannel = 'local-data:chat-migration-rollback'
    const rollback = await handlerFor(rollbackChannel)
    const rolledBack = await rollback(await trustedEvent(rollbackChannel), { confirmed: true })
    assert.equal(rolledBack.ok, true)
    assert.equal(rolledBack.recordsDeleted, 1)

    // Current contract of this version, documented rather than fixed: rollback
    // deletes every chat-sessions row. It does not restore the records that
    // existed before apply, so the domain ends up empty instead of rewound.
    assert.deepEqual(await readDomain(dir, 'chat-sessions'), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('migration IPC flags disable apply and rollback without touching storage', async () => {
  const dir = useTempUserData()
  setMigrationIpcEnabled(false)
  try {
    const cases = [
      { channel: 'local-data:chat-migration-apply', action: 'apply', payload: chatApplyPayload(), errorKind: 'local-data-chat-migration-ipc-disabled' },
      { channel: 'local-data:chat-migration-rollback', action: 'rollback', payload: { confirmed: true }, errorKind: 'local-data-chat-migration-ipc-disabled' },
      { channel: 'local-data:memory-migration-apply', action: 'apply', payload: memoryApplyPayload(), errorKind: 'local-data-memory-migration-ipc-disabled' },
      { channel: 'local-data:memory-migration-rollback', action: 'rollback', payload: { confirmed: true }, errorKind: 'local-data-memory-migration-ipc-disabled' },
      { channel: 'local-data:companion-migration-apply', action: 'apply', payload: companionApplyPayload(), errorKind: 'local-data-companion-migration-ipc-disabled' },
      { channel: 'local-data:companion-migration-rollback', action: 'rollback', payload: { confirmed: true }, errorKind: 'local-data-companion-migration-ipc-disabled' },
    ]

    for (const entry of cases) {
      const handler = await handlerFor(entry.channel)
      const result = await handler(await trustedEvent(entry.channel), entry.payload)
      assert.equal(result.ok, false, entry.channel)
      assert.equal(result.errorKind, entry.errorKind, entry.channel)
      if (entry.action === 'apply') {
        assert.equal(result.applied, false, entry.channel)
        assert.equal(result.recordsWritten, 0, entry.channel)
      } else {
        assert.equal(result.recordsDeleted, 0, entry.channel)
      }
    }

    assertNoLocalDataStore(dir)
  } finally {
    setMigrationIpcEnabled(true)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('untrusted renderers are rejected before apply or rollback can mutate data', async () => {
  setMigrationIpcEnabled(true)
  const dir = useTempUserData()
  try {
    const chatApply = await handlerFor('local-data:chat-migration-apply')
    await assert.rejects(
      chatApply(eventFromUnknownWindow('local-data:chat-migration-apply'), chatApplyPayload()),
      /IPC rejected: sender is not a known application window/u,
    )

    const memoryRollback = await handlerFor('local-data:memory-migration-rollback')
    await assert.rejects(
      memoryRollback(await eventFromForeignFrame('local-data:memory-migration-rollback'), { confirmed: true }),
      /IPC rejected: sender frame is not the trusted renderer/u,
    )

    const companionApply = await handlerFor('local-data:companion-migration-apply')
    await assert.rejects(
      companionApply(await trustedEvent('local-data:companion-migration-apply', 'pet'), companionApplyPayload()),
      /panel capability is unavailable to pet window/u,
    )

    assertNoLocalDataStore(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('invalid payloads are rejected before apply or rollback can mutate data', async () => {
  setMigrationIpcEnabled(true)
  const dir = useTempUserData()
  try {
    const cases = [
      { channel: 'local-data:chat-migration-apply', payload: { ...chatApplyPayload(), unexpected: true } },
      { channel: 'local-data:chat-migration-rollback', payload: { confirmed: true, unexpected: true } },
      { channel: 'local-data:memory-migration-apply', payload: { ...memoryApplyPayload(), unexpected: true } },
      { channel: 'local-data:memory-migration-rollback', payload: { confirmed: true, unexpected: true } },
      { channel: 'local-data:companion-migration-apply', payload: { ...companionApplyPayload(), unexpected: true } },
      { channel: 'local-data:companion-migration-rollback', payload: { confirmed: true, unexpected: true } },
    ]

    for (const entry of cases) {
      const handler = await handlerFor(entry.channel)
      await assert.rejects(
        handler(await trustedEvent(entry.channel), entry.payload),
        /Invalid IPC payload/u,
        entry.channel,
      )
    }

    assertNoLocalDataStore(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
