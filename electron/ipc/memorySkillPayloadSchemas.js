import { validateIpcPayload } from './schemaValidator.js'
import {
  BODY_TEXT_MAX,
  PATH_TEXT_MAX,
  SAFE_SKILL_ID_PATTERN,
  SHORT_TEXT_MAX,
} from './payloadSchemaPrimitives.js'

const embeddingArraySchema = {
  type: 'array',
  maxItems: 8_192,
  items: { type: 'number', min: -100, max: 100 },
}

const memoryLayerSchema = { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX }

const memoryIndexSchema = {
  type: 'object',
  fields: {
    id: { type: 'string', maxLength: SHORT_TEXT_MAX },
    content: { type: 'string', maxLength: BODY_TEXT_MAX },
    embedding: embeddingArraySchema,
    layer: memoryLayerSchema,
  },
}

const memoryIndexBatchSchema = {
  type: 'array',
  maxItems: 2_000,
  items: memoryIndexSchema,
}

const memoryVectorSearchSchema = {
  type: 'object',
  fields: {
    queryEmbedding: embeddingArraySchema,
    limit: { type: 'number', optional: true, min: 1, max: 2_000 },
    threshold: { type: 'number', optional: true, min: 0, max: 1 },
    layer: memoryLayerSchema,
  },
}

const memoryKeywordSearchSchema = {
  type: 'object',
  fields: {
    query: { type: 'string', maxLength: 2_000 },
    limit: { type: 'number', optional: true, min: 1, max: 2_000 },
    threshold: { type: 'number', optional: true, min: 0, max: 1 },
    layer: memoryLayerSchema,
  },
}

const memoryHybridSearchSchema = {
  type: 'object',
  fields: {
    queryEmbedding: embeddingArraySchema,
    queryText: { type: 'string', maxLength: 2_000 },
    limit: { type: 'number', optional: true, min: 1, max: 2_000 },
    threshold: { type: 'number', optional: true, min: 0, max: 1 },
    layer: memoryLayerSchema,
  },
}

const memoryRemoveSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    id: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    ids: {
      type: 'array',
      optional: true,
      maxItems: 1_000,
      items: { type: 'string', maxLength: SHORT_TEXT_MAX },
    },
  },
}

const skillIdFieldSchema = {
  type: 'string',
  maxLength: SHORT_TEXT_MAX,
  trim: true,
  allowEmpty: false,
  pattern: SAFE_SKILL_ID_PATTERN,
}

const skillSaveSchema = {
  type: 'object',
  fields: {
    id: skillIdFieldSchema,
    title: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
    trigger: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
    summary: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
    content: { type: 'string', maxLength: BODY_TEXT_MAX, trim: true, allowEmpty: false },
  },
}

const skillSearchSchema = {
  type: 'object',
  fields: {
    query: { type: 'string', maxLength: 2_000, trim: true, allowEmpty: false },
    limit: { type: 'number', optional: true, integer: true, min: 1, max: 20 },
  },
}

const skillIdSchema = {
  type: 'object',
  fields: {
    id: skillIdFieldSchema,
  },
}

const mcpIdSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    id: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
  },
}

const mcpCallToolSchema = {
  type: 'object',
  fields: {
    serverId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    name: { type: 'string', maxLength: SHORT_TEXT_MAX },
    arguments: { type: 'any', optional: true },
  },
}

const mcpSyncServersSchema = {
  type: 'object',
  optional: true,
  default: { servers: [] },
  fields: {
    servers: {
      type: 'array',
      optional: true,
      default: [],
      maxItems: 32,
      items: {
        type: 'object',
        fields: {
          id: { type: 'string', maxLength: SHORT_TEXT_MAX },
          label: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
          command: { type: 'string', maxLength: PATH_TEXT_MAX },
          args: { type: 'string', optional: true, maxLength: PATH_TEXT_MAX },
          enabled: { type: 'boolean' },
        },
      },
    },
  },
}

export function validateMemoryVectorIndexPayload(payload) {
  return validateIpcPayload('memory:vector-index', payload, memoryIndexSchema)
}

export function validateMemoryVectorIndexBatchPayload(payload) {
  return validateIpcPayload('memory:vector-index-batch', payload, memoryIndexBatchSchema)
}

export function validateMemoryVectorSearchPayload(payload) {
  return validateIpcPayload('memory:vector-search', payload, memoryVectorSearchSchema)
}

export function validateMemoryKeywordSearchPayload(payload) {
  return validateIpcPayload('memory:keyword-search', payload, memoryKeywordSearchSchema)
}

export function validateMemoryHybridSearchPayload(payload) {
  return validateIpcPayload('memory:hybrid-search', payload, memoryHybridSearchSchema)
}

export function validateMemoryRemovePayload(payload) {
  return validateIpcPayload('memory:vector-remove', payload, memoryRemoveSchema)
}

export function validateSkillSavePayload(payload) {
  return validateIpcPayload('skill:save', payload, skillSaveSchema)
}

export function validateSkillSearchPayload(payload) {
  return validateIpcPayload('skill:search', payload, skillSearchSchema)
}

export function validateSkillIdPayload(channel, payload) {
  return validateIpcPayload(channel, payload, skillIdSchema)
}

export function validateMcpIdPayload(channel, payload) {
  return validateIpcPayload(channel, payload, mcpIdSchema)
}

export function validateMcpCallToolPayload(payload) {
  return validateIpcPayload('mcp:call-tool', payload, mcpCallToolSchema)
}

export function validateMcpSyncServersPayload(payload) {
  return validateIpcPayload('mcp:sync-servers', payload, mcpSyncServersSchema)
}
