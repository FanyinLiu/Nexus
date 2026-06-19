import { ipcMain } from 'electron'
import {
  applyChatLocalDataMigration,
  compareChatLocalDataSessions,
  getChatLocalDataMigrationStatus,
  getLocalDataStatus,
  mirrorChatLocalDataSession,
  mirrorLocalDataOnboardingState,
  rollbackChatLocalDataMigration,
} from '../services/localDataStore.js'
import {
  validateLocalDataChatComparisonPayload,
  validateLocalDataChatMigrationApplyPayload,
  validateLocalDataChatMigrationRollbackPayload,
  validateLocalDataChatRuntimeMirrorPayload,
  validateLocalDataOnboardingMirrorPayload,
} from './payloadSchemas.js'
import { requireTrustedSender } from './validate.js'

function chatMigrationIpcEnabled() {
  return process.env.NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION === '1'
}

function chatMigrationDisabledResult(action) {
  if (action === 'status') {
    return {
      ok: false,
      targetDomainId: 'chat-sessions',
      schemaVersion: 0,
      recordCount: 0,
      messageCount: 0,
      recordPayloadsIncluded: false,
      lastAuditRecordId: null,
      lastAuditAction: null,
      lastAuditAt: null,
      errorKind: 'local-data-chat-migration-ipc-disabled',
      errorMessage: 'Chat migration IPC is disabled.',
    }
  }
  if (action === 'mirror') {
    return {
      ok: false,
      targetDomainId: 'chat-sessions',
      schemaVersion: 0,
      mirrored: false,
      deleted: false,
      recordsWritten: 0,
      recordsDeleted: 0,
      messageCount: 0,
      auditRecordId: null,
      errorKind: 'local-data-chat-migration-ipc-disabled',
      errorMessage: 'Chat migration IPC is disabled.',
    }
  }
  if (action === 'compare') {
    return {
      ok: false,
      targetDomainId: 'chat-sessions',
      schemaVersion: 0,
      compared: false,
      recordPayloadsIncluded: false,
      status: 'blocked',
      sourceSessionCount: 0,
      sqliteSessionCount: 0,
      matchedRecordCount: 0,
      metadataAlignedRecordCount: 0,
      metadataMismatchCount: 0,
      missingSqliteRecordCount: 0,
      extraSqliteRecordCount: 0,
      malformedSqliteRecordCount: 0,
      sourceMessageCount: 0,
      sqliteMessageCount: 0,
      messageCountDelta: 0,
      sourcePayloadBytes: 0,
      sqlitePayloadBytes: 0,
      issueCodes: [],
      auditRecordId: null,
      errorKind: 'local-data-chat-migration-ipc-disabled',
      errorMessage: 'Chat migration IPC is disabled.',
    }
  }

  const base = {
    ok: false,
    targetDomainId: 'chat-sessions',
    auditRecordId: null,
    errorKind: 'local-data-chat-migration-ipc-disabled',
    errorMessage: 'Chat migration IPC is disabled.',
  }
  return action === 'rollback'
    ? { ...base, recordsDeleted: 0 }
    : { ...base, applied: false, recordsWritten: 0 }
}

export function register() {
  ipcMain.handle('local-data:status', (event) => {
    requireTrustedSender(event)
    return getLocalDataStatus()
  })

  ipcMain.handle('local-data:mirror-onboarding', async (event, payload) => {
    requireTrustedSender(event)
    const validated = validateLocalDataOnboardingMirrorPayload(payload)
    return mirrorLocalDataOnboardingState({
      state: validated.state ?? null,
    })
  })

  ipcMain.handle('local-data:chat-migration-status', async (event) => {
    requireTrustedSender(event)
    if (!chatMigrationIpcEnabled()) return chatMigrationDisabledResult('status')
    return getChatLocalDataMigrationStatus()
  })

  ipcMain.handle('local-data:chat-session-mirror', async (event, payload) => {
    requireTrustedSender(event)
    const validated = validateLocalDataChatRuntimeMirrorPayload(payload)
    if (!chatMigrationIpcEnabled()) return chatMigrationDisabledResult('mirror')
    return mirrorChatLocalDataSession({
      session: validated.session,
      confirmed: validated.confirmed,
    })
  })

  ipcMain.handle('local-data:chat-comparison-preview', async (event, payload) => {
    requireTrustedSender(event)
    const validated = validateLocalDataChatComparisonPayload(payload)
    if (!chatMigrationIpcEnabled()) return chatMigrationDisabledResult('compare')
    return compareChatLocalDataSessions({
      source: validated.source,
      confirmed: validated.confirmed,
    })
  })

  ipcMain.handle('local-data:chat-migration-apply', async (event, payload) => {
    requireTrustedSender(event)
    const validated = validateLocalDataChatMigrationApplyPayload(payload)
    if (!chatMigrationIpcEnabled()) return chatMigrationDisabledResult('apply')
    return applyChatLocalDataMigration({
      migrationPackage: validated.migrationPackage,
      confirmed: validated.confirmed,
    })
  })

  ipcMain.handle('local-data:chat-migration-rollback', async (event, payload) => {
    requireTrustedSender(event)
    const validated = validateLocalDataChatMigrationRollbackPayload(payload)
    if (!chatMigrationIpcEnabled()) return chatMigrationDisabledResult('rollback')
    return rollbackChatLocalDataMigration({
      confirmed: validated.confirmed,
    })
  })
}
