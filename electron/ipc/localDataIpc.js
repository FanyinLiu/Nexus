import { ipcMain } from 'electron'
import {
  applyChatLocalDataMigration,
  compareChatLocalDataSessions,
  getChatLocalDataMigrationStatus,
  getLocalDataStatus,
  mirrorChatLocalDataSession,
  mirrorLocalDataOnboardingState,
  readChatLocalDataSessions,
  rollbackChatLocalDataMigration,
} from '../services/localDataStore.js'
import {
  applyMemoryLocalDataMigration,
  getMemoryLocalDataMigrationStatus,
  readMemoryLocalData,
  rollbackMemoryLocalDataMigration,
} from '../services/localDataMemoryStore.js'
import {
  applyCompanionLocalDataMigration,
  compareCompanionLocalData,
  getCompanionLocalDataMigrationStatus,
  mirrorCompanionLocalDataDataset,
  readCompanionLocalData,
  rollbackCompanionLocalDataMigration,
} from '../services/localDataCompanionMigration.js'
import {
  validateLocalDataChatComparisonPayload,
  validateLocalDataChatMigrationApplyPayload,
  validateLocalDataChatMigrationRollbackPayload,
  validateLocalDataChatRuntimeMirrorPayload,
  validateLocalDataMemoryMigrationApplyPayload,
  validateLocalDataMemoryMigrationRollbackPayload,
  validateLocalDataCompanionDatasetMirrorPayload,
  validateLocalDataCompanionComparisonPayload,
  validateLocalDataCompanionMigrationApplyPayload,
  validateLocalDataCompanionMigrationRollbackPayload,
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

function memoryMigrationIpcEnabled() {
  return process.env.NEXUS_ENABLE_LOCAL_DATA_MEMORY_MIGRATION === '1'
}

function memoryMigrationDisabledResult(action) {
  const targetDomainIds = ['memory-long-term', 'memory-daily']
  if (action === 'status') {
    return {
      ok: false,
      targetDomainIds,
      schemaVersion: 0,
      longTermRecordCount: 0,
      dailyEntryCount: 0,
      recordPayloadsIncluded: false,
      lastAuditRecordId: null,
      lastAuditAction: null,
      lastAuditAt: null,
      errorKind: 'local-data-memory-migration-ipc-disabled',
      errorMessage: 'Memory migration IPC is disabled.',
    }
  }
  if (action === 'read') {
    return {
      ok: false,
      targetDomainIds,
      schemaVersion: 0,
      recordPayloadsIncluded: true,
      longTermRecordCount: 0,
      dailyEntryCount: 0,
      malformedRecordCount: 0,
      memories: [],
      daily: [],
      errorKind: 'local-data-memory-migration-ipc-disabled',
      errorMessage: 'Memory migration IPC is disabled.',
    }
  }
  const base = {
    ok: false,
    targetDomainIds,
    auditRecordId: null,
    errorKind: 'local-data-memory-migration-ipc-disabled',
    errorMessage: 'Memory migration IPC is disabled.',
  }
  return action === 'rollback'
    ? { ...base, recordsDeleted: 0 }
    : { ...base, applied: false, recordsWritten: 0 }
}

function companionMigrationIpcEnabled() {
  return process.env.NEXUS_ENABLE_LOCAL_DATA_COMPANION_MIGRATION === '1'
}

function companionMigrationDisabledResult(action) {
  const targetDomainIds = ['companion-relationship', 'companion-tasks']
  const base = {
    ok: false,
    targetDomainIds,
    schemaVersion: 0,
    errorKind: 'local-data-companion-migration-ipc-disabled',
    errorMessage: 'Companion migration IPC is disabled.',
  }
  if (action === 'status') return { ...base, relationshipDatasetCount: 0, taskDatasetCount: 0, totalRecordCount: 0, payloadBytes: 0, recordPayloadsIncluded: false, lastAuditRecordId: null, lastAuditAction: null, lastAuditAt: null }
  if (action === 'read') return { ...base, recordPayloadsIncluded: true, relationship: [], tasks: [], malformedRecordCount: 0 }
  if (action === 'compare') return {
    ...base,
    compared: false,
    recordPayloadsIncluded: false,
    status: 'blocked',
    sourceDatasetCount: 0,
    sqliteDatasetCount: 0,
    matchedDatasetCount: 0,
    metadataMismatchCount: 0,
    missingSqliteDatasetCount: 0,
    extraSqliteDatasetCount: 0,
    malformedSqliteRecordCount: 0,
    sourceRecordCount: 0,
    sqliteRecordCount: 0,
    sourcePayloadBytes: 0,
    sqlitePayloadBytes: 0,
    issueCodes: [],
    auditRecordId: null,
  }
  if (action === 'mirror') return { ...base, mirrored: false }
  if (action === 'rollback') return { ...base, recordsDeleted: 0, auditRecordId: null }
  return { ...base, applied: false, recordsWritten: 0, auditRecordId: null }
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

  ipcMain.handle('local-data:chat-sessions-read', async (event) => {
    requireTrustedSender(event)
    if (!chatMigrationIpcEnabled()) {
      return {
        ok: false,
        targetDomainId: 'chat-sessions',
        schemaVersion: 0,
        recordPayloadsIncluded: true,
        recordCount: 0,
        validSessionCount: 0,
        messageCount: 0,
        malformedRecordCount: 0,
        sessions: [],
        errorKind: 'local-data-chat-migration-ipc-disabled',
        errorMessage: 'Chat migration IPC is disabled.',
      }
    }
    return readChatLocalDataSessions()
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

  ipcMain.handle('local-data:memory-migration-status', async (event) => {
    requireTrustedSender(event)
    if (!memoryMigrationIpcEnabled()) return memoryMigrationDisabledResult('status')
    return getMemoryLocalDataMigrationStatus()
  })

  ipcMain.handle('local-data:memory-read', async (event) => {
    requireTrustedSender(event)
    if (!memoryMigrationIpcEnabled()) return memoryMigrationDisabledResult('read')
    return readMemoryLocalData()
  })

  ipcMain.handle('local-data:memory-migration-apply', async (event, payload) => {
    requireTrustedSender(event)
    const validated = validateLocalDataMemoryMigrationApplyPayload(payload)
    if (!memoryMigrationIpcEnabled()) return memoryMigrationDisabledResult('apply')
    return applyMemoryLocalDataMigration({
      migrationPackage: validated.migrationPackage,
      confirmed: validated.confirmed,
    })
  })

  ipcMain.handle('local-data:memory-migration-rollback', async (event, payload) => {
    requireTrustedSender(event)
    const validated = validateLocalDataMemoryMigrationRollbackPayload(payload)
    if (!memoryMigrationIpcEnabled()) return memoryMigrationDisabledResult('rollback')
    return rollbackMemoryLocalDataMigration({
      confirmed: validated.confirmed,
    })
  })

  ipcMain.handle('local-data:companion-migration-status', async (event) => {
    requireTrustedSender(event)
    if (!companionMigrationIpcEnabled()) return companionMigrationDisabledResult('status')
    return getCompanionLocalDataMigrationStatus()
  })

  ipcMain.handle('local-data:companion-read', async (event) => {
    requireTrustedSender(event)
    if (!companionMigrationIpcEnabled()) return companionMigrationDisabledResult('read')
    return readCompanionLocalData()
  })

  ipcMain.handle('local-data:companion-comparison-preview', async (event, payload) => {
    requireTrustedSender(event)
    const validated = validateLocalDataCompanionComparisonPayload(payload)
    if (!companionMigrationIpcEnabled()) return companionMigrationDisabledResult('compare')
    return compareCompanionLocalData({
      confirmed: validated.confirmed,
      source: validated.source,
    })
  })

  ipcMain.handle('local-data:companion-dataset-mirror', async (event, payload) => {
    requireTrustedSender(event)
    const validated = validateLocalDataCompanionDatasetMirrorPayload(payload)
    if (!companionMigrationIpcEnabled()) return companionMigrationDisabledResult('mirror')
    return mirrorCompanionLocalDataDataset({
      confirmed: validated.confirmed,
      storageKey: validated.storageKey,
      value: validated.value,
    })
  })

  ipcMain.handle('local-data:companion-migration-apply', async (event, payload) => {
    requireTrustedSender(event)
    const validated = validateLocalDataCompanionMigrationApplyPayload(payload)
    if (!companionMigrationIpcEnabled()) return companionMigrationDisabledResult('apply')
    return applyCompanionLocalDataMigration({
      migrationPackage: validated.migrationPackage,
      confirmed: validated.confirmed,
    })
  })

  ipcMain.handle('local-data:companion-migration-rollback', async (event, payload) => {
    requireTrustedSender(event)
    const validated = validateLocalDataCompanionMigrationRollbackPayload(payload)
    if (!companionMigrationIpcEnabled()) return companionMigrationDisabledResult('rollback')
    return rollbackCompanionLocalDataMigration({ confirmed: validated.confirmed })
  })
}
