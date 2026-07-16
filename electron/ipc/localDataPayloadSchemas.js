import { validateIpcPayload } from './schemaValidator.js'
import {
  CHAT_MESSAGE_TEXT_MAX,
  SHORT_TEXT_MAX,
} from './payloadSchemaPrimitives.js'

const localDataOnboardingStateSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    completedAt: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    firstConversationAt: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    firstConversationElapsedMs: { type: 'number', optional: true, integer: true, min: 0, max: 86_400_000 },
  },
}

const localDataOnboardingMirrorSchema = {
  type: 'object',
  optional: true,
  default: {},
  unknown: 'reject',
  fields: {
    state: {
      ...localDataOnboardingStateSchema,
      optional: true,
    },
  },
}

const localDataChatMigrationMessageSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    id: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    role: { type: 'enum', values: ['user', 'assistant', 'system'] },
    content: { type: 'string', maxLength: CHAT_MESSAGE_TEXT_MAX, allowEmpty: false },
    createdAt: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    tone: { type: 'enum', optional: true, values: ['neutral', 'error'] },
    reasoning_content: { type: 'string', optional: true, maxLength: CHAT_MESSAGE_TEXT_MAX },
    toolResult: { type: 'any', optional: true },
  },
}

const localDataChatMigrationSessionSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    id: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    startedAt: { type: 'number', min: 0 },
    lastActiveAt: { type: 'number', min: 0 },
    title: { type: 'string', optional: true, maxLength: 80, trim: true, clamp: true },
    messages: {
      type: 'array',
      maxItems: 500,
      items: localDataChatMigrationMessageSchema,
    },
  },
}

const localDataChatMigrationPackageSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    schemaVersion: { type: 'number', integer: true, min: 1, max: 1 },
    createdAt: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    source: {
      type: 'object',
      unknown: 'reject',
      fields: {
        sessionsKeyPresent: { type: 'boolean' },
        legacyFlatChatKeyPresent: { type: 'boolean' },
        legacyFlatChatUsed: { type: 'boolean' },
      },
    },
    dryRunReport: { type: 'any', optional: true },
    sessions: {
      type: 'array',
      maxItems: 30,
      items: localDataChatMigrationSessionSchema,
    },
  },
}

const localDataChatMigrationApplySchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    confirmed: { type: 'boolean' },
    migrationPackage: localDataChatMigrationPackageSchema,
  },
}

const localDataChatMigrationRollbackSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    confirmed: { type: 'boolean' },
  },
}

const localDataChatRuntimeMirrorSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    confirmed: { type: 'boolean' },
    session: localDataChatMigrationSessionSchema,
  },
}

const localDataChatComparisonSessionSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    id: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    startedAt: { type: 'number', min: 0 },
    lastActiveAt: { type: 'number', min: 0 },
    messageCount: { type: 'number', integer: true, min: 0, max: 500 },
    payloadBytes: { type: 'number', integer: true, min: 0, max: 20_000_000 },
  },
}

const localDataChatComparisonSourceSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    schemaVersion: { type: 'number', integer: true, min: 1, max: 1 },
    generatedAt: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    source: {
      type: 'object',
      unknown: 'reject',
      fields: {
        sessionsKeyPresent: { type: 'boolean' },
        legacyFlatChatKeyPresent: { type: 'boolean' },
        legacyFlatChatUsed: { type: 'boolean' },
      },
    },
    sessions: {
      type: 'array',
      maxItems: 30,
      items: localDataChatComparisonSessionSchema,
    },
  },
}

const localDataChatComparisonSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    confirmed: { type: 'boolean' },
    source: localDataChatComparisonSourceSchema,
  },
}

const localDataMemoryEmotionSnapshotSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    energy: { type: 'number', min: 0, max: 1 },
    warmth: { type: 'number', min: 0, max: 1 },
    curiosity: { type: 'number', min: 0, max: 1 },
    concern: { type: 'number', min: 0, max: 1 },
  },
}

const localDataMemoryItemSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    id: { type: 'string', maxLength: 120, trim: true, allowEmpty: false },
    content: { type: 'string', maxLength: 2_000, allowEmpty: false },
    category: { type: 'string', maxLength: 32, trim: true, allowEmpty: false },
    source: { type: 'string', maxLength: 120, trim: true, allowEmpty: false },
    kind: { type: 'string', optional: true, maxLength: 32, trim: true, allowEmpty: false },
    enabled: { type: 'boolean' },
    sourceRef: { type: 'string', optional: true, maxLength: 240, trim: true, allowEmpty: false },
    createdAt: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    lastUsedAt: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    importance: { type: 'string', optional: true, maxLength: 32, trim: true, allowEmpty: false },
    importanceScore: { type: 'number', optional: true, min: 0, max: 2 },
    recallCount: { type: 'number', optional: true, integer: true, min: 0 },
    lastRecalledAt: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    relatedIds: {
      type: 'array',
      optional: true,
      maxItems: 20,
      items: { type: 'string', maxLength: 120, trim: true, allowEmpty: false },
    },
    emotionSnapshot: { ...localDataMemoryEmotionSnapshotSchema, optional: true },
    emotionalValence: { type: 'string', optional: true, maxLength: 32, trim: true, allowEmpty: false },
    significance: { type: 'number', optional: true, min: 0, max: 1 },
    reflectionTopic: { type: 'string', optional: true, maxLength: 120, trim: true, allowEmpty: false },
    reflectionConfidence: { type: 'number', optional: true, min: 0, max: 1 },
  },
}

const localDataMemoryDailyEntrySchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    id: { type: 'string', maxLength: 120, trim: true, allowEmpty: false },
    day: { type: 'string', maxLength: 10, trim: true, allowEmpty: false },
    role: { type: 'enum', values: ['user', 'assistant'] },
    content: { type: 'string', maxLength: 200, allowEmpty: false },
    source: { type: 'enum', values: ['chat', 'voice'] },
    createdAt: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
  },
}

const localDataMemoryMigrationPackageSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    schemaVersion: { type: 'number', integer: true, min: 1, max: 1 },
    createdAt: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    source: {
      type: 'object',
      unknown: 'reject',
      fields: {
        longTermKeyPresent: { type: 'boolean' },
        legacyLongTermKeyPresent: { type: 'boolean' },
        dailyKeyPresent: { type: 'boolean' },
        legacyLongTermUsed: { type: 'boolean' },
      },
    },
    longTerm: { type: 'array', maxItems: 500, items: localDataMemoryItemSchema },
    daily: { type: 'array', maxItems: 10_000, items: localDataMemoryDailyEntrySchema },
  },
}

const localDataMemoryMigrationApplySchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    confirmed: { type: 'boolean' },
    migrationPackage: localDataMemoryMigrationPackageSchema,
  },
}

const localDataMemoryMigrationRollbackSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    confirmed: { type: 'boolean' },
  },
}

const companionStorageKeys = [
  'nexus:autonomy:relationship',
  'nexus:autonomy:relationship-history',
  'nexus:autonomy:emotion',
  'nexus:autonomy:emotion-history',
  'nexus:autonomy:rhythm',
  'nexus:autonomy:user-affect-history',
  'nexus:plans',
  'nexus:open-goals',
  'nexus:agent-traces',
  'nexus:background-tasks',
  'nexus:agent:errands',
  'nexus:reminder-tasks',
]

const localDataCompanionDatasetSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    id: { type: 'string', optional: true, maxLength: 64, trim: true, allowEmpty: false },
    storageKey: { type: 'enum', values: companionStorageKeys },
    value: { type: 'any' },
  },
}

const localDataCompanionMigrationPackageSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    schemaVersion: { type: 'number', integer: true, min: 1, max: 1 },
    createdAt: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    source: { type: 'object', unknown: 'reject', fields: { relationshipKeysPresent: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false } }, taskKeysPresent: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false } }, invalidKeys: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false } } } },
    relationship: { type: 'array', maxItems: 6, items: localDataCompanionDatasetSchema },
    tasks: { type: 'array', maxItems: 6, items: localDataCompanionDatasetSchema },
  },
}

const localDataCompanionMigrationApplySchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    confirmed: { type: 'boolean' },
    migrationPackage: localDataCompanionMigrationPackageSchema,
  },
}

const localDataCompanionDatasetMirrorSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    confirmed: { type: 'boolean' },
    storageKey: { type: 'enum', values: companionStorageKeys },
    value: { type: 'any' },
  },
}

const localDataCompanionComparisonDatasetSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    id: { type: 'string', maxLength: 64, trim: true, allowEmpty: false },
    storageKey: { type: 'enum', values: companionStorageKeys },
    recordCount: { type: 'number', integer: true, min: 0, max: 2_000 },
    payloadBytes: { type: 'number', integer: true, min: 0, max: 2_000_000 },
  },
}

const localDataCompanionComparisonSourceSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    schemaVersion: { type: 'number', integer: true, min: 1, max: 1 },
    generatedAt: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    relationship: { type: 'array', maxItems: 6, items: localDataCompanionComparisonDatasetSchema },
    tasks: { type: 'array', maxItems: 6, items: localDataCompanionComparisonDatasetSchema },
  },
}

const localDataCompanionComparisonSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    confirmed: { type: 'boolean' },
    source: localDataCompanionComparisonSourceSchema,
  },
}

const localDataCompanionMigrationRollbackSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    confirmed: { type: 'boolean' },
  },
}

export function validateLocalDataOnboardingMirrorPayload(payload) {
  return validateIpcPayload('local-data:mirror-onboarding', payload, localDataOnboardingMirrorSchema)
}

export function validateLocalDataChatMigrationApplyPayload(payload) {
  return validateIpcPayload('local-data:chat-migration-apply', payload, localDataChatMigrationApplySchema)
}

export function validateLocalDataChatMigrationRollbackPayload(payload) {
  return validateIpcPayload('local-data:chat-migration-rollback', payload, localDataChatMigrationRollbackSchema)
}

export function validateLocalDataChatRuntimeMirrorPayload(payload) {
  return validateIpcPayload('local-data:chat-session-mirror', payload, localDataChatRuntimeMirrorSchema)
}

export function validateLocalDataChatComparisonPayload(payload) {
  return validateIpcPayload('local-data:chat-comparison-preview', payload, localDataChatComparisonSchema)
}

export function validateLocalDataMemoryMigrationApplyPayload(payload) {
  return validateIpcPayload('local-data:memory-migration-apply', payload, localDataMemoryMigrationApplySchema)
}

export function validateLocalDataMemoryMigrationRollbackPayload(payload) {
  return validateIpcPayload('local-data:memory-migration-rollback', payload, localDataMemoryMigrationRollbackSchema)
}

export function validateLocalDataCompanionMigrationApplyPayload(payload) {
  return validateIpcPayload('local-data:companion-migration-apply', payload, localDataCompanionMigrationApplySchema)
}

export function validateLocalDataCompanionDatasetMirrorPayload(payload) {
  return validateIpcPayload('local-data:companion-dataset-mirror', payload, localDataCompanionDatasetMirrorSchema)
}

export function validateLocalDataCompanionComparisonPayload(payload) {
  return validateIpcPayload('local-data:companion-comparison-preview', payload, localDataCompanionComparisonSchema)
}

export function validateLocalDataCompanionMigrationRollbackPayload(payload) {
  return validateIpcPayload('local-data:companion-migration-rollback', payload, localDataCompanionMigrationRollbackSchema)
}
