import { validateIpcPayload } from './schemaValidator.js'

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
  values: ['chat', 'settings'],
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

const runtimeStateUpdateSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    mood: optionalShortString,
    continuousVoiceActive: optionalBoolean,
    panelSettingsOpen: optionalBoolean,
    voiceState: optionalShortString,
    hearingEngine: optionalShortString,
    hearingPhase: optionalShortString,
    wakewordPhase: optionalShortString,
    wakewordActive: optionalBoolean,
    wakewordAvailable: optionalBoolean,
    wakewordWakeWord: optionalShortString,
    wakewordReason: optionalShortString,
    wakewordLastTriggeredAt: optionalShortString,
    wakewordError: optionalShortString,
    wakewordUpdatedAt: optionalShortString,
    assistantActivity: optionalShortString,
    searchInProgress: optionalBoolean,
    ttsInProgress: optionalBoolean,
    schedulerArmed: optionalBoolean,
    schedulerNextRunAt: optionalShortString,
    activeTaskLabel: optionalShortString,
  },
}

const desktopContextPolicySchema = {
  type: 'object',
  optional: true,
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
