/**
 * Canonical runtime-state snapshot shape — single source of truth for the
 * 26-field snapshot the main process broadcasts on `runtime-state:changed`
 * (electron/windowRuntimeState.js). The snapshot is the union of the 20
 * renderer-patchable fields (shared/runtimeStateFields.js) and 6 fields only
 * the main process may compute: the companion presence object, the two
 * heartbeat-derived online/last-seen pairs, and `updatedAt`.
 *
 * Also owns the companion-presence phase enum: the main process maps chat
 * request lifecycle outcomes onto these phases
 * (electron/companionPresenceTracker.js) and the renderer uiV2 surface
 * branches on them (src/features/uiV2/state.ts), so both processes must read
 * the inventory from here.
 */
import { RUNTIME_STATE_FIELD_NAMES } from './runtimeStateFields.js'

/** The 6 snapshot fields the renderer can read but never patch. */
export const RUNTIME_STATE_MAIN_ONLY_FIELDS = Object.freeze([
  'companionPresence',
  'petOnline',
  'panelOnline',
  'petLastSeenAt',
  'panelLastSeenAt',
  'updatedAt',
])

/** The full 26-field broadcast snapshot: patchable fields, then main-only fields. */
export const RUNTIME_STATE_SNAPSHOT_FIELD_NAMES = Object.freeze([
  ...RUNTIME_STATE_FIELD_NAMES,
  ...RUNTIME_STATE_MAIN_ONLY_FIELDS,
])

/** The 9 companion presence phases, in src/types/pet.ts declaration order. */
export const COMPANION_PRESENCE_PHASES = Object.freeze([
  'idle',
  'online',
  'thinking',
  'speaking',
  'listening',
  'resting',
  'waiting',
  'error',
  'offline',
])
