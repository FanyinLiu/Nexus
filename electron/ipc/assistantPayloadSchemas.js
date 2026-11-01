// @ts-check
import { validateIpcPayload } from './schemaValidator.js'
import {
  CHAT_MESSAGE_TEXT_MAX,
  SECRET_TEXT_MAX,
  SHORT_TEXT_MAX,
  URL_TEXT_MAX,
  optionalBoolean,
  optionalShortString,
} from './payloadSchemaPrimitives.js'

/**
 * @typedef {Object} RendererToolPolicy
 * @property {boolean} [enabled]
 * @property {boolean} [requiresConfirmation]
 */

/**
 * @typedef {Object} ChatCompletionPayload
 * @property {string} [providerId]
 * @property {string} baseUrl
 * @property {string} apiKey
 * @property {string} model
 * @property {string} [traceId]
 * @property {string} [requestId]
 * @property {unknown[]} messages
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {unknown[]} [tools]
 */

/**
 * @typedef {Object} ChatModelListPayload
 * @property {string} [providerId]
 * @property {string} baseUrl
 * @property {string} apiKey
 * @property {string} [model]
 */

/**
 * @typedef {Object} ServiceConnectionTestPayload
 * @property {string} [providerId]
 * @property {string} baseUrl
 * @property {string} apiKey
 * @property {'text'|'speech-input'|'speech-output'} capability
 * @property {string} [model]
 * @property {string} [voice]
 */

/**
 * @typedef {Object} WebSearchToolPayload
 * @property {string} query
 * @property {number} [limit]
 * @property {string} [providerId]
 * @property {string} [baseUrl]
 * @property {string} [apiKey]
 * @property {string} [displayQuery]
 * @property {string[]} [keywords]
 * @property {string[]} [candidateQueries]
 * @property {string} [subject]
 * @property {string} [facet]
 * @property {string} [matchProfile]
 * @property {string[]} [strictTerms]
 * @property {string[]} [softTerms]
 * @property {string[]} [phraseTerms]
 * @property {boolean} [fallbackToBing]
 * @property {RendererToolPolicy} [policy]
 */

/**
 * @typedef {Object} WeatherToolPayload
 * @property {string} location
 * @property {string} [fallbackLocation]
 * @property {string} [locale]
 * @property {boolean} [quiet]
 * @property {RendererToolPolicy} [policy]
 */

/**
 * @typedef {Object} ExternalLinkToolPayload
 * @property {string} url
 * @property {RendererToolPolicy} [policy]
 */

const rendererToolPolicySchema = {
  type: 'object',
  optional: true,
  unknown: 'reject',
  fields: {
    enabled: optionalBoolean,
    requiresConfirmation: optionalBoolean,
  },
}

const chatToolCallSchema = {
  type: 'object',
  fields: {
    id: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    type: { type: 'string', optional: true, maxLength: 64 },
    function: {
      type: 'object',
      optional: true,
      fields: {
        name: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
        arguments: { type: 'string', optional: true, maxLength: CHAT_MESSAGE_TEXT_MAX },
      },
    },
  },
}

const chatMessageSchema = {
  type: 'object',
  fields: {
    role: {
      type: 'enum',
      values: ['system', 'user', 'assistant', 'tool'],
    },
    content: { type: 'any' },
    tool_calls: {
      type: 'array',
      optional: true,
      maxItems: 32,
      items: chatToolCallSchema,
    },
    tool_call_id: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    reasoning_content: {
      type: 'string',
      optional: true,
      maxLength: CHAT_MESSAGE_TEXT_MAX,
      clamp: true,
    },
  },
}

const chatToolDefinitionSchema = {
  type: 'object',
  fields: {
    type: {
      type: 'enum',
      values: ['function'],
    },
    function: {
      type: 'object',
      fields: {
        name: { type: 'string', maxLength: SHORT_TEXT_MAX },
        description: { type: 'string', optional: true, maxLength: 4_000 },
        parameters: { type: 'any', optional: true },
      },
    },
  },
}

const chatCompletionSchema = {
  type: 'object',
  fields: {
    providerId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    baseUrl: { type: 'string', maxLength: URL_TEXT_MAX },
    apiKey: { type: 'string', maxLength: SECRET_TEXT_MAX },
    model: { type: 'string', maxLength: SHORT_TEXT_MAX },
    traceId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    requestId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    messages: {
      type: 'array',
      maxItems: 128,
      items: chatMessageSchema,
    },
    temperature: { type: 'number', optional: true, min: 0, max: 2 },
    maxTokens: { type: 'number', optional: true, min: 1, max: 200_000 },
    tools: {
      type: 'array',
      optional: true,
      maxItems: 64,
      items: chatToolDefinitionSchema,
    },
  },
}

const chatAbortStreamSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    requestId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
  },
}

const serviceConnectionTestSchema = {
  type: 'object',
  fields: {
    providerId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    baseUrl: { type: 'string', maxLength: URL_TEXT_MAX },
    apiKey: { type: 'string', maxLength: SECRET_TEXT_MAX },
    capability: {
      type: 'enum',
      values: ['text', 'speech-input', 'speech-output'],
    },
    model: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    voice: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
  },
}

const chatModelListSchema = {
  type: 'object',
  fields: {
    providerId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    baseUrl: { type: 'string', maxLength: URL_TEXT_MAX },
    apiKey: { type: 'string', maxLength: SECRET_TEXT_MAX },
    model: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
  },
}

const webSearchRequestSchema = {
  type: 'object',
  fields: {
    query: { type: 'string', maxLength: 2_000 },
    limit: { type: 'number', optional: true, min: 1, max: 20 },
    providerId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    baseUrl: { type: 'string', optional: true, maxLength: URL_TEXT_MAX },
    apiKey: { type: 'string', optional: true, maxLength: SECRET_TEXT_MAX },
    displayQuery: { type: 'string', optional: true, maxLength: 2_000 },
    keywords: { type: 'array', optional: true, maxItems: 32, items: optionalShortString },
    candidateQueries: { type: 'array', optional: true, maxItems: 8, items: { type: 'string', maxLength: 2_000 } },
    subject: { type: 'string', optional: true, maxLength: 2_000 },
    facet: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    matchProfile: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    strictTerms: { type: 'array', optional: true, maxItems: 32, items: optionalShortString },
    softTerms: { type: 'array', optional: true, maxItems: 32, items: optionalShortString },
    phraseTerms: { type: 'array', optional: true, maxItems: 32, items: optionalShortString },
    fallbackToBing: optionalBoolean,
    policy: rendererToolPolicySchema,
  },
}

const weatherLookupRequestSchema = {
  type: 'object',
  fields: {
    location: { type: 'string', maxLength: SHORT_TEXT_MAX },
    fallbackLocation: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    locale: {
      type: 'enum',
      optional: true,
      values: ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko'],
    },
    quiet: optionalBoolean,
    policy: rendererToolPolicySchema,
  },
}

const externalLinkRequestSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    url: { type: 'string', maxLength: URL_TEXT_MAX },
    policy: rendererToolPolicySchema,
  },
}

/**
 * @param {string} channel
 * @param {unknown} payload
 * @returns {ChatCompletionPayload}
 */
export function validateChatCompletionPayload(channel, payload) {
  return /** @type {ChatCompletionPayload} */ (validateIpcPayload(channel, payload, chatCompletionSchema))
}

/**
 * @param {unknown} payload
 * @returns {{ requestId?: string }}
 */
export function validateChatAbortStreamPayload(payload) {
  return /** @type {{ requestId?: string }} */ (validateIpcPayload('chat:abort-stream', payload, chatAbortStreamSchema))
}

/**
 * @param {unknown} payload
 * @returns {ChatModelListPayload}
 */
export function validateChatModelListPayload(payload) {
  return /** @type {ChatModelListPayload} */ (validateIpcPayload('chat:list-models', payload, chatModelListSchema))
}

/**
 * @param {unknown} payload
 * @returns {ServiceConnectionTestPayload}
 */
export function validateServiceConnectionTestPayload(payload) {
  return /** @type {ServiceConnectionTestPayload} */ (validateIpcPayload('service:test-connection', payload, serviceConnectionTestSchema))
}

/**
 * @param {unknown} payload
 * @returns {WebSearchToolPayload}
 */
export function validateWebSearchToolPayload(payload) {
  return /** @type {WebSearchToolPayload} */ (validateIpcPayload('tool:web-search', payload, webSearchRequestSchema))
}

/**
 * @param {unknown} payload
 * @returns {WeatherToolPayload}
 */
export function validateWeatherToolPayload(payload) {
  return /** @type {WeatherToolPayload} */ (validateIpcPayload('tool:get-weather', payload, weatherLookupRequestSchema))
}

/**
 * @param {unknown} payload
 * @returns {ExternalLinkToolPayload}
 */
export function validateExternalLinkToolPayload(payload) {
  return /** @type {ExternalLinkToolPayload} */ (validateIpcPayload('tool:open-external', payload, externalLinkRequestSchema))
}
