// @ts-check
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
  unknown: 'reject',
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

/** @param {unknown} payload @returns {{ port: number }} */
export function validateVtsBridgeConnectPayload(payload) {
  return /** @type {{ port: number }} */ (validateIpcPayload('vts-bridge:connect', payload, vtsBridgeConnectSchema))
}

/** @param {unknown} payload @returns {{ token: string }} */
export function validateVtsBridgeLegacyTokenPayload(payload) {
  return /** @type {{ token: string }} */ (validateIpcPayload('vts-bridge:migrate-legacy-token', payload, vtsBridgeLegacyTokenSchema))
}

/**
 * @param {unknown} payload
 * @returns {{ expressionSlot: string, speechLevel: number, gazeTarget: { x: number, y: number }, isSpeaking: boolean, isListening: boolean }}
 */
export function validateVtsBridgeInputPayload(payload) {
  return /** @type {{ expressionSlot: string, speechLevel: number, gazeTarget: { x: number, y: number }, isSpeaking: boolean, isListening: boolean }} */ (
    validateIpcPayload('vts-bridge:update-input', payload, vtsBridgeInputSchema)
  )
}
