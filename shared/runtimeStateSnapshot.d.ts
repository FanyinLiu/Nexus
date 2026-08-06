import { RUNTIME_STATE_FIELD_NAMES } from './runtimeStateFields.js'

export declare const RUNTIME_STATE_MAIN_ONLY_FIELDS: readonly [
  'companionPresence',
  'petOnline',
  'panelOnline',
  'petLastSeenAt',
  'panelLastSeenAt',
  'updatedAt',
]
export type RuntimeStateMainOnlyField = (typeof RUNTIME_STATE_MAIN_ONLY_FIELDS)[number]

export declare const RUNTIME_STATE_SNAPSHOT_FIELD_NAMES: readonly [
  ...typeof RUNTIME_STATE_FIELD_NAMES,
  ...typeof RUNTIME_STATE_MAIN_ONLY_FIELDS,
]
export type RuntimeStateSnapshotFieldName = (typeof RUNTIME_STATE_SNAPSHOT_FIELD_NAMES)[number]

export declare const COMPANION_PRESENCE_PHASES: readonly [
  'idle',
  'online',
  'thinking',
  'speaking',
  'listening',
  'resting',
  'waiting',
  'error',
  'offline',
]
export type CompanionPresencePhase = (typeof COMPANION_PRESENCE_PHASES)[number]
