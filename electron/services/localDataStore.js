/**
 * Local-data store public API.
 * Implementation is split by domain:
 *   - localDataStoreCore.js  — SQLite foundation, onboarding mirror, export/import
 *   - localDataChatStore.js  — chat session migration / compare / runtime mirror
 * Memory and companion domains live in their own modules already.
 */
export {
  LOCAL_DATA_BACKEND,
  LOCAL_DATA_SCHEMA_VERSION,
  LOCAL_DATA_MANIFEST_FORMAT,
  LOCAL_DATA_EXPORT_FORMAT,
  LOCAL_DATA_ONBOARDING_DOMAIN_ID,
  LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
  LOCAL_DATA_MEMORY_LONG_TERM_DOMAIN_ID,
  LOCAL_DATA_MEMORY_DAILY_DOMAIN_ID,
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
  getLocalDataMigrationPlan,
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
