import { validateIpcPayload } from './schemaValidator.js'
import {
  SECRET_TEXT_MAX,
} from './payloadSchemaPrimitives.js'

const vtsBridgeConnectSchema = {
  type: 'object',
  fields: {
    port: { type: 'number', integer: true, min: 1, max: 65535 },
  },
}

const vtsBridgeLegacyTokenSchema = {
  type: 'object',
  fields: {
    token: { type: 'string', maxLength: SECRET_TEXT_MAX },
  },
}

const vtsBridgeInputSchema = {
  type: 'object',
  fields: {
    expressionSlot: {
      type: 'enum',
      values: [
        'idle',
        'thinking',
        'happy',
        'sleepy',
        'surprised',
        'confused',
        'embarrassed',
        'listening',
        'speaking',
        'touchHead',
        'touchFace',
        'touchBody',
      ],
    },
    speechLevel: { type: 'number', min: 0, max: 1 },
    gazeTarget: {
      type: 'object',
      fields: {
        x: { type: 'number', min: -1, max: 1 },
        y: { type: 'number', min: -1, max: 1 },
      },
    },
    isSpeaking: { type: 'boolean' },
    isListening: { type: 'boolean' },
  },
}

export function validateVtsBridgeConnectPayload(payload) {
  return validateIpcPayload('vts-bridge:connect', payload, vtsBridgeConnectSchema)
}

export function validateVtsBridgeLegacyTokenPayload(payload) {
  return validateIpcPayload('vts-bridge:migrate-legacy-token', payload, vtsBridgeLegacyTokenSchema)
}

export function validateVtsBridgeInputPayload(payload) {
  return validateIpcPayload('vts-bridge:update-input', payload, vtsBridgeInputSchema)
}
