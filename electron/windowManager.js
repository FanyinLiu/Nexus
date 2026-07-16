import { promises as fsp } from 'node:fs'
import { app, BrowserWindow, Menu, nativeImage, screen, shell, Tray } from 'electron'
import nodeNet from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPreloadPath, getRendererEntry } from './rendererServer.js'
import { buildPlatformProfile } from './platformProfile.js'
import { clampWindowPosition, getPanelWindowPosition } from './windowManagerHelpers.js'
import { createSettingsReturnFocusCoordinator } from './settingsReturnFocus.js'
import {
  applyWindowIcon,
  applyWindowsAppDetails,
  createNativeImageFromCandidates,
  getPetIconCandidates,
  getPetIconPath,
} from './windowAssets.js'
import {
  getLaunchOnStartupState,
  setLaunchOnStartupState,
} from './launchOnStartup.js'
import {
  sanitizeRuntimeStatePatch,
} from './windowStateSanitizers.js'
import {
  createRendererRuntimeLogEntry,
  RUNTIME_LOG_DISPLAY_PATH,
  RuntimeLogWriteBuffer,
  sanitizeRuntimeLogMessage,
  serializeRuntimeLogEntry,
} from './runtimeLogSanitizer.js'
import { getSavedBounds, trackWindow } from './services/windowBoundsStore.js'
import { getRedactedErrorMessage } from './services/errorRedaction.js'
import {
  isAllowedRendererNavigation,
  normalizeExternalWindowOpenUrl,
  summarizeWindowNavigationErrorForLog,
  summarizeWindowNavigationUrlForLog,
} from './windowNavigation.js'
import {
  applyPetWindowInstances,
  configurePetWindowInstances,
  destroyPetInstance,
  getPetInstanceForWindow,
  getPetWindowStateForEvent,
  registerPetInstance,
  syncPetInstance,
  syncPetWindowInstances,
  updatePetWindowStateForEvent,
} from './petWindowInstances.js'
import {
  configurePanelWindowController,
  emitPanelWindowState,
  getPanelWindowCreationState,
  isPanelWindowTrackable,
  panelWindowState,
  rememberPanelWindowBounds,
  updatePanelWindowState,
} from './panelWindowController.js'

export {
  getLaunchOnStartupState,
  setLaunchOnStartupState,
} from './launchOnStartup.js'
export { getPetIconPath } from './windowAssets.js'
export {
  getPetWindowStateForEvent,
  updatePetWindowStateForEvent,
  setPetFreeModeForEvent,
} from './petWindowInstances.js'
export {
  panelWindowState,
  updatePanelWindowState,
} from './panelWindowController.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged
const isSmokeTest = process.env.SMOKE_TEST === '1'
const SMOKE_RENDERER_TIMEOUT_MS = 15_000
const SMOKE_SUCCESS_GRACE_MS = 1_200
const SMOKE_FORCE_EXIT_GRACE_MS = 3_000

// ── Renderer console capture (dev-only) ───────────────────────────────────
//
// In dev mode we tail every renderer console.* call into a JSONL file at
// `<projectRoot>/.dev/runtime.log`. The file is truncated at startup so it
// always reflects the current session. Read it with `Read` / `tail` to get
// a complete view of voice / TTS / chat lifecycle without opening DevTools.
// Disabled in packaged builds — there's no project root to write into and
// the in-app DiagnosticsPanel ring buffer covers user-side bug reports.
const RUNTIME_LOG_PATH = isDev
  ? path.join(process.cwd(), '.dev', 'runtime.log')
  : null
let runtimeLogReadyPromise = null
let runtimeLogWriteBuffer = null

function getRuntimeLogWriteBuffer() {
  if (!RUNTIME_LOG_PATH) return null
  if (!runtimeLogWriteBuffer) {
    runtimeLogWriteBuffer = new RuntimeLogWriteBuffer({
      write: async (chunk) => {
        try {
          await fsp.appendFile(RUNTIME_LOG_PATH, chunk)
        } catch {
          // appendFile failure should never crash the main process; just drop.
        }
      },
    })
  }
  return runtimeLogWriteBuffer
}

export function flushRuntimeLogWriteBuffer() {
  return runtimeLogWriteBuffer?.drain() ?? Promise.resolve()
}

async function ensureRuntimeLogReady() {
  if (!RUNTIME_LOG_PATH) return false
  if (runtimeLogReadyPromise) return runtimeLogReadyPromise
  runtimeLogReadyPromise = (async () => {
    try {
      await fsp.mkdir(path.dirname(RUNTIME_LOG_PATH), { recursive: true })
      await fsp.writeFile(RUNTIME_LOG_PATH, '')
      console.info(`[runtime-log] capturing renderer console to ${RUNTIME_LOG_DISPLAY_PATH}`)
      return true
    } catch (err) {
      console.warn('[runtime-log] init failed:', sanitizeRuntimeLogMessage(err?.message ?? err))
      runtimeLogReadyPromise = null
      return false
    }
  })()
  return runtimeLogReadyPromise
}

function attachRendererLogCapture(webContents, label) {
  if (!RUNTIME_LOG_PATH) return
  webContents.on('console-message', async (details) => {
    const ready = await ensureRuntimeLogReady()
    if (!ready) return
    const entry = createRendererRuntimeLogEntry(details, label)
    getRuntimeLogWriteBuffer()?.enqueue(serializeRuntimeLogEntry(entry))
  })
}

const RUNTIME_CLIENT_TTL_MS = 25_000
// macOS Dock overlaps transparent windows near the bottom edge even within
// workArea bounds. Use a larger bottom margin on macOS to keep the pet's
// action buttons (mic, menu) above the Dock hit region.
const PET_WINDOW_SCREEN_MARGIN_PX = process.platform === 'darwin' ? 80 : 24
const PET_WINDOW_DEFAULT_WIDTH = 320
const PET_WINDOW_DEFAULT_HEIGHT = 460
const PET_WINDOW_MIN_WIDTH = 260
const PET_WINDOW_MIN_HEIGHT = 340
const PET_ALWAYS_ON_TOP_LEVEL = 'floating'
const WINDOWS_TRAY_GUID = '4cf28656-71be-4e31-8f33-b83f76e8db10'

export let mainWindow = null
let petHiddenForPanel = false
export let panelWindow = null
let tray = null
let panelBlurTimer = null
let settingsReturnTarget = null
const settingsReturnFocus = createSettingsReturnFocusCoordinator(() => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.show()
  mainWindow.focus()
  mainWindow.moveTop()
  mainWindow.webContents.send('settings:return-focus')
})

export let runtimeState = {
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

export let runtimeClientHeartbeat = {
  pet: 0,
  panel: 0,
}

configurePetWindowInstances({
  getMainWindow: () => mainWindow,
  getPanelWindow: () => panelWindow,
  alwaysOnTopLevel: PET_ALWAYS_ON_TOP_LEVEL,
})
configurePanelWindowController({
  getMainWindow: () => mainWindow,
  getPanelWindow: () => panelWindow,
})

export let panelSection = 'chat'
let panelChatIntent = null

export function hasSystemTray() {
  return Boolean(tray && !tray.isDestroyed?.())
}

// macOS dock visibility is reference-counted so we can toggle on/off as the
// panel window shows/hides without fighting with the app.dock.hide() call
// made at startup. `dockRefCount > 0` means the dock should be visible.
let dockRefCount = 0

function acquireDock() {
  if (process.platform !== 'darwin' || !app.dock) return
  dockRefCount += 1
  if (dockRefCount === 1) {
    try {
      app.dock.show?.()
    } catch (err) {
      console.warn('[macOS] Failed to show dock icon:', getRedactedErrorMessage(err))
    }
  }
}

function releaseDock() {
  if (process.platform !== 'darwin' || !app.dock) return
  if (dockRefCount <= 0) return
  dockRefCount -= 1
  if (dockRefCount === 0) {
    try {
      app.dock.hide?.()
    } catch (err) {
      console.warn('[macOS] Failed to hide dock icon:', getRedactedErrorMessage(err))
    }
  }
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

// Broadcast the latest runtime-state snapshot to every live window EXCEPT the
// one that originated this change.
//
// Skipping the sender is the classical sender-ID pattern for cross-context
// pub-sub (see e.g. BroadcastChannel tutorials). The renderer-side React
// effect that handles `runtime-state:changed` unconditionally calls
// setRuntimeSnapshotState, which forces a re-render, which re-runs the
// upstream `useEffect` that pushed this very state. Without sender-skip,
// every renderer-originated update bounces back to itself at wakeword-frame
// cadence and trips React's "Maximum update depth exceeded" guard. A
// shallow-equal guard on the receive side doesn't help because `updatedAt`
// is stamped on every update, so the echo is never byte-equal to what the
// sender already has.
//
// Windows that DIDN'T originate the change still need to see it (that's the
// whole point of cross-window sync), so we only skip the exact sender.
export function syncRuntimeState(originWebContentsId = null) {
  const snapshot = buildRuntimeStateSnapshot()
  for (const win of [mainWindow, panelWindow]) {
    if (!win || win.isDestroyed()) continue
    if (originWebContentsId !== null && win.webContents.id === originWebContentsId) continue
    win.webContents.send('runtime-state:changed', snapshot)
  }
}

export function syncPetWindowState() {
  syncPetWindowInstances()
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
  // Heartbeat broadcasts only matter for the OTHER window's
  // `petOnline`/`panelOnline` flags; the originator already knows it is
  // online, so skipping it avoids a pointless re-render on every 10 s tick.
  syncRuntimeState(originWebContentsId)
}

export function applyPetWindowState() {
  applyPetWindowInstances()
}


export function getPlatformProfile() {
  const trayActive = hasSystemTray()
  return buildPlatformProfile({
    platform: process.platform,
    packaged: app.isPackaged,
    trayActive,
    launchOnStartupEnabled: getLaunchOnStartupState(),
  })
}

function openExternalUrlFromWindow(url, label) {
  try {
    const safeUrl = normalizeExternalWindowOpenUrl(url)
    shell.openExternal(safeUrl).catch((err) => {
      console.warn(
        `[security] failed to open ${label} external URL:`,
        summarizeWindowNavigationUrlForLog(safeUrl),
        summarizeWindowNavigationErrorForLog(err),
      )
    })
  } catch (err) {
    console.warn(
      `[security] blocked ${label} external URL:`,
      summarizeWindowNavigationUrlForLog(url),
      summarizeWindowNavigationErrorForLog(err),
    )
  }
}

function attachNavigationGuards(win, label, view) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrlFromWindow(url, label)
    return { action: 'deny' }
  })

  // Prevent the renderer from navigating away from the app origin.
  // If an attacker manages to redirect the webContents, the preload bridge
  // would be exposed to an untrusted page.
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = getRendererEntry(view)
    if (!isAllowedRendererNavigation(url, allowed)) {
      console.warn(`[security] blocked ${label} navigation to`, summarizeWindowNavigationUrlForLog(url))
      event.preventDefault()
    }
  })
}

function attachDevToolsShortcut(win) {
  if (app.isPackaged) return

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const isF12 = input.key === 'F12'
    const isCtrlShiftI = (input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i'
    if (isF12 || isCtrlShiftI) {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
  })
}

function trustedRendererWebPreferences() {
  return {
    preload: getPreloadPath(),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  }
}

export function moveMainWindowBy(deltaX, deltaY) {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const bounds = mainWindow.getBounds()
  const { workArea } = screen.getDisplayMatching(bounds)
  const nextX = Math.min(
    Math.max(bounds.x + Math.round(deltaX), workArea.x),
    workArea.x + workArea.width - bounds.width,
  )
  const nextY = Math.min(
    Math.max(bounds.y + Math.round(deltaY), workArea.y),
    workArea.y + workArea.height - bounds.height,
  )

  mainWindow.setPosition(nextX, nextY)
}

export function dragWindowBy(event, delta) {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  if (!sourceWindow || sourceWindow.isDestroyed()) return
  const dragInst = getPetInstanceForWindow(sourceWindow)
  if (dragInst) dragInst.loco.noteDrag(delta)

  const bounds = sourceWindow.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const nextPosition = clampWindowPosition(
    bounds.width,
    bounds.height,
    bounds.x + (delta?.x ?? 0),
    bounds.y + (delta?.y ?? 0),
    display.workArea,
  )
  sourceWindow.setPosition(nextPosition.x, nextPosition.y)
}

// Shared BrowserWindow options for every pet window (primary + clones):
// frameless, transparent, click-through-capable, always-on-top floating.
function petWindowConstructorOptions({ x, y, width, height }) {
  return {
    width,
    height,
    x,
    y,
    show: false,
    paintWhenInitiallyHidden: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minWidth: PET_WINDOW_MIN_WIDTH,
    minHeight: PET_WINDOW_MIN_HEIGHT,
    maxWidth: 1400,
    maxHeight: 1400,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    icon: getPetIconPath(),
    webPreferences: trustedRendererWebPreferences(),
  }
}

export function createMainWindow({ showOnReady = true } = {}) {
  const { workArea } = screen.getPrimaryDisplay()
  const saved = getSavedBounds('pet')
  const width = saved?.width ?? PET_WINDOW_DEFAULT_WIDTH
  const height = saved?.height ?? PET_WINDOW_DEFAULT_HEIGHT
  const { x, y } = saved
    ? clampWindowPosition(width, height, saved.x, saved.y, workArea)
    : clampWindowPosition(
        width,
        height,
        workArea.x + workArea.width - width - PET_WINDOW_SCREEN_MARGIN_PX,
        workArea.y + workArea.height - height - PET_WINDOW_SCREEN_MARGIN_PX,
        workArea,
      )

  const win = new BrowserWindow(petWindowConstructorOptions({ x, y, width, height }))

  applyWindowsAppDetails(win)
  applyWindowIcon(win)
  win.setAlwaysOnTop(true, PET_ALWAYS_ON_TOP_LEVEL)

  attachNavigationGuards(win, 'main-window', 'pet')

  const inst = registerPetInstance(win)

  win.on('close', (event) => {
    const canHideToBackground = process.platform === 'darwin' || hasSystemTray()
    if (app.isQuitting || !canHideToBackground) return
    event.preventDefault()
    win.hide()
  })

  win.on('closed', () => {
    destroyPetInstance(inst)
    mainWindow = null
  })

  win.webContents.on('did-finish-load', () => {
    const bounds = win.getBounds()
    console.log('[pet-window] position on show:', bounds)
    // Keep the companion visible across workspaces where the platform supports
    // it. macOS uses visibleOnFullScreen; Linux maps to the same API without
    // that option. Windows does not support this API.
    if (process.platform === 'darwin') {
      try {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      } catch (err) {
        console.warn('[pet-window] setVisibleOnAllWorkspaces failed:', getRedactedErrorMessage(err))
      }
    } else if (process.platform === 'linux') {
      try {
        win.setVisibleOnAllWorkspaces(true)
      } catch (err) {
        console.warn('[pet-window:linux] setVisibleOnAllWorkspaces failed:', getRedactedErrorMessage(err))
      }
    }
    if (showOnReady) {
      win.show()
      win.focus()
      win.moveTop()
    }
    syncRuntimeState()
    syncPetWindowState()
    inst.loco.start()
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('Renderer failed to load:', errorCode, errorDescription)
    win.show()
  })

  win.webContents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') {
      console.error('Renderer console:', sanitizeRuntimeLogMessage(details.message))
    }
  })

  // Tail every renderer console.* into <projectRoot>/.dev/runtime.log so a
  // remote helper (or `tail -F`) can watch the lifecycle live without
  // anyone opening DevTools. dev-only.
  attachRendererLogCapture(win.webContents, 'pet')

  attachDevToolsShortcut(win)

  win.loadURL(getRendererEntry('pet'))

  if (isSmokeTest) {
    let smokeDone = false
    let forceExitTimer = null
    const watchdog = setTimeout(() => {
      finishSmoke(1, `renderer did not finish loading within ${SMOKE_RENDERER_TIMEOUT_MS}ms`)
    }, SMOKE_RENDERER_TIMEOUT_MS)

    const finishSmoke = (exitCode, reason) => {
      if (smokeDone) return
      smokeDone = true
      clearTimeout(watchdog)
      if (forceExitTimer) clearTimeout(forceExitTimer)
      process.exitCode = exitCode
      if (exitCode === 0) {
        console.info('[smoke] renderer loaded; quitting')
      } else {
        console.error(`[smoke] ${reason}`)
      }
      forceExitTimer = setTimeout(() => app.exit(exitCode), SMOKE_FORCE_EXIT_GRACE_MS)
      forceExitTimer.unref?.()
      app.quit()
    }

    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        finishSmoke(0, 'renderer loaded')
      }, SMOKE_SUCCESS_GRACE_MS)
    })

    win.webContents.once('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame === false) return
      finishSmoke(1, `renderer failed to load ${validatedURL || ''}: ${errorCode} ${errorDescription}`.trim())
    })

    win.once('closed', () => {
      clearTimeout(watchdog)
      if (forceExitTimer) clearTimeout(forceExitTimer)
    })
  }

  mainWindow = win
  trackWindow(win, 'pet')
  return win
}

export function createPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    return panelWindow
  }

  const {
    width,
    height,
    x,
    y,
    resizable,
    minWidth,
    minHeight,
  } = getPanelWindowCreationState()

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    show: false,
    paintWhenInitiallyHidden: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable,
    minWidth,
    minHeight,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    icon: getPetIconPath(),
    webPreferences: trustedRendererWebPreferences(),
  })

  applyWindowsAppDetails(win)
  applyWindowIcon(win)
  attachNavigationGuards(win, 'panel-window', 'panel')

  // Mirror the pet-window log capture for the panel's renderer.
  attachRendererLogCapture(win.webContents, 'panel')

  attachDevToolsShortcut(win)

  // Track dock refcount for this panel window: acquire when it becomes
  // visible, release when it hides or is closed. This restores a dock icon
  // during "app-like" interactions (chat / settings panel) and pulls it back
  // out of sight when the user is only seeing the pet overlay.
  let dockHeldForPanel = false
  const holdDock = () => {
    if (dockHeldForPanel) return
    dockHeldForPanel = true
    acquireDock()
  }
  const releaseDockForPanel = () => {
    if (!dockHeldForPanel) return
    dockHeldForPanel = false
    releaseDock()
  }

  win.on('show', () => {
    holdDock()
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      petHiddenForPanel = true
      mainWindow.hide()
    }
  })
  win.on('hide', () => {
    releaseDockForPanel()
    if (settingsReturnFocus.isPending()) {
      petHiddenForPanel = false
      settingsReturnFocus.consume()
      return
    }
    if (mainWindow && !mainWindow.isDestroyed() && petHiddenForPanel) {
      petHiddenForPanel = false
      mainWindow.showInactive()
    }
  })

  win.on('close', (event) => {
    const canHideToBackground = process.platform === 'darwin' || hasSystemTray()
    if (app.isQuitting || !canHideToBackground) return
    event.preventDefault()
    win.hide()
  })

  win.on('closed', () => {
    if (panelBlurTimer) {
      clearTimeout(panelBlurTimer)
      panelBlurTimer = null
    }
    releaseDockForPanel()
    if (!app.isQuitting) {
      if (settingsReturnFocus.isPending()) {
        petHiddenForPanel = false
        settingsReturnFocus.consume()
      } else if (mainWindow && !mainWindow.isDestroyed() && petHiddenForPanel) {
        petHiddenForPanel = false
        mainWindow.showInactive()
      }
    }
    panelWindow = null
  })

  win.on('blur', () => {
    if (!win.webContents.isDevToolsOpened()) {
      panelBlurTimer = setTimeout(() => {
        if (!win.isDestroyed() && !win.isFocused()) {
          win.hide()
        }
      }, 180)
    }
  })

  win.on('focus', () => {
    if (panelBlurTimer) {
      clearTimeout(panelBlurTimer)
      panelBlurTimer = null
    }
  })

  win.on('resize', () => {
    rememberPanelWindowBounds()
  })

  win.on('move', () => {
    rememberPanelWindowBounds()
  })

  win.webContents.on('did-finish-load', () => {
    syncRuntimeState()
    syncPetWindowState()
    emitPanelWindowState()
    emitPanelSection()
  })

  win.loadURL(getRendererEntry('panel'))

  panelWindow = win
  trackWindow(win, 'panel', { isTrackable: isPanelWindowTrackable })
  return win
}

function emitPanelSection() {
  if (!panelWindow || panelWindow.isDestroyed()) return
  panelWindow.webContents.send('panel-section:changed', { section: panelSection, intent: panelChatIntent })
}

export function setPanelSection(section) {
  panelChatIntent = section === 'chat-text' ? 'text' : section === 'chat-recent' ? 'recent' : null
  panelSection = section === 'settings' ? 'settings' : 'chat'
}

export function getPanelSectionSnapshot() {
  const snapshot = { section: panelSection, intent: panelChatIntent }
  panelChatIntent = null
  return snapshot
}

export function showPanelWindow(section = 'chat', options = {}) {
  if (section === 'settings') {
    settingsReturnTarget = options?.settingsReturnTarget === 'pet' ? 'pet' : 'panel'
  } else {
    settingsReturnTarget = null
    settingsReturnFocus.cancel()
  }
  setPanelSection(section)
  const win = createPanelWindow()

  if (panelBlurTimer) {
    clearTimeout(panelBlurTimer)
    panelBlurTimer = null
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    const mainBounds = mainWindow.getBounds()
    const panelBounds = win.getBounds()
    const { workArea } = screen.getDisplayMatching(mainBounds)
    const nextPosition = getPanelWindowPosition(panelBounds.width, panelBounds.height, mainBounds, workArea)
    win.setPosition(nextPosition.x, nextPosition.y)
  }

  if (win.isMinimized()) {
    win.restore()
  }
  win.show()
  win.focus()
  emitPanelSection()
}

export function closeSettingsWindow() {
  const returnTarget = settingsReturnTarget
  settingsReturnTarget = null
  setPanelSection('chat')

  if (returnTarget !== 'pet') {
    settingsReturnFocus.cancel()
    emitPanelSection()
    return
  }

  settingsReturnFocus.request()
  if (!panelWindow || panelWindow.isDestroyed() || !panelWindow.isVisible()) {
    settingsReturnFocus.consume()
    return
  }

  panelWindow.hide()
}

export function closePanelWindow() {
  settingsReturnTarget = null
  settingsReturnFocus.cancel()
  panelWindow?.hide()
}

export function showPetContextMenu(sourceWindow = mainWindow) {
  if (!sourceWindow || sourceWindow.isDestroyed()) return

  const inst = getPetInstanceForWindow(sourceWindow)

  const menu = Menu.buildFromTemplate([
    {
      label: '对话',
      click: () => {
        showPanelWindow('chat')
      },
    },
    {
      label: '设置',
      click: () => {
        showPanelWindow('settings', { settingsReturnTarget: 'pet' })
      },
    },
    {
      label: '重置位置',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        const { workArea } = screen.getPrimaryDisplay()
        const bounds = mainWindow.getBounds()
        const nextX = workArea.x + Math.round((workArea.width - bounds.width) / 2)
        const nextY = workArea.y + Math.round((workArea.height - bounds.height) / 2)
        mainWindow.setPosition(nextX, nextY)
      },
    },
    {
      label: inst?.state.freeMode
        ? '固定模式（带背景 · 待原地）'
        : '自由模式（满屏走 · 无背景）',
      click: () => {
        if (inst) inst.loco.setFreeMode(!inst.state.freeMode)
      },
    },
    {
      type: 'separator',
    },
    {
      label: '隐藏桌宠',
      click: () => {
        mainWindow?.hide()
      },
    },
    {
      label: '退出',
      click: () => {
        app.quit()
      },
    },
  ])

  menu.popup({ window: sourceWindow })
}

export function createApplicationMenu() {
  if (process.platform === 'darwin') {
    const template = [
      {
        label: app.name,
        submenu: [
          { label: `关于 ${app.name}`, role: 'about' },
          { type: 'separator' },
          { label: '隐藏', role: 'hide' },
          { label: '隐藏其他', role: 'hideOthers' },
          { label: '显示全部', role: 'unhide' },
          { type: 'separator' },
          { label: '退出', role: 'quit' },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { label: '撤销', role: 'undo' },
          { label: '重做', role: 'redo' },
          { type: 'separator' },
          { label: '剪切', role: 'cut' },
          { label: '复制', role: 'copy' },
          { label: '粘贴', role: 'paste' },
          { label: '全选', role: 'selectAll' },
        ],
      },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    return
  }

  const template = [
    {
      label: 'Nexus',
      submenu: [
        {
          label: '显示桌宠',
          click: () => {
            if (panelWindow && !panelWindow.isDestroyed()) panelWindow.hide()
            if (!mainWindow || mainWindow.isDestroyed()) {
              createMainWindow()
              return
            }
            mainWindow.show()
            mainWindow.focus()
            mainWindow.moveTop()
          },
        },
        {
          label: '打开面板',
          click: () => {
            showPanelWindow('chat')
          },
        },
        {
          label: '设置',
          click: () => {
            showPanelWindow('settings')
          },
        },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

export function createTray() {
  try {
    if (process.platform === 'darwin') {
      // macOS menu-bar tray: prefer the circular (no-frame) template icon at
      // 22×22 pt so it works in both light- and dark-mode menu bars. Fall
      // back to the regular app icon if the template asset is missing — on
      // a fresh clone or truncated build the file may not have been shipped.
      const templateCandidates = [
        path.join(__dirname, '..', 'public', 'nexus-trayTemplate@2x.png'),
        path.join(__dirname, '..', 'dist', 'nexus-trayTemplate@2x.png'),
        path.join(process.resourcesPath ?? '', 'nexus-trayTemplate@2x.png'),
      ]
      let templateImage = null
      for (const candidate of templateCandidates) {
        if (!candidate) continue
        const img = nativeImage.createFromPath(candidate)
        if (!img.isEmpty()) {
          templateImage = img
          break
        }
      }
      if (templateImage) {
        const trayIcon = templateImage.resize({ width: 22, height: 22 })
        // Mark as template so the OS inverts it for dark-mode menu bars.
        trayIcon.setTemplateImage?.(true)
        tray = new Tray(trayIcon)
      } else {
        // The menu-bar template asset is missing. Falling back to the
        // full-color app icon looks broken in dark mode (and on light
        // menu bars produces a harsh color mismatch). Skip tray creation
        // entirely — the user can still interact with the pet window
        // directly and via the main application menu — and log loudly
        // so this shows up in support reports instead of getting lost.
        console.error(
          '[tray] macOS template icon missing from build. Tray disabled.',
          { searchedCandidates: templateCandidates },
        )
        tray = null
        return
      }
    } else if (process.platform === 'win32') {
      // Windows: keep tray and taskbar/window icon visually in sync by
      // preferring the same multi-size .ico source.
      const trayCandidates = getPetIconCandidates('win32')
      const trayImage = createNativeImageFromCandidates(trayCandidates)
      const fallbackIcon = trayImage ?? nativeImage.createFromPath(getPetIconPath('win32'))
      tray = new Tray(fallbackIcon, WINDOWS_TRAY_GUID)
    } else {
      // Linux: prefer the monochrome tray silhouette for desktop panels.
      const trayCandidates = [
        path.join(__dirname, '..', 'public', 'nexus-tray.png'),
        path.join(__dirname, '..', 'dist', 'nexus-tray.png'),
        ...getPetIconCandidates('linux'),
      ]
      const trayImage = createNativeImageFromCandidates(trayCandidates)
      tray = new Tray(trayImage ?? nativeImage.createFromPath(getPetIconPath('linux')))
    }
  } catch (err) {
    console.warn('[tray] failed to create system tray:', getRedactedErrorMessage(err))
    tray = null
    return
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示桌宠',
      click: () => {
        mainWindow?.show()
        mainWindow?.moveTop()
      },
    },
    {
      label: '打开面板',
      click: () => {
        showPanelWindow('chat')
      },
    },
    {
      label: '设置',
      click: () => {
        showPanelWindow('settings')
      },
    },
    {
      label: '退出',
      click: () => {
        app.quit()
      },
    },
  ])

  tray.setToolTip('Nexus')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (panelWindow && !panelWindow.isDestroyed()) panelWindow.hide()
    if (!mainWindow) {
      createMainWindow()
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    mainWindow.show()
    mainWindow.focus()
    mainWindow.moveTop()
  })
}

// ── Local service probe ──

function formatLocalServiceProbeError(error, host, port, timeoutMs) {
  const code = String(error?.code || '')
  if (code === 'ECONNREFUSED') {
    return `${host}:${port} 当前拒绝连接，服务可能没有启动。`
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return `${host}:${port} 当前不可达，看看本地网络栈或绑定地址对不对？`
  }
  if (code === 'ETIMEDOUT') {
    return `${host}:${port} 连接超时（${timeoutMs}ms）。`
  }

  return `${host}:${port} 没能连上：${error instanceof Error ? error.message : '未知原因'}`
}

// Host allowlist for local-service probes. The doctor panel's only legit use
// case is "is Ollama / LM Studio / a local provider running on this loopback
// port?", so anything outside loopback is renderer-driven LAN port scanning
// and gets pinned back to 127.0.0.1 before any TCP connect happens. Without
// this, a hostile renderer (XSS / plugin) could turn this IPC into a SSRF
// timing oracle against the user's LAN.
const LOCAL_PROBE_HOST_ALLOWLIST = new Set(['127.0.0.1', 'localhost', '::1'])

function normalizeLocalServiceProbeTarget(target = {}) {
  const rawHost = typeof target.host === 'string' && target.host.trim()
    ? target.host.trim().toLowerCase()
    : '127.0.0.1'
  const host = LOCAL_PROBE_HOST_ALLOWLIST.has(rawHost) ? rawHost : '127.0.0.1'
  const parsedPort = Number(target.port)
  const port = Number.isFinite(parsedPort) ? Math.trunc(parsedPort) : NaN
  const timeoutMs = Math.min(
    8_000,
    Math.max(400, Number.isFinite(Number(target.timeoutMs)) ? Math.trunc(Number(target.timeoutMs)) : 1_600),
  )

  return {
    id: typeof target.id === 'string' && target.id.trim() ? target.id.trim() : `${host}:${target.port ?? ''}`,
    label: typeof target.label === 'string' && target.label.trim() ? target.label.trim() : `${host}:${target.port ?? ''}`,
    host,
    port,
    timeoutMs,
  }
}

export function probeLocalServiceTarget(target = {}) {
  const normalized = normalizeLocalServiceProbeTarget(target)

  if (!Number.isInteger(normalized.port) || normalized.port <= 0 || normalized.port > 65_535) {
    return Promise.resolve({
      ...normalized,
      ok: false,
      latencyMs: null,
      message: '端口好像不对，没法做本地探测。',
    })
  }

  return new Promise((resolve) => {
    const startedAt = Date.now()
    let settled = false
    let socket = null

    const finish = (ok, message) => {
      if (settled) {
        return
      }
      settled = true

      if (socket) {
        socket.removeAllListeners()
        socket.destroy()
      }

      resolve({
        ...normalized,
        ok,
        latencyMs: ok ? Date.now() - startedAt : null,
        message,
      })
    }

    socket = nodeNet.createConnection({
      host: normalized.host,
      port: normalized.port,
    })

    socket.setTimeout(normalized.timeoutMs)
    socket.once('connect', () => {
      finish(true, `${normalized.host}:${normalized.port} 可连接。`)
    })
    socket.once('timeout', () => {
      finish(false, `${normalized.host}:${normalized.port} 连接超时（${normalized.timeoutMs}ms）。`)
    })
    socket.once('error', (error) => {
      finish(false, formatLocalServiceProbeError(error, normalized.host, normalized.port, normalized.timeoutMs))
    })
  })
}

export function getViewKind(event) {
  return BrowserWindow.fromWebContents(event.sender) === panelWindow ? 'panel' : 'pet'
}
