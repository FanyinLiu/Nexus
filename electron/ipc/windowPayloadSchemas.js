import { validateIpcPayload } from './schemaValidator.js'
import { RUNTIME_STATE_FIELD_NAMES } from '../../shared/runtimeStateFields.js'
import { COMPANION_PRESENCE_PHASES } from '../../shared/runtimeStateSnapshot.js'

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
    roamCapable: optionalBoolean,
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
// SHORT_TEXT_MAX. Field names stay pinned to the shared contract tuple.
const RUNTIME_STATE_BOOLEAN_FIELDS = new Set([
  'continuousVoiceActive',
  'panelSettingsOpen',
  'wakewordActive',
  'wakewordAvailable',
  'searchInProgress',
  'ttsInProgress',
  'schedulerArmed',
])

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

export function validatePetWindowStatePayload(payload) {
  return validateIpcPayload('pet-window:update-state', payload, petWindowStateSchema)
}

export function validatePanelWindowStatePayload(payload) {
  return validateIpcPayload('panel-window:set-state', payload, panelWindowStateSchema)
}

export function validateOpenPanelPayload(payload) {
  return validateIpcPayload('window:open-panel', payload, panelSectionSchema)
}

export function validateWindowDragPayload(payload) {
  return validateIpcPayload('window:drag-by', payload, dragDeltaSchema)
}

export function validateRuntimeHeartbeatPayload(payload) {
  return validateIpcPayload('runtime-state:heartbeat', payload, runtimeHeartbeatSchema)
}

export function validateRuntimeStateUpdatePayload(payload) {
  return validateIpcPayload('runtime-state:update', payload, runtimeStateUpdateSchema)
}

export function validateDesktopContextRequestPayload(payload) {
  return validateIpcPayload('desktop-context:get', payload, desktopContextRequestSchema)
}

export function validateMediaSessionControlPayload(payload) {
  return validateIpcPayload('media-session:control', payload, mediaSessionControlSchema)
}
