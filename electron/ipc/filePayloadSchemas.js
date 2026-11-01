// @ts-check
import { validateIpcPayload } from './schemaValidator.js'
import {
  SAFE_FILE_EXTENSION_PATTERN,
  SHORT_TEXT_MAX,
  TEXT_FILE_CONTENT_MAX,
} from './payloadSchemaPrimitives.js'

const fileDialogFilterSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    name: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
    extensions: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'string',
        maxLength: 32,
        trim: true,
        allowEmpty: false,
        pattern: SAFE_FILE_EXTENSION_PATTERN,
      },
    },
  },
}

const textFileSaveSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    title: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
    defaultFileName: { type: 'string', maxLength: 255, trim: true, allowEmpty: false, clamp: true },
    content: { type: 'string', maxLength: TEXT_FILE_CONTENT_MAX },
    filters: {
      type: 'array',
      optional: true,
      maxItems: 16,
      items: fileDialogFilterSchema,
    },
  },
}

const textFileOpenSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    title: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
    filters: {
      type: 'array',
      optional: true,
      maxItems: 16,
      items: fileDialogFilterSchema,
    },
  },
}

/**
 * @typedef {Object} TextFileFilter
 * @property {string} name
 * @property {string[]} extensions
 */

/**
 * @param {unknown} payload
 * @returns {{ title: string, defaultFileName: string, content: string, filters?: TextFileFilter[] }}
 */
export function validateTextFileSavePayload(payload) {
  return /** @type {{ title: string, defaultFileName: string, content: string, filters?: TextFileFilter[] }} */ (
    validateIpcPayload('file:save-text', payload, textFileSaveSchema)
  )
}

/**
 * @param {unknown} payload
 * @returns {{ title: string, filters?: TextFileFilter[] }}
 */
export function validateTextFileOpenPayload(payload) {
  return /** @type {{ title: string, filters?: TextFileFilter[] }} */ (validateIpcPayload('file:open-text', payload, textFileOpenSchema))
}
