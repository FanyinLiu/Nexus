import { RUNTIME_STATE_BOOLEAN_FIELD_NAMES, RUNTIME_STATE_FIELD_NAMES } from '../shared/runtimeStateFields.js'
import { COMPANION_PRESENCE_PHASES } from '../shared/runtimeStateSnapshot.js'

// Boolean fields pass through untouched; string fields clamp to
// RUNTIME_STATE_STRING_MAX. Field names and the boolean subset stay pinned
// to the shared contract tuples.
const RUNTIME_STATE_BOOLEAN_FIELDS = new Set(RUNTIME_STATE_BOOLEAN_FIELD_NAMES)

const RUNTIME_STATE_SCHEMA = Object.fromEntries(
  RUNTIME_STATE_FIELD_NAMES.map((name) => [name, RUNTIME_STATE_BOOLEAN_FIELDS.has(name) ? 'boolean' : 'string']),
)

const RUNTIME_STATE_STRING_MAX = 256

const PET_WINDOW_STATE_SCHEMA = {
  isPinned: 'boolean',
  clickThrough: 'boolean',
  petHotspotActive: 'boolean',
  locomotionActivity: 'string',
  freeMode: 'boolean',
  roamCapable: 'boolean',
}

const PANEL_WINDOW_STATE_SCHEMA = {
  collapsed: 'boolean',
}

function clampRuntimeString(value, stringMax = RUNTIME_STATE_STRING_MAX) {
  if (typeof value !== 'string') return null
  return value.length > stringMax ? value.slice(0, stringMax) : value
}

// companionPresence is the only non-primitive runtime-state field: a nested
// CompanionPresenceState object whose phase is enum-pinned to the shared
// tuple. Required strings must be present; optional ones drop when empty or
// mistyped; unknown keys never pass through.
function sanitizeCompanionPresence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const phase = COMPANION_PRESENCE_PHASES.includes(value.phase) ? value.phase : null
  const mood = clampRuntimeString(value.mood)
  const updatedAt = clampRuntimeString(value.updatedAt)
  if (!phase || mood === null || updatedAt === null) return null
  const safe = { phase, mood, updatedAt }
  const activeTaskLabel = clampRuntimeString(value.activeTaskLabel)
  const reason = clampRuntimeString(value.reason)
  if (activeTaskLabel) safe.activeTaskLabel = activeTaskLabel
  if (reason) safe.reason = reason
  return safe
}

function sanitizeBySchema(partialState, schema, stringMax = RUNTIME_STATE_STRING_MAX) {
  if (!partialState || typeof partialState !== 'object') return Object.create(null)
  const safe = Object.create(null)
  for (const [key, value] of Object.entries(partialState)) {
    const expected = schema[key]
    if (!expected) continue
    if (typeof value !== expected) continue
    if (expected === 'string') {
      safe[key] = value.length > stringMax ? value.slice(0, stringMax) : value
    } else {
      safe[key] = value
    }
  }
  return safe
}

export function sanitizeRuntimeStatePatch(partialState) {
  const safe = sanitizeBySchema(partialState, RUNTIME_STATE_SCHEMA)
  if (partialState && typeof partialState === 'object') {
    const companionPresence = sanitizeCompanionPresence(partialState.companionPresence)
    if (companionPresence) safe.companionPresence = companionPresence
  }
  return safe
}

export function sanitizePetWindowStatePatch(partialState) {
  return sanitizeBySchema(partialState, PET_WINDOW_STATE_SCHEMA)
}

export function sanitizePanelWindowStatePatch(partialState) {
  return sanitizeBySchema(partialState, PANEL_WINDOW_STATE_SCHEMA)
}
