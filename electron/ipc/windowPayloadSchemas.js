// @ts-check
import { validateIpcPayload } from './schemaValidator.js'
import { RUNTIME_STATE_BOOLEAN_FIELD_NAMES, RUNTIME_STATE_FIELD_NAMES } from '../../shared/runtimeStateFields.js'
import { COMPANION_PRESENCE_PHASES } from '../../shared/runtimeStateSnapshot.js'

/**
 * @typedef {Object} CompanionPresencePayload
 * @property {string} phase
 * @property {string} [mood]
 * @property {string} [activeTaskLabel]
 * @property {string} [reason]
 * @property {string} [updatedAt]
 */

/**
 * @typedef {Object} RuntimeStateUpdatePayload
 * @property {boolean} [continuousVoiceActive]
 * @property {boolean} [panelSettingsOpen]
 * @property {boolean} [wakewordActive]
 * @property {boolean} [wakewordAvailable]
 * @property {boolean} [searchInProgress]
 * @property {boolean} [ttsInProgress]
 * @property {boolean} [schedulerArmed]
 * @property {string} [mood]
 * @property {string} [voiceState]
 * @property {string} [hearingEngine]
 * @property {string} [hearingPhase]
 * @property {string} [wakewordPhase]
 * @property {string} [wakewordWakeWord]
 * @property {string} [wakewordReason]
 * @property {string} [wakewordLastTriggeredAt]
 * @property {string} [wakewordError]
 * @property {string} [wakewordUpdatedAt]
 * @property {string} [assistantActivity]
 * @property {string} [schedulerNextRunAt]
 * @property {string} [activeTaskLabel]
 * @property {CompanionPresencePayload} [companionPresence]
 */

/**
 * @typedef {Object} DesktopContextPolicyPayload
 * @property {boolean} [activeWindow]
 * @property {boolean} [clipboard]
 * @property {boolean} [screenshot]
 */

/**
 * @typedef {Object} DesktopContextRequestPayload
 * @property {boolean} [includeActiveWindow]
 * @property {boolean} [includeClipboard]
 * @property {boolean} [includeScreenshot]
 * @property {DesktopContextPolicyPayload} [policy]
 */

const SHORT_TEXT_MAX = 256

const optionalBoolean = { type: 'boolean', optional: true }
const optionalShortString = {
  type: 'string',
  optional: true,
  maxLength: SHORT_TEXT_MAX,
  clamp: true,
}

const petWindowStateSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    isPinned: optionalBoolean,
    clickThrough: optionalBoolean,
    petHotspotActive: optionalBoolean,
  },
}

const panelWindowStateSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    collapsed: optionalBoolean,
  },
}

const panelSectionSchema = {
  type: 'enum',
  optional: true,
  default: 'chat',
  values: ['chat', 'chat-text', 'chat-recent', 'settings'],
}

const closePanelSchema = {
  type: 'object',
  optional: true,
  default: {},
  unknown: 'reject',
  fields: {
    retireFirstUse: optionalBoolean,
    nonce: { type: 'string', optional: true, maxLength: 64 },
  },
}

const dragDeltaSchema = {
  type: 'object',
  fields: {
    x: { type: 'number', min: -10_000, max: 10_000 },
    y: { type: 'number', min: -10_000, max: 10_000 },
  },
}

const runtimeHeartbeatSchema = {
  type: 'object',
  optional: true,
  default: { view: 'pet' },
  fields: {
    view: {
      type: 'enum',
      optional: true,
      default: 'pet',
      values: ['pet', 'panel'],
    },
  },
}

// Boolean fields reject non-boolean values; string fields clamp to
// SHORT_TEXT_MAX. Field names and the boolean subset stay pinned to the
// shared contract tuples.
const RUNTIME_STATE_BOOLEAN_FIELDS = new Set(
  /** @type {readonly string[]} */ (RUNTIME_STATE_BOOLEAN_FIELD_NAMES),
)

// companionPresence is the only non-primitive runtime-state field: a nested
// CompanionPresenceState object, enum-pinned to the shared phase tuple.
// Unknown nested keys are stripped by the object validator.
const companionPresenceSchema = {
  type: 'object',
  optional: true,
  fields: {
    phase: { type: 'enum', values: [...COMPANION_PRESENCE_PHASES] },
    mood: { type: 'string', maxLength: SHORT_TEXT_MAX, clamp: true },
    activeTaskLabel: optionalShortString,
    reason: optionalShortString,
    updatedAt: { type: 'string', maxLength: SHORT_TEXT_MAX, clamp: true },
  },
}

const runtimeStateUpdateSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    ...Object.fromEntries(
      RUNTIME_STATE_FIELD_NAMES.map((name) => [
        name,
        RUNTIME_STATE_BOOLEAN_FIELDS.has(name) ? optionalBoolean : optionalShortString,
      ]),
    ),
    companionPresence: companionPresenceSchema,
  },
}

const desktopContextPolicySchema = {
  type: 'object',
  optional: true,
  unknown: 'reject',
  fields: {
    activeWindow: optionalBoolean,
    clipboard: optionalBoolean,
    screenshot: optionalBoolean,
  },
}

const desktopContextRequestSchema = {
  type: 'object',
  optional: true,
  default: {},
  unknown: 'reject',
  fields: {
    includeActiveWindow: optionalBoolean,
    includeClipboard: optionalBoolean,
    includeScreenshot: optionalBoolean,
    policy: desktopContextPolicySchema,
  },
}

const mediaSessionControlSchema = {
  type: 'object',
  fields: {
    action: {
      type: 'enum',
      values: ['play', 'pause', 'toggle', 'next', 'previous'],
    },
  },
}

const modelSetupRequestSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    delayMs: { type: 'number', optional: true, min: 0, max: 60_000 },
    cancel: optionalBoolean,
  },
}

const systemVibrancySchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    enabled: optionalBoolean,
  },
}

const launchOnStartupSchema = {
  type: 'boolean',
  optional: true,
  default: false,
}

const confirmDialogSchema = {
  type: 'string',
  optional: true,
  default: '',
}

/**
 * @param {unknown} payload
 * @returns {{ isPinned?: boolean, clickThrough?: boolean, petHotspotActive?: boolean }}
 */
export function validatePetWindowStatePayload(payload) {
  return /** @type {{ isPinned?: boolean, clickThrough?: boolean, petHotspotActive?: boolean }} */ (
    validateIpcPayload('pet-window:update-state', payload, petWindowStateSchema)
  )
}

/**
 * @param {unknown} payload
 * @returns {{ collapsed?: boolean }}
 */
export function validatePanelWindowStatePayload(payload) {
  return /** @type {{ collapsed?: boolean }} */ (validateIpcPayload('panel-window:set-state', payload, panelWindowStateSchema))
}

/**
 * @param {unknown} payload
 * @returns {'chat'|'chat-text'|'chat-recent'|'settings'}
 */
export function validateOpenPanelPayload(payload) {
  return /** @type {'chat'|'chat-text'|'chat-recent'|'settings'} */ (validateIpcPayload('window:open-panel', payload, panelSectionSchema))
}

/**
 * @param {unknown} payload
 * @returns {{ retireFirstUse?: boolean, nonce?: string }}
 */
export function validateClosePanelPayload(payload) {
  return /** @type {{ retireFirstUse?: boolean, nonce?: string }} */ (validateIpcPayload('window:close-panel', payload, closePanelSchema))
}

/**
 * @param {unknown} payload
 * @returns {{ x: number, y: number }}
 */
export function validateWindowDragPayload(payload) {
  return /** @type {{ x: number, y: number }} */ (validateIpcPayload('window:drag-by', payload, dragDeltaSchema))
}

/**
 * @param {unknown} payload
 * @returns {{ view: 'pet'|'panel' }}
 */
export function validateRuntimeHeartbeatPayload(payload) {
  return /** @type {{ view: 'pet'|'panel' }} */ (validateIpcPayload('runtime-state:heartbeat', payload, runtimeHeartbeatSchema))
}

/**
 * @param {unknown} payload
 * @returns {RuntimeStateUpdatePayload}
 */
export function validateRuntimeStateUpdatePayload(payload) {
  return /** @type {RuntimeStateUpdatePayload} */ (validateIpcPayload('runtime-state:update', payload, runtimeStateUpdateSchema))
}

/**
 * @param {unknown} payload
 * @returns {DesktopContextRequestPayload}
 */
export function validateDesktopContextRequestPayload(payload) {
  return /** @type {DesktopContextRequestPayload} */ (validateIpcPayload('desktop-context:get', payload, desktopContextRequestSchema))
}

/**
 * @param {unknown} payload
 * @returns {{ action: 'play'|'pause'|'toggle'|'next'|'previous' }}
 */
export function validateMediaSessionControlPayload(payload) {
  return /** @type {{ action: 'play'|'pause'|'toggle'|'next'|'previous' }} */ (validateIpcPayload('media-session:control', payload, mediaSessionControlSchema))
}

const modelSetupReminderSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    peek: optionalBoolean,
  },
}

const modelSetupResolveSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    reason: {
      type: 'enum',
      values: ['shown', 'dismissed', 'installed'],
    },
  },
}

const speechStopPlaybackSchema = {
  type: 'object',
  optional: true,
  default: {},
  unknown: 'reject',
  fields: {},
}

/**
 * @param {unknown} payload
 * @returns {Record<string, never>}
 */
export function validateSpeechStopPlaybackPayload(payload) {
  return /** @type {Record<string, never>} */ (
    validateIpcPayload('voice:stop-playback', payload, speechStopPlaybackSchema)
  )
}

/**
 * @param {unknown} payload
 * @returns {{ delayMs?: number, cancel?: boolean }}
 */
export function validateModelSetupRequestPayload(payload) {
  return /** @type {{ delayMs?: number, cancel?: boolean }} */ (validateIpcPayload('window:request-model-setup', payload, modelSetupRequestSchema))
}

/**
 * @param {unknown} payload
 * @returns {{ peek?: boolean }}
 */
export function validateModelSetupReminderPayload(payload) {
  return /** @type {{ peek?: boolean }} */ (validateIpcPayload('window:claim-model-setup-reminder', payload, modelSetupReminderSchema))
}

/**
 * @param {unknown} payload
 * @returns {{ reason: 'shown'|'dismissed'|'installed' }}
 */
export function validateModelSetupResolvePayload(payload) {
  return /** @type {{ reason: 'shown'|'dismissed'|'installed' }} */ (
    validateIpcPayload('window:resolve-model-setup-request', payload, modelSetupResolveSchema)
  )
}

/**
 * @param {unknown} payload
 * @returns {{ enabled?: boolean }}
 */
export function validateSystemVibrancyPayload(payload) {
  return /** @type {{ enabled?: boolean }} */ (
    validateIpcPayload('window:set-system-vibrancy', payload, systemVibrancySchema)
  )
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function validateLaunchOnStartupPayload(value) {
  return /** @type {boolean} */ (
    validateIpcPayload('app:set-launch-on-startup', value, launchOnStartupSchema)
  )
}

/**
 * @param {unknown} message
 * @returns {string}
 */
export function validateConfirmDialogPayload(message) {
  return /** @type {string} */ (
    validateIpcPayload('dialog:confirm', message, confirmDialogSchema)
  )
}
