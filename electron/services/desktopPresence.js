// Adaptive desktop presence: global cursor gaze and aggregate typing.
// Gaze samples are window-relative DIP. On Linux the Electron cursor query
// stays stale until the pointer crosses a BrowserWindow, so gaze reads the
// same global input hook typing uses. Typing IPC is only
// { phase, keysPerSecond }. Key codes stay inside the state machine and
// are cleared on lock, suspend, resume, and quit. A missing native hook
// disables typing and leaves the Electron cursor query in place.

import { app, BrowserWindow, powerMonitor, screen, shell, systemPreferences } from 'electron'
import { getPetInstanceForWindow } from '../petWindowInstances.js'
import { getRedactedErrorMessage } from './errorRedaction.js'
import {
  GAZE_RESUME_CHECK_MS,
  GAZE_SAMPLE_INTERVAL_MS,
  cursorRelativeToWindow,
  gazeSamplingPaused,
  normalizeCursorToDip,
  selectGazeCursor,
  shouldEmitGazeSample,
  toPublicGazeSample,
} from '../../shared/gazeFollow.js'
import {
  classifyLinuxTypingHookFailure,
  createTypingActivityMachine,
  toPublicTypingSignal,
} from '../../shared/typingActivity.js'

const TYPING_TICK_MS = 100
const TYPING_EMIT_MS = 50

const machine = createTypingActivityMachine()
const session = { locked: false, suspended: false }
const lastEmit = new Map()

let started = false
let preferences = { gazeFollowEnabled: true, typingAwarenessEnabled: false }
let currentStatus = buildStatus('not-applicable', false)
let gazeTimer = null
let gazeInterval = 0
let pauseSent = false
let cursorFailed = false
let typingGeneration = 0
let hook = null
let hookRunning = false
let hookStart = null
let onKeyDown = null
let onKeyUp = null
let onMouseMove = null
let gazeListening = false
let hookCursor = null
let gazeHookWarned = false
let activityTimer = null
let typingTimer = null
let pendingTyping = null

/**
 * @param {'granted' | 'denied' | 'unavailable' | 'not-applicable'} permission
 * @param {boolean} running
 * @param {{ messageKey?: string, recommendationKey?: string }} [copy]
 */
function buildStatus(permission, running, copy = {}) {
  const messageKey = copy.messageKey
    ?? (permission === 'denied'
      ? 'settings.window.typing_permission_denied'
      : permission === 'unavailable'
        ? 'settings.window.typing_unavailable'
        : running
          ? 'settings.window.typing_status_running'
          : 'settings.window.typing_status_off')
  const recommendationKey = copy.recommendationKey
    ?? (permission === 'denied'
      ? 'settings.window.typing_permission_denied_hint'
      : permission === 'unavailable'
        ? 'settings.window.typing_unavailable_hint'
        : 'settings.window.typing_awareness_hint')
  return {
    running: running === true,
    permission,
    platform: process.platform,
    messageKey,
    recommendationKey,
  }
}

function setStatus(next) {
  currentStatus = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win || win.isDestroyed()) continue
    try {
      win.webContents.send('desktop-presence:typing-status', next)
    } catch {
      // The window can close between the list and the send.
    }
  }
}

function sendTyping(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win || win.isDestroyed()) continue
    try {
      win.webContents.send('desktop-presence:typing', payload)
    } catch {
      // Ignore a window that is already going away.
    }
  }
}

function publishTyping(signal) {
  const payload = toPublicTypingSignal(signal)
  if (payload.phase === 'idle') return
  if (payload.phase === 'start' || payload.phase === 'stop') {
    if (typingTimer) clearTimeout(typingTimer)
    typingTimer = null
    pendingTyping = null
    sendTyping(payload)
    return
  }
  pendingTyping = payload
  if (typingTimer) return
  typingTimer = setTimeout(() => {
    typingTimer = null
    const next = pendingTyping
    pendingTyping = null
    if (next) sendTyping(next)
  }, TYPING_EMIT_MS)
}

function ensureActivityTimer() {
  if (activityTimer) return
  activityTimer = setInterval(() => {
    const signal = machine.tick(Date.now())
    if (signal.phase === 'stop') {
      publishTyping(signal)
      if (activityTimer) clearInterval(activityTimer)
      activityTimer = null
      return
    }
    if (signal.phase === 'update') publishTyping(signal)
  }, TYPING_TICK_MS)
}

function noteTyping(signal) {
  if (signal.phase === 'start') ensureActivityTimer()
  publishTyping(signal)
}

/**
 * @param {boolean} publishStop
 */
function detachTypingListeners() {
  const current = hook
  if (!current) return
  try {
    if (onKeyDown) current.off?.('keydown', onKeyDown)
    if (onKeyUp) current.off?.('keyup', onKeyUp)
  } catch {
    // The emitter may already have been stopped.
  }
}

function detachGazeListener() {
  const current = hook
  if (current && onMouseMove) {
    try {
      current.off?.('mousemove', onMouseMove)
    } catch {
      // The emitter may already have been stopped.
    }
  }
  onMouseMove = null
  gazeListening = false
  hookCursor = null
}

function stopNativeHook() {
  const current = hook
  hook = null
  hookRunning = false
  hookStart = null
  if (!current) return
  try {
    current.stop()
  } catch {
    // stop() throws when start() never succeeded. That is the fail-safe path.
  }
}

/**
 * Drop typing listeners. The native hook stays up while gaze still needs
 * global mouse motion; stopping it there would freeze the pet's eyes.
 * @param {boolean} publishStop
 */
function stopHook(publishStop) {
  const wasRunning = hookRunning
  if (activityTimer) clearInterval(activityTimer)
  activityTimer = null
  if (typingTimer) clearTimeout(typingTimer)
  typingTimer = null
  pendingTyping = null
  detachTypingListeners()
  onKeyDown = null
  onKeyUp = null
  if (!gazeListening) stopNativeHook()
  const signal = machine.reset(Date.now())
  if (publishStop && wasRunning) publishTyping(signal)
}

/**
 * uiohook throws if start() runs twice. Typing and gaze share one hook.
 * @param {{ on: Function, start: Function }} loaded
 */
function startNativeHook(loaded) {
  if (hookRunning && hook) return Promise.resolve(hook)
  if (hookStart) return hookStart
  hookStart = Promise.resolve().then(() => {
    if (hookRunning && hook) return hook
    loaded.start()
    hook = loaded
    hookRunning = true
    return hook
  }).finally(() => {
    hookStart = null
  })
  return hookStart
}

function rememberHookCursor(event) {
  const x = Number(event?.x)
  const y = Number(event?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  hookCursor = { x, y }
}

/**
 * Linux gaze needs a cursor source that updates off the pet window.
 * A missing hook leaves the Electron query in place.
 */
async function ensureGazeHook() {
  if (process.platform !== 'linux' || preferences.gazeFollowEnabled !== true) {
    detachGazeListener()
    if (!onKeyDown && !onKeyUp) stopNativeHook()
    return
  }
  if (gazeListening && hookRunning && onMouseMove) return
  const loaded = await loadHook()
  if (process.platform !== 'linux' || preferences.gazeFollowEnabled !== true) return
  if (!loaded) {
    if (!gazeHookWarned) {
      gazeHookWarned = true
      console.warn('[desktop-presence] gaze cursor hook unavailable')
    }
    return
  }
  if (onMouseMove) {
    try { loaded.off?.('mousemove', onMouseMove) } catch { /* already detached */ }
  }
  onMouseMove = (event) => rememberHookCursor(event)
  try {
    loaded.on('mousemove', onMouseMove)
    await startNativeHook(loaded)
    gazeListening = true
    hook = loaded
  } catch (error) {
    try { loaded.off?.('mousemove', onMouseMove) } catch { /* already detached */ }
    onMouseMove = null
    gazeListening = false
    if (!gazeHookWarned) {
      gazeHookWarned = true
      console.warn('[desktop-presence] gaze cursor hook failed:', getRedactedErrorMessage(error))
    }
  }
}

function accessibilityGranted() {
  if (process.platform !== 'darwin') return true
  try {
    return systemPreferences.isTrustedAccessibilityClient(false) === true
  } catch (error) {
    console.warn('[desktop-presence] accessibility check failed:', getRedactedErrorMessage(error))
    return false
  }
}

async function loadHook() {
  try {
    const imported = await import('uiohook-napi')
    const namespace = imported?.uIOhook ? imported : (imported?.default ?? {})
    const candidate = namespace.uIOhook
    if (!candidate || typeof candidate.on !== 'function' || typeof candidate.start !== 'function') {
      return null
    }
    return candidate
  } catch (error) {
    console.warn('[desktop-presence] typing hook unavailable:', getRedactedErrorMessage(error))
    return null
  }
}

/**
 * Linux start failures name Wayland or input-device permissions when we can
 * tell them apart. A missing module stays on the generic unavailable status.
 * @param {unknown} error
 */
function linuxTypingStartFailureStatus(error) {
  const errorMessage = error instanceof Error ? error.message : String(error ?? '')
  const kind = classifyLinuxTypingHookFailure({
    sessionType: process.env.XDG_SESSION_TYPE,
    hasWaylandDisplay: Boolean(process.env.WAYLAND_DISPLAY),
    hasX11Display: Boolean(process.env.DISPLAY),
    errorMessage,
  })
  if (kind === 'wayland') {
    return buildStatus('unavailable', false, {
      messageKey: 'settings.window.typing_linux_wayland',
      recommendationKey: 'settings.window.typing_linux_wayland_hint',
    })
  }
  if (kind === 'permission') {
    return buildStatus('unavailable', false, {
      messageKey: 'settings.window.typing_linux_permission',
      recommendationKey: 'settings.window.typing_linux_permission_hint',
    })
  }
  return buildStatus('unavailable', false, {
    messageKey: 'settings.window.typing_linux_unavailable',
    recommendationKey: 'settings.window.typing_linux_unavailable_hint',
  })
}

async function refreshTyping() {
  const generation = ++typingGeneration
  if (!preferences.typingAwarenessEnabled) {
    stopHook(true)
    setStatus(buildStatus('not-applicable', false))
    return
  }
  if (process.platform === 'darwin' && !accessibilityGranted()) {
    stopHook(true)
    setStatus(buildStatus('denied', false))
    return
  }
  const loaded = await loadHook()
  if (generation !== typingGeneration || !preferences.typingAwarenessEnabled) return
  if (!loaded) {
    stopHook(true)
    setStatus(buildStatus('unavailable', false))
    return
  }
  if (hook === loaded && hookRunning && onKeyDown && onKeyUp) {
    setStatus(buildStatus(process.platform === 'darwin' ? 'granted' : 'not-applicable', true))
    return
  }
  // Gaze may already own the running hook. Stopping it would drop mouse
  // events until start() succeeds again, and start() throws if it is current.
  if (!(hook === loaded && hookRunning && gazeListening)) {
    stopHook(false)
    hook = loaded
  }
  onKeyDown = (event) => {
    const token = typeof event?.keycode === 'number' ? event.keycode : 'unknown'
    noteTyping(machine.keyDown(token, Date.now()))
  }
  onKeyUp = (event) => {
    const token = typeof event?.keycode === 'number' ? event.keycode : 'unknown'
    noteTyping(machine.keyUp(token, Date.now()))
  }
  try {
    hook.on('keydown', onKeyDown)
    hook.on('keyup', onKeyUp)
    await startNativeHook(hook)
    ensureActivityTimer()
    setStatus(buildStatus(process.platform === 'darwin' ? 'granted' : 'not-applicable', true))
  } catch (error) {
    console.warn('[desktop-presence] typing hook start failed:', getRedactedErrorMessage(error))
    stopHook(false)
    if (process.platform === 'linux') {
      setStatus(linuxTypingStartFailureStatus(error))
      return
    }
    setStatus(buildStatus(process.platform === 'darwin' ? 'denied' : 'unavailable', false))
  }
}

function listPetWindows() {
  const windows = []
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win || win.isDestroyed()) continue
    if (!getPetInstanceForWindow(win)) continue
    windows.push(win)
  }
  return windows
}

function petWindowIsActive(win) {
  try {
    return !win.isDestroyed() && win.isVisible() && !win.isMinimized()
  } catch {
    return false
  }
}

function contentBounds(win) {
  try {
    return typeof win.getContentBounds === 'function' ? win.getContentBounds() : win.getBounds()
  } catch {
    return null
  }
}

function readIdleSeconds() {
  try {
    return Math.max(0, powerMonitor.getSystemIdleTime())
  } catch {
    return 0
  }
}

function hookPointToDip(physical) {
  if (typeof screen.screenToDipPoint === 'function') {
    try {
      const dip = screen.screenToDipPoint(physical)
      if (dip && Number.isFinite(dip.x) && Number.isFinite(dip.y)) {
        return { x: dip.x, y: dip.y }
      }
    } catch {
      // The display list can be empty for a moment at startup.
    }
  }
  return { x: physical.x, y: physical.y }
}

function readCursorDip() {
  try {
    let electronPoint = null
    try {
      electronPoint = screen.getCursorScreenPoint()
    } catch (error) {
      if (!cursorFailed) {
        cursorFailed = true
        console.warn('[desktop-presence] cursor sample failed:', getRedactedErrorMessage(error))
      }
    }
    const selected = selectGazeCursor({
      platform: process.platform,
      hookPoint: hookCursor,
      electronPoint,
    })
    if (!selected) return null
    cursorFailed = false
    if (selected.source === 'hook') return hookPointToDip(selected.physical)
    return normalizeCursorToDip(selected.dip, screen)
  } catch (error) {
    if (!cursorFailed) {
      cursorFailed = true
      console.warn('[desktop-presence] cursor sample failed:', getRedactedErrorMessage(error))
    }
    return null
  }
}

function sendGaze(win, sample) {
  if (!win || win.isDestroyed()) return
  try {
    win.webContents.send('desktop-presence:gaze', sample)
  } catch {
    // Ignore a window that closes mid-sample.
  }
}

function armGaze(ms) {
  if (gazeTimer && gazeInterval === ms) return
  if (gazeTimer) clearInterval(gazeTimer)
  gazeInterval = ms
  gazeTimer = setInterval(() => {
    tickGaze()
  }, ms)
}

function tickGaze() {
  if (!started) return
  const windows = listPetWindows()
  const active = windows.filter(petWindowIsActive)
  const paused = gazeSamplingPaused({
    enabled: preferences.gazeFollowEnabled === true,
    visible: active.length > 0,
    minimized: false,
    locked: session.locked,
    suspended: session.suspended,
    idleSeconds: readIdleSeconds(),
  })
  armGaze(paused ? GAZE_RESUME_CHECK_MS : GAZE_SAMPLE_INTERVAL_MS)
  if (paused) {
    if (!pauseSent) {
      lastEmit.clear()
      const sample = toPublicGazeSample(null, true)
      for (const win of windows) sendGaze(win, sample)
      pauseSent = true
    }
    return
  }
  pauseSent = false
  const cursor = readCursorDip()
  if (!cursor) return
  const now = Date.now()
  for (const win of active) {
    const bounds = contentBounds(win)
    if (!bounds) continue
    const relative = cursorRelativeToWindow({
      cursor,
      windowBounds: bounds,
    })
    const sample = toPublicGazeSample(relative, false)
    const id = win.webContents?.id
    if (typeof id !== 'number') continue
    const previous = lastEmit.get(id)
    if (!shouldEmitGazeSample({
      lastPoint: previous?.point ?? null,
      nextPoint: sample,
      lastEmitAt: previous?.at ?? Number.NEGATIVE_INFINITY,
      now,
    })) continue
    lastEmit.set(id, { point: sample, at: now })
    sendGaze(win, sample)
  }
}

function resetTypingForPower() {
  const signal = machine.reset(Date.now())
  publishTyping(signal)
}

function onSuspend() {
  session.suspended = true
  session.locked = true
  resetTypingForPower()
  tickGaze()
}

function onResume() {
  session.suspended = false
  resetTypingForPower()
  tickGaze()
}

function onLock() {
  session.locked = true
  resetTypingForPower()
  tickGaze()
}

function onUnlock() {
  session.locked = false
  tickGaze()
}

function bindPower() {
  try {
    powerMonitor.on('suspend', onSuspend)
    powerMonitor.on('resume', onResume)
    powerMonitor.on('lock-screen', onLock)
    powerMonitor.on('unlock-screen', onUnlock)
  } catch (error) {
    console.warn('[desktop-presence] power listeners unavailable:', getRedactedErrorMessage(error))
  }
}

function unbindPower() {
  powerMonitor.removeListener?.('suspend', onSuspend)
  powerMonitor.removeListener?.('resume', onResume)
  powerMonitor.removeListener?.('lock-screen', onLock)
  powerMonitor.removeListener?.('unlock-screen', onUnlock)
}

function onWindowFocus() {
  if (!preferences.typingAwarenessEnabled || hookRunning) return
  if (currentStatus.permission !== 'denied') return
  void refreshTyping()
}

function bindFocus() {
  app.on('browser-window-focus', onWindowFocus)
}

function unbindFocus() {
  app.removeListener?.('browser-window-focus', onWindowFocus)
}

/**
 * @param {{ gazeFollowEnabled?: boolean, typingAwarenessEnabled?: boolean }} next
 */
export function applyDesktopPresencePreferences(next) {
  preferences = {
    gazeFollowEnabled: next?.gazeFollowEnabled !== false,
    typingAwarenessEnabled: next?.typingAwarenessEnabled === true,
  }
  pauseSent = false
  tickGaze()
  void ensureGazeHook()
  void refreshTyping()
  return currentStatus
}

/** @returns {typeof currentStatus} */
export function getTypingStatus() {
  return currentStatus
}

/**
 * Prompt for macOS Accessibility, then open the pane that is still missing.
 * Accessibility is what `isTrustedAccessibilityClient` can ask for. Input
 * Monitoring is a separate switch and is the usual reason `start()` fails
 * after Accessibility is already granted. Other platforms have no pane to open.
 */
export async function openTypingPermissionSettings() {
  if (process.platform !== 'darwin') {
    return {
      opened: false,
      messageKey: 'settings.window.typing_unavailable',
      recommendationKey: 'settings.window.typing_unavailable_hint',
    }
  }
  const trusted = accessibilityGranted()
  if (!trusted) {
    try {
      systemPreferences.isTrustedAccessibilityClient(true)
    } catch (error) {
      console.warn('[desktop-presence] accessibility prompt failed:', getRedactedErrorMessage(error))
    }
  }
  let opened = false
  const pane = trusted ? 'Privacy_ListenEvent' : 'Privacy_Accessibility'
  try {
    await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
    opened = true
  } catch (error) {
    console.warn('[desktop-presence] permission settings open failed:', getRedactedErrorMessage(error))
  }
  await refreshTyping()
  return {
    opened,
    messageKey: currentStatus.messageKey,
    recommendationKey: currentStatus.recommendationKey,
  }
}

/** Begin cursor sampling and power/focus listeners. Typing stays off until enabled. */
export function startDesktopPresence() {
  if (started) return
  started = true
  try {
    bindPower()
    bindFocus()
    app.once('before-quit', () => {
      stopDesktopPresence()
    })
    armGaze(GAZE_RESUME_CHECK_MS)
    tickGaze()
    void ensureGazeHook()
  } catch (error) {
    console.warn('[desktop-presence] failed to start:', getRedactedErrorMessage(error))
  }
}

/** Stop sampling, drop tracked keys, and unload the typing hook. */
export function stopDesktopPresence() {
  if (!started && !hook && !gazeTimer) return
  started = false
  if (gazeTimer) clearInterval(gazeTimer)
  gazeTimer = null
  gazeInterval = 0
  detachGazeListener()
  stopHook(true)
  unbindPower()
  unbindFocus()
}
