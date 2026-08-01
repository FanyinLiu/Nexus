/**
 * Local-data store public API.
 * Implementation is split by domain:
 *   - localDataStoreCore.js  — SQLite foundation, onboarding mirror, export/import
 *   - localDataChatStore.js  — chat session migration / compare / runtime mirror
 * Memory and companion domains live in their own modules already.
 */
export {
  LOCAL_DATA_COMPANION_RELATIONSHIP_DOMAIN_ID,
  LOCAL_DATA_COMPANION_TASKS_DOMAIN_ID,
  LOCAL_DATA_AUDIT_DOMAIN_ID,
  resolveLocalDataPaths,
  normalizeOnboardingMirrorState,
  getLocalDataStatus,
  initializeLocalDataStore,
  readLocalDataManifest,
  readLocalDataSqliteState,
  readLocalDataDomainRecords,
  buildLocalDataExportSnapshot,
  mirrorLocalDataOnboardingState,
  planLocalDataImport,
  importLocalDataSnapshot,
  rollbackLocalDataStore,
} from './localDataStoreCore.js'

export {
  planChatLocalDataMigration,
  applyChatLocalDataMigration,
  rollbackChatLocalDataMigration,
  getChatLocalDataMigrationStatus,
  readChatLocalDataSessions,
  compareChatLocalDataSessions,
  mirrorChatLocalDataSession,
} from './localDataChatStore.js'
