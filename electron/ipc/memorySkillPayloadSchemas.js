// @ts-check
import { validateIpcPayload } from './schemaValidator.js'
import {
  BODY_TEXT_MAX,
  PATH_TEXT_MAX,
  SAFE_SKILL_ID_PATTERN,
  SHORT_TEXT_MAX,
} from './payloadSchemaPrimitives.js'

/**
 * @typedef {Object} MemoryIndexPayload
 * @property {string} id
 * @property {string} content
 * @property {number[]} embedding
 * @property {string} [layer]
 * @property {string} [model]
 */

/**
 * @typedef {Object} MemoryVectorSearchPayload
 * @property {number[]} queryEmbedding
 * @property {number} [limit]
 * @property {number} [threshold]
 * @property {string} [layer]
 * @property {string} [model]
 */

/**
 * @typedef {Object} MemoryKeywordSearchPayload
 * @property {string} query
 * @property {number} [limit]
 * @property {number} [threshold]
 * @property {string} [layer]
 */

/**
 * @typedef {Object} MemoryHybridSearchPayload
 * @property {number[]} queryEmbedding
 * @property {string} queryText
 * @property {number} [limit]
 * @property {number} [threshold]
 * @property {string} [layer]
 * @property {string} [model]
 */

/**
 * @typedef {Object} MemoryOllamaEmbedPayload
 * @property {string} [baseUrl]
 * @property {string} model
 * @property {string[]} input
 * @property {number} [timeoutMs]
 */

/**
 * @typedef {Object} SkillSavePayload
 * @property {string} id
 * @property {string} title
 * @property {string} trigger
 * @property {string} summary
 * @property {string} content
 */

const embeddingArraySchema = {
  type: 'array',
  maxItems: 8_192,
  items: { type: 'number', min: -100, max: 100 },
}

const memoryLayerSchema = { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX }
// Embedding model id the vector was produced with. Lets the store skip
// vectors from a different model instead of comparing incompatible spaces.
const memoryEmbeddingModelSchema = { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX }

const memoryIndexSchema = {
  type: 'object',
  fields: {
    id: { type: 'string', maxLength: SHORT_TEXT_MAX },
    content: { type: 'string', maxLength: BODY_TEXT_MAX },
    embedding: embeddingArraySchema,
    layer: memoryLayerSchema,
    model: memoryEmbeddingModelSchema,
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
    model: memoryEmbeddingModelSchema,
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
    model: memoryEmbeddingModelSchema,
  },
}

const memoryOllamaEmbedSchema = {
  type: 'object',
  fields: {
    baseUrl: { type: 'string', optional: true, maxLength: PATH_TEXT_MAX },
    model: { type: 'string', maxLength: SHORT_TEXT_MAX, allowEmpty: false },
    input: {
      type: 'array',
      maxItems: 64,
      items: { type: 'string', maxLength: BODY_TEXT_MAX },
    },
    timeoutMs: { type: 'number', optional: true },
  },
}

const memoryClearUserDataSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    needles: {
      type: 'array',
      optional: true,
      maxItems: 2_000,
      items: { type: 'string', maxLength: BODY_TEXT_MAX },
    },
  },
}

const longTermMemorySaveSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    memories: {
      type: 'array',
      maxItems: 5_000,
      items: { type: 'object', unknown: 'preserve' },
    },
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
  unknown: 'reject',
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
  unknown: 'reject',
  fields: {
    servers: {
      type: 'array',
      optional: true,
      default: [],
      maxItems: 32,
      items: {
        type: 'object',
        unknown: 'reject',
        fields: {
          id: { type: 'string', maxLength: SHORT_TEXT_MAX },
          label: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
          command: { type: 'string', maxLength: PATH_TEXT_MAX },
          args: { type: 'string', optional: true, maxLength: PATH_TEXT_MAX },
          enabled: { type: 'boolean' },
          env: { type: 'any', optional: true },
        },
      },
    },
  },
}

/** @param {unknown} payload @returns {MemoryIndexPayload} */
export function validateMemoryVectorIndexPayload(payload) {
  return /** @type {MemoryIndexPayload} */ (validateIpcPayload('memory:vector-index', payload, memoryIndexSchema))
}

/** @param {unknown} payload @returns {MemoryIndexPayload[]} */
export function validateMemoryVectorIndexBatchPayload(payload) {
  return /** @type {MemoryIndexPayload[]} */ (validateIpcPayload('memory:vector-index-batch', payload, memoryIndexBatchSchema))
}

/** @param {unknown} payload @returns {MemoryVectorSearchPayload} */
export function validateMemoryVectorSearchPayload(payload) {
  return /** @type {MemoryVectorSearchPayload} */ (validateIpcPayload('memory:vector-search', payload, memoryVectorSearchSchema))
}

/** @param {unknown} payload @returns {MemoryKeywordSearchPayload} */
export function validateMemoryKeywordSearchPayload(payload) {
  return /** @type {MemoryKeywordSearchPayload} */ (validateIpcPayload('memory:keyword-search', payload, memoryKeywordSearchSchema))
}

/** @param {unknown} payload @returns {MemoryHybridSearchPayload} */
export function validateMemoryHybridSearchPayload(payload) {
  return /** @type {MemoryHybridSearchPayload} */ (validateIpcPayload('memory:hybrid-search', payload, memoryHybridSearchSchema))
}

const memoryOllamaDetectSchema = {
  type: 'object',
  fields: {
    baseUrl: { type: 'string', optional: true, maxLength: PATH_TEXT_MAX },
    model: { type: 'string', maxLength: SHORT_TEXT_MAX, allowEmpty: false },
    timeoutMs: { type: 'number', optional: true },
  },
}

const OLLAMA_TIMEOUT_MIN_MS = 500
const OLLAMA_TIMEOUT_MAX_MS = 30_000

/**
 * A renderer-supplied timeout is advisory: clamp it so a stuck or hostile
 * caller cannot hold the main process on a request for minutes.
 * @template {{ timeoutMs?: number }} T
 * @param {T | null | undefined} payload
 * @returns {T | null | undefined}
 */
function clampOllamaTimeout(payload) {
  if (!payload || payload.timeoutMs === undefined) return payload
  return {
    ...payload,
    timeoutMs: Math.min(OLLAMA_TIMEOUT_MAX_MS, Math.max(OLLAMA_TIMEOUT_MIN_MS, payload.timeoutMs)),
  }
}

/**
 * @param {unknown} payload
 * @returns {{ baseUrl?: string, model: string, timeoutMs?: number }}
 */
export function validateMemoryOllamaDetectPayload(payload) {
  return /** @type {{ baseUrl?: string, model: string, timeoutMs?: number }} */ (clampOllamaTimeout(
    /** @type {{ baseUrl?: string, model: string, timeoutMs?: number } | null | undefined} */ (
      validateIpcPayload('memory:ollama-detect', payload, memoryOllamaDetectSchema)
    ),
  ))
}

/**
 * @param {unknown} payload
 * @returns {MemoryOllamaEmbedPayload}
 */
export function validateMemoryOllamaEmbedPayload(payload) {
  return /** @type {MemoryOllamaEmbedPayload} */ (clampOllamaTimeout(/** @type {MemoryOllamaEmbedPayload | null | undefined} */ (
    validateIpcPayload('memory:ollama-embed', payload, memoryOllamaEmbedSchema)
  )))
}

/** @param {unknown} payload @returns {{ id?: string, ids?: string[] }} */
export function validateMemoryRemovePayload(payload) {
  return /** @type {{ id?: string, ids?: string[] }} */ (validateIpcPayload('memory:vector-remove', payload, memoryRemoveSchema))
}

/** @param {unknown} payload @returns {{ needles?: string[] }} */
export function validateMemoryClearUserDataPayload(payload) {
  return /** @type {{ needles?: string[] }} */ (validateIpcPayload('memory:clear-user-data', payload, memoryClearUserDataSchema))
}

/** @param {unknown} payload @returns {{ memories: Array<Record<string, unknown>> }} */
export function validateMemoryLongTermSavePayload(payload) {
  return /** @type {{ memories: Array<Record<string, unknown>> }} */ (validateIpcPayload('memory:long-term-save', payload, longTermMemorySaveSchema))
}

/** @param {unknown} payload @returns {SkillSavePayload} */
export function validateSkillSavePayload(payload) {
  return /** @type {SkillSavePayload} */ (validateIpcPayload('skill:save', payload, skillSaveSchema))
}

/** @param {unknown} payload @returns {{ query: string, limit?: number }} */
export function validateSkillSearchPayload(payload) {
  return /** @type {{ query: string, limit?: number }} */ (validateIpcPayload('skill:search', payload, skillSearchSchema))
}

/**
 * @param {string} channel
 * @param {unknown} payload
 * @returns {{ id: string }}
 */
export function validateSkillIdPayload(channel, payload) {
  return /** @type {{ id: string }} */ (validateIpcPayload(channel, payload, skillIdSchema))
}

/**
 * @param {string} channel
 * @param {unknown} payload
 * @returns {{ id?: string }}
 */
export function validateMcpIdPayload(channel, payload) {
  return /** @type {{ id?: string }} */ (validateIpcPayload(channel, payload, mcpIdSchema))
}

/**
 * @param {unknown} payload
 * @returns {{ serverId?: string, name: string, arguments?: unknown }}
 */
export function validateMcpCallToolPayload(payload) {
  return /** @type {{ serverId?: string, name: string, arguments?: unknown }} */ (validateIpcPayload('mcp:call-tool', payload, mcpCallToolSchema))
}

/**
 * @param {unknown} payload
 * @returns {{ servers: Array<{ id: string, label?: string, command: string, args?: string, enabled: boolean, env?: unknown }> }}
 */
export function validateMcpSyncServersPayload(payload) {
  return /** @type {{ servers: Array<{ id: string, label?: string, command: string, args?: string, enabled: boolean, env?: unknown }> }} */ (
    validateIpcPayload('mcp:sync-servers', payload, mcpSyncServersSchema)
  )
}
