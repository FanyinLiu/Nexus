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
