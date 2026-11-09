// @ts-nocheck
/**
 * Cross-window runtime state snapshot and pub-sub.
 * Extracted from windowManager so creation/lifecycle code does not own state shape.
 */
import { createReminderPanelWakeMonitor } from './reminderPanelWake.js'
import { sanitizeRuntimeStatePatch } from './windowStateSanitizers.js'

const RUNTIME_CLIENT_TTL_MS = 30_000
// Chromium throttles a hidden renderer's timers to roughly once a minute,
// which outruns the visible TTL. A hidden-but-alive window can still deliver
// reminders, so widen only its liveness TTL instead of disabling background
// throttling for the whole panel (which would keep its Live2D loop running).
const RUNTIME_HIDDEN_CLIENT_TTL_MS = 90_000

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

function liveWindow(ref) {
  const win = ref?.get?.() ?? null
  if (!win || win.isDestroyed()) return null
  return win
}

function windowVisible(ref) {
  const win = liveWindow(ref)
  if (!win) return false
  try {
    return win.isVisible()
  } catch {
    return false
  }
}

/**
 * Liveness is decided here in the main process, not from the renderer's timer
 * cadence: a hidden window's heartbeat is throttled but it is still alive.
 */
function isClientOnline(view, now) {
  const lastSeenAt = runtimeClientHeartbeat[view]
  if (!lastSeenAt) return false
  const ref = view === 'pet' ? mainWindowRef : panelWindowRef
  if (!liveWindow(ref)) return false
  const ttl = windowVisible(ref) ? RUNTIME_CLIENT_TTL_MS : RUNTIME_HIDDEN_CLIENT_TTL_MS
  return now - lastSeenAt <= ttl
}

export function buildRuntimeStateSnapshot() {
  const now = Date.now()
  const petLastSeenAt = runtimeClientHeartbeat.pet
  const panelLastSeenAt = runtimeClientHeartbeat.panel

  return {
    ...runtimeState,
    petOnline: isClientOnline('pet', now),
    panelOnline: isClientOnline('panel', now),
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

const reminderPanelWakeMonitor = createReminderPanelWakeMonitor({
  getPanelWindow: () => liveWindow(panelWindowRef),
  getSnapshot: buildRuntimeStateSnapshot,
  // The wake rides the existing runtime-state channel: the panel already
  // subscribes to it, so this adds no IPC surface, preload method or type.
  deliverWake: (win, snapshot) => {
    win.webContents.send('runtime-state:changed', snapshot)
  },
})

/** Start the panel wake driver once a panel window exists. */
export function startReminderPanelWakeMonitor() {
  reminderPanelWakeMonitor.start()
}

/** Stop the panel wake driver when the panel window is destroyed. */
export function stopReminderPanelWakeMonitor() {
  reminderPanelWakeMonitor.stop()
}

/** Re-evaluate pet liveness now (e.g. right after the pet window closes). */
export function checkReminderPanelWakeNow() {
  reminderPanelWakeMonitor.tick()
}

/**
 * @param {Record<string, unknown>} partialState
 * @param {number | null} [originWebContentsId]
 */
export function updateRuntimeState(partialState, originWebContentsId = null) {
  const safe = sanitizeRuntimeStatePatch(partialState)
  runtimeState = {
    ...runtimeState,
    ...safe,
    updatedAt: new Date().toISOString(),
  }
  syncRuntimeState(originWebContentsId)
}

/**
 * @param {'pet' | 'panel'} view
 * @param {number | null} [originWebContentsId]
 */
export function updateHeartbeat(view, originWebContentsId = null) {
  runtimeClientHeartbeat = {
    ...runtimeClientHeartbeat,
    [view]: Date.now(),
  }
  syncRuntimeState(originWebContentsId)
  // A pet beat can restore liveness before the monitor's next poll; push the
  // online transition right away so the panel stops scheduling.
  if (view === 'pet') reminderPanelWakeMonitor.tick()
}
