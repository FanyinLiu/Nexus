/**
 * Canonical runtime-state field names — single source of truth for the 20
 * fields the renderer may patch through the window bridge. Consumed by the
 * main-process sanitizer (electron/windowStateSanitizers.js, truncates
 * over-long strings) and the IPC validator
 * (electron/ipc/windowPayloadSchemas.js, rejects unknown fields); the two
 * semantics stay separate — sanitize vs validate — only the field inventory
 * and the boolean/string type assignment are shared.
 *
 * Order is contractual: it matches the historical schema declaration order,
 * which decides the validator's field iteration order.
 */

/** The 20 patchable runtime-state field names, in schema declaration order. */
export const RUNTIME_STATE_FIELD_NAMES = Object.freeze([
  'mood',
  'continuousVoiceActive',
  'panelSettingsOpen',
  'voiceState',
  'hearingEngine',
  'hearingPhase',
  'wakewordPhase',
  'wakewordActive',
  'wakewordAvailable',
  'wakewordWakeWord',
  'wakewordReason',
  'wakewordLastTriggeredAt',
  'wakewordError',
  'wakewordUpdatedAt',
  'assistantActivity',
  'searchInProgress',
  'ttsInProgress',
  'schedulerArmed',
  'schedulerNextRunAt',
  'activeTaskLabel',
])

/**
 * The 7 patchable fields whose values are booleans (the rest are strings).
 * Both main-process consumers derive their lookup Set from this tuple.
 */
export const RUNTIME_STATE_BOOLEAN_FIELD_NAMES = Object.freeze([
  'continuousVoiceActive',
  'panelSettingsOpen',
  'wakewordActive',
  'wakewordAvailable',
  'searchInProgress',
  'ttsInProgress',
  'schedulerArmed',
])
