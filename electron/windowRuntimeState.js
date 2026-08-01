/**
 * Cross-window runtime state snapshot and pub-sub.
 * Extracted from windowManager so creation/lifecycle code does not own state shape.
 */
import { sanitizeRuntimeStatePatch } from './windowStateSanitizers.js'

const RUNTIME_CLIENT_TTL_MS = 30_000

/** @type {{ get: () => import('electron').BrowserWindow | null } | null} */
let mainWindowRef = null
/** @type {{ get: () => import('electron').BrowserWindow | null } | null} */
let panelWindowRef = null

let runtimeState = {
  mood: 'idle',
  continuousVoiceActive: false,
  panelSettingsOpen: false,
  voiceState: 'idle',
  wakewordPhase: 'disabled',
  wakewordActive: false,
  wakewordAvailable: false,
  wakewordWakeWord: '',
  wakewordReason: '',
  wakewordLastTriggeredAt: '',
  wakewordError: '',
  wakewordUpdatedAt: '',
  assistantActivity: 'idle',
  searchInProgress: false,
  ttsInProgress: false,
  schedulerArmed: false,
  schedulerNextRunAt: '',
  activeTaskLabel: '',
  updatedAt: new Date().toISOString(),
}

let runtimeClientHeartbeat = {
  pet: 0,
  panel: 0,
}

/** Wire live window references so sync can broadcast without importing windowManager. */
export function bindRuntimeWindows({ getMainWindow, getPanelWindow }) {
  mainWindowRef = { get: getMainWindow }
  panelWindowRef = { get: getPanelWindow }
}

export function buildRuntimeStateSnapshot() {
  const now = Date.now()
  const petLastSeenAt = runtimeClientHeartbeat.pet
  const panelLastSeenAt = runtimeClientHeartbeat.panel

  return {
    ...runtimeState,
    petOnline: now - petLastSeenAt <= RUNTIME_CLIENT_TTL_MS,
    panelOnline: now - panelLastSeenAt <= RUNTIME_CLIENT_TTL_MS,
    petLastSeenAt: petLastSeenAt ? new Date(petLastSeenAt).toISOString() : '',
    panelLastSeenAt: panelLastSeenAt ? new Date(panelLastSeenAt).toISOString() : '',
  }
}

/**
 * Broadcast the latest runtime-state snapshot to every live window EXCEPT the
 * one that originated this change (sender-skip avoids React max-update-depth).
 */
export function syncRuntimeState(originWebContentsId = null) {
  const snapshot = buildRuntimeStateSnapshot()
  const windows = [
    mainWindowRef?.get?.() ?? null,
    panelWindowRef?.get?.() ?? null,
  ]
  for (const win of windows) {
    if (!win || win.isDestroyed()) continue
    if (originWebContentsId !== null && win.webContents.id === originWebContentsId) continue
    win.webContents.send('runtime-state:changed', snapshot)
  }
}

export function updateRuntimeState(partialState, originWebContentsId = null) {
  const safe = sanitizeRuntimeStatePatch(partialState)
  runtimeState = {
    ...runtimeState,
    ...safe,
    updatedAt: new Date().toISOString(),
  }
  syncRuntimeState(originWebContentsId)
}

export function updateHeartbeat(view, originWebContentsId = null) {
  runtimeClientHeartbeat = {
    ...runtimeClientHeartbeat,
    [view]: Date.now(),
  }
  syncRuntimeState(originWebContentsId)
}
