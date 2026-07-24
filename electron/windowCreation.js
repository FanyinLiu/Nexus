/**
 * BrowserWindow construction for pet (main) and panel windows.
 * Host (windowManager) injects live window getters/setters and shared helpers.
 */
import { app, BrowserWindow, screen, shell } from 'electron'
import { getPreloadPath, getRendererEntry } from './rendererServer.js'
import { clampWindowPosition, getPanelWindowPosition } from './windowManagerHelpers.js'
import {
  applyWindowIcon,
  applyWindowsAppDetails,
  getPetIconPath,
} from './windowAssets.js'
import { getSavedBounds, trackWindow } from './services/windowBoundsStore.js'
import {
  isAllowedRendererNavigation,
  normalizeExternalWindowOpenUrl,
  summarizeWindowNavigationErrorForLog,
  summarizeWindowNavigationUrlForLog,
} from './windowNavigation.js'
import {
  getPanelWindowCreationState,
  isPanelWindowTrackable,
  rememberPanelWindowBounds,
  emitPanelWindowState,
} from './panelWindowController.js'
import {
  destroyPetInstance,
  registerPetInstance,
} from './petWindowInstances.js'
import { getRedactedErrorMessage } from './services/errorRedaction.js'
import { syncRuntimeState } from './windowRuntimeState.js'
import { sanitizeRuntimeLogMessage } from './runtimeLogSanitizer.js'

let getMainWindow = () => null
let getPanelWindow = () => null
let _setMainWindow = () => {}
let _setPanelWindow = () => {}
let getPetHiddenForPanel = () => false
let _setPetHiddenForPanel = () => {}
let getPanelBlurTimer = () => null
let _setPanelBlurTimer = () => {}
let attachRendererLogCapture = () => {}
let acquireDock = () => {}
let releaseDock = () => {}
let hasSystemTray = () => false
let syncPetWindowState = () => {}
let emitPanelSection = () => {}
let isDev = false
let isSmokeTest = false
let SMOKE_RENDERER_TIMEOUT_MS = 15_000
let SMOKE_SUCCESS_GRACE_MS = 1_200
let SMOKE_FORCE_EXIT_GRACE_MS = 3_000
let flushRuntimeLogWriteBuffer = async () => {}
let settingsReturnFocus = {
  isPending: () => false,
  consume: () => {},
  cancel: () => {},
  request: () => {},
}

const PET_WINDOW_SCREEN_MARGIN_PX = process.platform === 'darwin' ? 80 : 24
const PET_WINDOW_DEFAULT_WIDTH = 320
const PET_WINDOW_DEFAULT_HEIGHT = 460
const PET_WINDOW_MIN_WIDTH = 260
const PET_WINDOW_MIN_HEIGHT = 340
const PET_ALWAYS_ON_TOP_LEVEL = 'floating'

export function configureWindowCreation(deps) {
  getMainWindow = deps.getMainWindow
  getPanelWindow = deps.getPanelWindow
  _setMainWindow = deps.setMainWindow
  _setPanelWindow = deps.setPanelWindow
  getPetHiddenForPanel = deps.getPetHiddenForPanel
  _setPetHiddenForPanel = deps.setPetHiddenForPanel
  getPanelBlurTimer = deps.getPanelBlurTimer
  _setPanelBlurTimer = deps.setPanelBlurTimer
  attachRendererLogCapture = deps.attachRendererLogCapture
  acquireDock = deps.acquireDock
  releaseDock = deps.releaseDock
  hasSystemTray = deps.hasSystemTray
  syncPetWindowState = deps.syncPetWindowState
  emitPanelSection = deps.emitPanelSection
  isDev = deps.isDev
  isSmokeTest = deps.isSmokeTest
  SMOKE_RENDERER_TIMEOUT_MS = deps.SMOKE_RENDERER_TIMEOUT_MS
  SMOKE_SUCCESS_GRACE_MS = deps.SMOKE_SUCCESS_GRACE_MS
  SMOKE_FORCE_EXIT_GRACE_MS = deps.SMOKE_FORCE_EXIT_GRACE_MS
  flushRuntimeLogWriteBuffer = deps.flushRuntimeLogWriteBuffer
  settingsReturnFocus = deps.settingsReturnFocus
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
    _setMainWindow(null)
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

  _setMainWindow(win)
  trackWindow(win, 'pet')
  return win
}

export function createPanelWindow() {
  if (getPanelWindow() && !getPanelWindow().isDestroyed()) {
    return getPanelWindow()
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
    if (getMainWindow() && !getMainWindow().isDestroyed() && getMainWindow().isVisible()) {
      _setPetHiddenForPanel(true)
      getMainWindow().hide()
    }
  })
  win.on('hide', () => {
    releaseDockForPanel()
    if (settingsReturnFocus.isPending()) {
      _setPetHiddenForPanel(false)
      settingsReturnFocus.consume()
      return
    }
    if (getMainWindow() && !getMainWindow().isDestroyed() && getPetHiddenForPanel()) {
      _setPetHiddenForPanel(false)
      getMainWindow().showInactive()
    }
  })

  win.on('close', (event) => {
    const canHideToBackground = process.platform === 'darwin' || hasSystemTray()
    if (app.isQuitting || !canHideToBackground) return
    event.preventDefault()
    win.hide()
  })

  win.on('closed', () => {
    if (getPanelBlurTimer()) {
      clearTimeout(getPanelBlurTimer())
      _setPanelBlurTimer(null)
    }
    releaseDockForPanel()
    if (!app.isQuitting) {
      if (settingsReturnFocus.isPending()) {
        _setPetHiddenForPanel(false)
        settingsReturnFocus.consume()
      } else if (getMainWindow() && !getMainWindow().isDestroyed() && getPetHiddenForPanel()) {
        _setPetHiddenForPanel(false)
        getMainWindow().showInactive()
      }
    }
    _setPanelWindow(null)
  })

  win.on('blur', () => {
    if (!win.webContents.isDevToolsOpened()) {
      _setPanelBlurTimer(setTimeout(() => {
        if (!win.isDestroyed() && !win.isFocused()) {
          win.hide()
        }
      }, 180))
    }
  })

  win.on('focus', () => {
    if (getPanelBlurTimer()) {
      clearTimeout(getPanelBlurTimer())
      _setPanelBlurTimer(null)
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

  _setPanelWindow(win)
  trackWindow(win, 'panel', { isTrackable: isPanelWindowTrackable })
  return win
}

