import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildChatStorageMigrationDryRun,
  buildChatStorageMigrationPackage,
  loadChatStorageMigrationDryRun,
} from '../src/lib/storage/chatMigrationDryRun.ts'
import {
  buildChatMigrationBackupEnvelope,
  buildChatMigrationBackupFileName,
  buildChatMigrationComparisonSource,
  buildChatMigrationPreviewSummary,
  isChatMigrationPreviewEnabled,
} from '../src/lib/storage/chatMigrationPreview.ts'

function createLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    snapshot: () => Object.fromEntries(store.entries()),
  }
}

function installStorage(initial: Record<string, string> = {}) {
  const localStorage = createLocalStorageMock(initial)
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })
  return localStorage
}

test('chat migration dry-run reports empty storage without writing data', () => {
  const storage = installStorage()
  const before = storage.snapshot()

  const report = loadChatStorageMigrationDryRun({
    now: new Date('2026-06-19T12:00:00.000Z'),
  })

  assert.equal(report.status, 'empty')
  assert.equal(report.generatedAt, '2026-06-19T12:00:00.000Z')
  assert.equal(report.totals.sessionCount, 0)
  assert.equal(report.totals.messageCount, 0)
  assert.equal(report.migrationPlan.writeRecords, false)
  assert.equal(report.migrationPlan.nextStep, 'no-op')
  assert.deepEqual(storage.snapshot(), before)
  assert.ok(report.issues.some((item) => item.code === 'no-chat-data'))
})

test('chat migration dry-run summarizes session storage without exposing content', () => {
  const report = buildChatStorageMigrationDryRun({
    sessionsRaw: JSON.stringify([
      {
        id: 'session-secret-topic',
        title: 'private project codename',
        startedAt: '2026-06-01T10:00:00.000Z',
        lastActiveAt: '2026-06-01T10:02:00.000Z',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'private launch plan',
            createdAt: '2026-06-01T10:00:00.000Z',
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'private answer',
            createdAt: '2026-06-01T10:02:00.000Z',
            reasoning_content: 'private reasoning trace',
            toolResult: {
              kind: 'open_external',
              result: { ok: true, url: 'https://secret.example.test', message: 'opened' },
            },
          },
        ],
      },
    ]),
    legacyRaw: null,
  }, {
    now: '2026-06-19T12:00:00.000Z',
  })

  assert.equal(report.status, 'needs_review')
  assert.equal(report.source.sessions.present, true)
  assert.equal(report.source.sessions.normalizedItemCount, 1)
  assert.equal(report.totals.sessionCount, 1)
  assert.equal(report.totals.messageCount, 2)
  assert.equal(report.totals.userMessageCount, 1)
  assert.equal(report.totals.assistantMessageCount, 1)
  assert.equal(report.totals.toolResultMessageCount, 1)
  assert.equal(report.totals.reasoningMessageCount, 1)
  assert.equal(report.totals.titledSessionCount, 1)
  assert.equal(report.totals.firstMessageAt, '2026-06-01T10:00:00.000Z')
  assert.equal(report.totals.lastMessageAt, '2026-06-01T10:02:00.000Z')
  assert.equal(report.migrationPlan.wouldCreateSessionRecords, 1)
  assert.equal(report.migrationPlan.wouldCreateMessageRecords, 2)
  assert.equal(report.migrationPlan.includesMessageContent, false)
  assert.equal(report.migrationPlan.requiresUserConfirmation, true)

  const serialized = JSON.stringify(report)
  assert.equal(serialized.includes('private launch plan'), false)
  assert.equal(serialized.includes('private project codename'), false)
  assert.equal(serialized.includes('private reasoning trace'), false)
  assert.equal(serialized.includes('secret.example.test'), false)
})

test('chat migration dry-run plans legacy flat chat only when sessions are absent', () => {
  const legacyOnly = buildChatStorageMigrationDryRun({
    sessionsRaw: null,
    legacyRaw: JSON.stringify([
      { id: 'legacy-1', role: 'user', content: 'legacy private text', createdAt: '2026-06-01T00:00:00Z' },
      { id: 'legacy-2', role: 'assistant', content: 'legacy answer', createdAt: '2026-06-02T00:00:00Z' },
    ]),
  }, {
    now: '2026-06-19T12:00:00.000Z',
  })

  assert.equal(legacyOnly.status, 'needs_review')
  assert.equal(legacyOnly.migrationPlan.legacyFlatChatWouldCreateSession, true)
  assert.equal(legacyOnly.migrationPlan.legacyFlatChatIgnoredBecauseSessionsExist, false)
  assert.equal(legacyOnly.totals.sessionCount, 1)
  assert.equal(legacyOnly.totals.messageCount, 2)
  assert.ok(legacyOnly.issues.some((item) => item.code === 'legacy-flat-chat-present'))
  assert.equal(JSON.stringify(legacyOnly).includes('legacy private text'), false)

  const sessionsAndLegacy = buildChatStorageMigrationDryRun({
    sessionsRaw: JSON.stringify([{
      id: 'session-1',
      startedAt: '2026-06-03T00:00:00Z',
      lastActiveAt: '2026-06-03T00:00:00Z',
      messages: [{ id: 'm1', role: 'user', content: 'session text', createdAt: '2026-06-03T00:00:00Z' }],
    }]),
    legacyRaw: JSON.stringify([
      { id: 'legacy-1', role: 'user', content: 'legacy private text', createdAt: '2026-06-01T00:00:00Z' },
    ]),
  })

  assert.equal(sessionsAndLegacy.migrationPlan.legacyFlatChatWouldCreateSession, false)
  assert.equal(sessionsAndLegacy.migrationPlan.legacyFlatChatIgnoredBecauseSessionsExist, true)
  assert.equal(sessionsAndLegacy.totals.sessionCount, 1)
  assert.equal(sessionsAndLegacy.totals.messageCount, 1)
})

test('chat migration dry-run reports malformed json and normalization losses', () => {
  const invalid = buildChatStorageMigrationDryRun({
    sessionsRaw: '{not json',
    legacyRaw: null,
  })

  assert.equal(invalid.status, 'blocked')
  assert.equal(invalid.migrationPlan.nextStep, 'repair-localStorage')
  assert.ok(invalid.issues.some((item) => item.code === 'sessions-json-invalid' && item.severity === 'error'))

  const normalized = buildChatStorageMigrationDryRun({
    sessionsRaw: JSON.stringify([
      {
        id: 'session-1',
        startedAt: '2026-06-03T00:00:00Z',
        lastActiveAt: '2026-06-03T00:00:00Z',
        messages: [
          { id: 'm1', role: 'user', content: 'keep me', createdAt: '2026-06-03T00:00:00Z' },
          { id: 'bad', role: 'bot', content: 'drop me', createdAt: '2026-06-03T00:00:00Z' },
        ],
      },
    ]),
    legacyRaw: null,
  })

  assert.equal(normalized.status, 'needs_review')
  assert.ok(normalized.issues.some((item) => item.code === 'sessions-normalized'))
  assert.ok(normalized.issues.some((item) => item.code === 'message-records-would-be-capped-or-dropped'))
  assert.equal(normalized.totals.messageCount, 1)
  assert.equal(JSON.stringify(normalized).includes('drop me'), false)
})

test('chat migration preview summary is feature-gated and content-free', () => {
  assert.equal(isChatMigrationPreviewEnabled(undefined), false)
  assert.equal(isChatMigrationPreviewEnabled({ VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION_UI: '1' }), true)
  assert.equal(isChatMigrationPreviewEnabled({ VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION_UI: 'true' }), false)

  const report = buildChatStorageMigrationDryRun({
    sessionsRaw: JSON.stringify([
      {
        id: 'secret-session-id',
        title: 'private project codename',
        startedAt: '2026-06-01T10:00:00.000Z',
        lastActiveAt: '2026-06-01T10:02:00.000Z',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'private launch plan',
            createdAt: '2026-06-01T10:00:00.000Z',
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'private answer',
            createdAt: '2026-06-01T10:02:00.000Z',
            reasoning_content: 'private reasoning trace',
            toolResult: {
              kind: 'open_external',
              result: { url: 'https://secret.example.test' },
            },
          },
        ],
      },
    ]),
    legacyRaw: null,
  }, {
    now: '2026-06-19T12:00:00.000Z',
  })

  const disabled = buildChatMigrationPreviewSummary(report)
  assert.equal(disabled.enabled, false)
  assert.equal(disabled.canApply, false)
  assert.equal(disabled.canExportBackup, false)

  const enabled = buildChatMigrationPreviewSummary(report, {
    VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION_UI: '1',
  })
  assert.equal(enabled.enabled, true)
  assert.equal(enabled.canApply, true)
  assert.equal(enabled.canExportBackup, true)
  assert.equal(enabled.sessionCount, 1)
  assert.equal(enabled.messageCount, 2)
  assert.equal(enabled.toolResultMessageCount, 1)
  assert.equal(enabled.reasoningMessageCount, 1)
  assert.equal(enabled.safety.dryRunWritesRecords, false)
  assert.equal(enabled.safety.includesMessageContent, false)

  const serialized = JSON.stringify(enabled)
  assert.equal(serialized.includes('private project codename'), false)
  assert.equal(serialized.includes('private launch plan'), false)
  assert.equal(serialized.includes('private reasoning trace'), false)
  assert.equal(serialized.includes('secret.example.test'), false)
  assert.equal(serialized.includes('secret-session-id'), false)
})

test('chat migration preview summary blocks unsafe dry-run states', () => {
  const blocked = buildChatMigrationPreviewSummary(buildChatStorageMigrationDryRun({
    sessionsRaw: '{not json',
    legacyRaw: null,
  }), {
    VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION_UI: '1',
  })

  assert.equal(blocked.enabled, true)
  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.tone, 'error')
  assert.equal(blocked.canApply, false)
  assert.equal(blocked.canExportBackup, false)
  assert.equal(blocked.issueCounts.error, 1)

  const empty = buildChatMigrationPreviewSummary(buildChatStorageMigrationDryRun({
    sessionsRaw: null,
    legacyRaw: null,
  }), {
    VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION_UI: '1',
  })
  assert.equal(empty.status, 'empty')
  assert.equal(empty.canApply, false)
  assert.equal(empty.canExportBackup, false)
})

test('chat migration backup envelope is content-explicit and file-name safe', () => {
  const packageResult = buildChatStorageMigrationPackage({
    sessionsRaw: JSON.stringify([
      {
        id: 'session-1',
        title: 'private project codename',
        startedAt: '2026-06-01T10:00:00.000Z',
        lastActiveAt: '2026-06-01T10:02:00.000Z',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'private launch plan',
            createdAt: '2026-06-01T10:00:00.000Z',
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'private answer',
            createdAt: '2026-06-01T10:02:00.000Z',
          },
        ],
      },
    ]),
    legacyRaw: null,
  }, {
    now: '2026-06-19T12:00:00.000Z',
  })
  assert.equal(packageResult.ok, true)
  if (!packageResult.ok) throw new Error('expected migration package')

  const envelope = buildChatMigrationBackupEnvelope(packageResult.migrationPackage, {
    now: '2026-06-19T12:34:56.789Z',
  })

  assert.equal(envelope.format, 'nexus-chat-migration-backup')
  assert.equal(envelope.schemaVersion, 1)
  assert.equal(envelope.includesMessageContent, true)
  assert.equal(envelope.warning, 'This backup contains full chat message content.')
  assert.equal(envelope.exportedAt, '2026-06-19T12:34:56.789Z')
  assert.equal(envelope.totals.sessionCount, 1)
  assert.equal(envelope.totals.messageCount, 2)
  assert.equal(envelope.totals.dryRunStatus, 'needs_review')
  assert.equal(envelope.totals.payloadBytes > 0, true)
  assert.equal(envelope.migrationPackage.sessions[0].messages[0].content, 'private launch plan')

  const metadataOnly = JSON.stringify({
    format: envelope.format,
    totals: envelope.totals,
    source: envelope.source,
  })
  assert.equal(metadataOnly.includes('private launch plan'), false)
  assert.equal(metadataOnly.includes('private project codename'), false)
  assert.equal(buildChatMigrationBackupFileName(envelope.exportedAt), 'nexus-chat-migration-backup-2026-06-19T12-34-56-789Z.json')
})

test('chat migration comparison source strips chat text and titles', () => {
  const packageResult = buildChatStorageMigrationPackage({
    sessionsRaw: JSON.stringify([
      {
        id: 'session-private-1',
        startedAt: Date.parse('2026-06-01T10:00:00.000Z'),
        lastActiveAt: Date.parse('2026-06-01T10:02:00.000Z'),
        title: 'private comparison title',
        messages: [
          {
            id: 'msg-private-1',
            role: 'user',
            content: 'private comparison body',
            createdAt: '2026-06-01T10:00:00.000Z',
          },
        ],
      },
    ]),
    legacyRaw: null,
  }, {
    now: '2026-06-19T12:00:00.000Z',
  })
  assert.equal(packageResult.ok, true)
  if (!packageResult.ok) throw new Error('expected migration package')

  const source = buildChatMigrationComparisonSource(packageResult.migrationPackage)
  assert.deepEqual(source.source, {
    sessionsKeyPresent: true,
    legacyFlatChatKeyPresent: false,
    legacyFlatChatUsed: false,
  })
  assert.equal(source.sessions.length, 1)
  assert.equal(source.sessions[0].id, 'session-private-1')
  assert.equal(source.sessions[0].messageCount, 1)
  assert.equal(source.sessions[0].payloadBytes > 0, true)
  assert.equal(JSON.stringify(source).includes('private comparison body'), false)
  assert.equal(JSON.stringify(source).includes('private comparison title'), false)
})
