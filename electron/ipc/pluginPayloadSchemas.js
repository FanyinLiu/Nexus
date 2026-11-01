// @ts-check
import { validateIpcPayload } from './schemaValidator.js'
import {
  SHORT_TEXT_MAX,
} from './payloadSchemaPrimitives.js'

const pluginIdSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    id: { type: 'string', maxLength: SHORT_TEXT_MAX },
  },
}

const pluginBusTopicSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    serverId: { type: 'string', maxLength: SHORT_TEXT_MAX },
    topic: { type: 'string', maxLength: SHORT_TEXT_MAX },
    data: { type: 'any', optional: true },
  },
}

const pluginBusRecentSchema = {
  type: 'object',
  optional: true,
  default: {},
  unknown: 'reject',
  fields: {
    limit: { type: 'number', optional: true, min: 1, max: 200 },
  },
}

/**
 * @param {string} channel
 * @param {unknown} payload
 * @returns {{ id: string }}
 */
export function validatePluginIdPayload(channel, payload) {
  return /** @type {{ id: string }} */ (validateIpcPayload(channel, payload, pluginIdSchema))
}

/**
 * @param {string} channel
 * @param {unknown} payload
 * @returns {{ serverId: string, topic: string, data?: unknown }}
 */
export function validatePluginBusTopicPayload(channel, payload) {
  return /** @type {{ serverId: string, topic: string, data?: unknown }} */ (validateIpcPayload(channel, payload, pluginBusTopicSchema))
}

/**
 * @param {unknown} payload
 * @returns {{ limit?: number }}
 */
export function validatePluginBusRecentPayload(payload) {
  return /** @type {{ limit?: number }} */ (validateIpcPayload('plugin-bus:recent', payload, pluginBusRecentSchema))
}
