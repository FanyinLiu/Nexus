// @ts-check
/**
 * Payload schemas for persona text writes.
 *
 * These carry free-form markdown authored by the user, so this boundary only
 * asserts types; the persona loader owns content limits and normalization.
 */

import { validateIpcPayload } from './schemaValidator.js'

const saveMemorySchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    content: { type: 'string', optional: true },
  },
}

const initSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    defaultSoul: { type: 'string', optional: true },
  },
}

/**
 * @param {unknown} payload
 * @returns {{ content?: string }}
 */
export function validatePersonaSaveMemoryPayload(payload) {
  return /** @type {{ content?: string }} */ (
    validateIpcPayload('persona:save-memory', payload, saveMemorySchema)
  )
}

/**
 * @param {unknown} payload
 * @returns {{ defaultSoul?: string }}
 */
export function validatePersonaInitPayload(payload) {
  return /** @type {{ defaultSoul?: string }} */ (
    validateIpcPayload('persona:init', payload, initSchema)
  )
}
