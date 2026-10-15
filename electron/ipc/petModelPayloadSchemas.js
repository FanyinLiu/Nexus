import { validateIpcPayload } from './schemaValidator.js'
import {
  SHORT_TEXT_MAX,
  URL_TEXT_MAX,
} from './payloadSchemaPrimitives.js'

const petModelGalleryImportSchema = {
  type: 'string',
  maxLength: URL_TEXT_MAX,
  trim: true,
  allowEmpty: false,
}

const petModelGalleryListSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    query: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    limit: { type: 'number', optional: true, integer: true, min: 1, max: 100 },
  },
}

export function validatePetModelGalleryImportPayload(payload) {
  return validateIpcPayload('pet-model:import-codex-gallery', payload, petModelGalleryImportSchema)
}

export function validatePetModelGalleryListPayload(payload) {
  return validateIpcPayload('pet-model:list-codex-gallery', payload, petModelGalleryListSchema)
}
