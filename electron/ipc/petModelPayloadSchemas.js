import { validateIpcPayload } from './schemaValidator.js'
import {
  PATH_TEXT_MAX,
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

const petModelCreatorKitCreateSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    id: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    displayName: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    concept: { type: 'string', optional: true, maxLength: 2_000, trim: true, clamp: true },
    description: { type: 'string', optional: true, maxLength: 2_000, trim: true, clamp: true },
    styleNotes: { type: 'string', optional: true, maxLength: 2_000, trim: true, clamp: true },
  },
}

const petModelCreatorKitOptionalPathSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    kitDirectory: { type: 'string', optional: true, maxLength: PATH_TEXT_MAX, trim: true, clamp: true },
  },
}

const petModelCreatorKitInstallSchema = {
  type: 'object',
  fields: {
    kitDirectory: { type: 'string', maxLength: PATH_TEXT_MAX, trim: true, allowEmpty: false },
    manifestPath: { type: 'string', maxLength: PATH_TEXT_MAX, trim: true, allowEmpty: false },
  },
}

const petModelCreatorKitOpenPathSchema = {
  type: 'object',
  fields: {
    kitDirectory: { type: 'string', maxLength: PATH_TEXT_MAX, trim: true, allowEmpty: false },
    targetPath: { type: 'string', maxLength: PATH_TEXT_MAX, trim: true, allowEmpty: false },
    mode: { type: 'enum', optional: true, values: ['open', 'reveal'] },
  },
}

export function validatePetModelGalleryImportPayload(payload) {
  return validateIpcPayload('pet-model:import-codex-gallery', payload, petModelGalleryImportSchema)
}

export function validatePetModelGalleryListPayload(payload) {
  return validateIpcPayload('pet-model:list-codex-gallery', payload, petModelGalleryListSchema)
}

export function validatePetModelCreatorKitCreatePayload(payload) {
  return validateIpcPayload('pet-model:create-creator-kit', payload, petModelCreatorKitCreateSchema)
}

export function validatePetModelCreatorKitOptionalPathPayload(channel, payload) {
  return validateIpcPayload(channel, payload, petModelCreatorKitOptionalPathSchema)
}

export function validatePetModelCreatorKitInstallPayload(payload) {
  return validateIpcPayload('pet-model:install-creator-kit-codex', payload, petModelCreatorKitInstallSchema)
}

export function validatePetModelCreatorKitOpenPathPayload(payload) {
  return validateIpcPayload('pet-model:open-creator-kit-path', payload, petModelCreatorKitOpenPathSchema)
}
