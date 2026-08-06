export declare const RUNTIME_STATE_FIELD_NAMES: readonly [
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
]

export type RuntimeStateFieldName = (typeof RUNTIME_STATE_FIELD_NAMES)[number]
