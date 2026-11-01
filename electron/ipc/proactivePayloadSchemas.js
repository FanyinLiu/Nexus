// @ts-check
/**
 * Payload schemas for the proactive delivery and inbox channels.
 *
 * Title and body budgets are part of the message contract (design 4.1) and are
 * enforced here rather than clamped: a message that breaks the contract is a
 * caller bug, and silently truncating it would hide that. `systemDnd` is the
 * one nullable field — null means the platform could not report Do Not
 * Disturb, and the router treats it as false.
 */

import {
  PROACTIVE_ACTIONS,
  PROACTIVE_BODY_MAX_LENGTH,
  PROACTIVE_PRIORITIES,
  PROACTIVE_SOURCES,
  PROACTIVE_TITLE_MAX_LENGTH,
} from '../../shared/proactiveDelivery.js'
import { validateIpcPayload } from './schemaValidator.js'

/** @typedef {import('../../shared/proactiveDelivery.js').ProactiveDeliveryPayload} ProactiveDeliveryPayload */
/** @typedef {import('../../shared/proactiveDelivery.js').ProactiveInboxStatus} ProactiveInboxStatus */
/** @typedef {{ id: string, status: ProactiveInboxStatus }} InboxUpdatePayload */

const MESSAGE_ID_MAX_LENGTH = 200
const KIND_MAX_LENGTH = 64
const SPEECH_MAX_LENGTH = 500
const ORIGIN_ID_MAX_LENGTH = 200

const proactiveMessageSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    id: { type: 'string', maxLength: MESSAGE_ID_MAX_LENGTH, trim: true, allowEmpty: false },
    source: { type: 'enum', values: PROACTIVE_SOURCES },
    kind: { type: 'string', maxLength: KIND_MAX_LENGTH, trim: true, allowEmpty: false },
    priority: { type: 'enum', values: PROACTIVE_PRIORITIES },
    title: { type: 'string', maxLength: PROACTIVE_TITLE_MAX_LENGTH, allowEmpty: false },
    body: { type: 'string', maxLength: PROACTIVE_BODY_MAX_LENGTH },
    speech: { type: 'string', optional: true, maxLength: SPEECH_MAX_LENGTH },
    actions: {
      type: 'array',
      maxItems: PROACTIVE_ACTIONS.length,
      items: { type: 'enum', values: PROACTIVE_ACTIONS },
    },
    createdAt: { type: 'number', min: 0 },
    expiresAt: { type: 'number', optional: true, min: 0 },
    origin: {
      type: 'object',
      optional: true,
      unknown: 'reject',
      fields: {
        taskId: { type: 'string', optional: true, maxLength: ORIGIN_ID_MAX_LENGTH, trim: true, allowEmpty: false },
        letterId: { type: 'string', optional: true, maxLength: ORIGIN_ID_MAX_LENGTH, trim: true, allowEmpty: false },
        capsuleId: { type: 'string', optional: true, maxLength: ORIGIN_ID_MAX_LENGTH, trim: true, allowEmpty: false },
        arcId: { type: 'string', optional: true, maxLength: ORIGIN_ID_MAX_LENGTH, trim: true, allowEmpty: false },
      },
    },
  },
}

const deliveryContextSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    panelFocused: { type: 'boolean' },
    fullscreen: { type: 'boolean' },
    focusState: { type: 'enum', values: ['active', 'idle', 'away', 'locked'] },
    inQuietHours: { type: 'boolean' },
    systemDnd: { type: 'boolean', nullable: true },
    awayNotificationsEnabled: { type: 'boolean' },
    stripEnabled: { type: 'boolean' },
  },
}

const proactiveDeliverySchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    message: proactiveMessageSchema,
    context: deliveryContextSchema,
  },
}

const inboxUpdateSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    id: { type: 'string', maxLength: MESSAGE_ID_MAX_LENGTH, trim: true, allowEmpty: false },
    status: { type: 'enum', values: ['unread', 'done', 'dismissed'] },
  },
}

/** @param {unknown} payload @returns {ProactiveDeliveryPayload} */
export function validateProactiveDeliveryPayload(payload) {
  return /** @type {ProactiveDeliveryPayload} */ (
    validateIpcPayload('proactive:deliver', payload, proactiveDeliverySchema)
  )
}

/** @param {unknown} payload @returns {InboxUpdatePayload} */
export function validateInboxUpdatePayload(payload) {
  return /** @type {InboxUpdatePayload} */ (
    validateIpcPayload('inbox:update', payload, inboxUpdateSchema)
  )
}
