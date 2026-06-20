import { validateIpcPayload } from './schemaValidator.js'
import {
  SHORT_TEXT_MAX,
} from './payloadSchemaPrimitives.js'

const pluginIdSchema = {
  type: 'object',
  fields: {
    id: { type: 'string', maxLength: SHORT_TEXT_MAX },
  },
}

const pluginBusTopicSchema = {
  type: 'object',
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
  fields: {
    limit: { type: 'number', optional: true, min: 1, max: 200 },
  },
}

export function validatePluginIdPayload(channel, payload) {
  return validateIpcPayload(channel, payload, pluginIdSchema)
}

export function validatePluginBusTopicPayload(channel, payload) {
  return validateIpcPayload(channel, payload, pluginBusTopicSchema)
}

export function validatePluginBusRecentPayload(payload) {
  return validateIpcPayload('plugin-bus:recent', payload, pluginBusRecentSchema)
}
