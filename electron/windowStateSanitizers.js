const RUNTIME_STATE_SCHEMA = {
  mood: 'string',
  continuousVoiceActive: 'boolean',
  panelSettingsOpen: 'boolean',
  voiceState: 'string',
  hearingEngine: 'string',
  hearingPhase: 'string',
  wakewordPhase: 'string',
  wakewordActive: 'boolean',
  wakewordAvailable: 'boolean',
  wakewordWakeWord: 'string',
  wakewordReason: 'string',
  wakewordLastTriggeredAt: 'string',
  wakewordError: 'string',
  wakewordUpdatedAt: 'string',
  assistantActivity: 'string',
  searchInProgress: 'boolean',
  ttsInProgress: 'boolean',
  schedulerArmed: 'boolean',
  schedulerNextRunAt: 'string',
  activeTaskLabel: 'string',
}

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
  return sanitizeBySchema(partialState, RUNTIME_STATE_SCHEMA)
}

export function sanitizePetWindowStatePatch(partialState) {
  return sanitizeBySchema(partialState, PET_WINDOW_STATE_SCHEMA)
}

export function sanitizePanelWindowStatePatch(partialState) {
  return sanitizeBySchema(partialState, PANEL_WINDOW_STATE_SCHEMA)
}
