// @ts-nocheck
/**
 * BrowserWindow construction for pet (main) and panel windows.
 * Host (windowManager) injects live window getters/setters and shared helpers.
 */
import { app, BrowserWindow, dialog, screen, shell } from 'electron'
import { getPreloadPath, getRendererEntry } from './rendererServer.js'
import { clampWindowPosition } from './windowManagerHelpers.js'
import {
  applyWindowIcon,
  applyWindowsAppDetails,
  getPetIconPath,
} from './windowAssets.js'
import { getSavedBounds, trackWindow } from './services/windowBoundsStore.js'
import {
  createExternalWindowOpenHandler,
  isAllowedRendererNavigation,
  normalizeExternalWindowOpenUrl,
  summarizeWindowNavigationErrorForLog,
  summarizeWindowNavigationUrlForLog,
} from './windowNavigation.js'
import { externalOpenDialogCopy, normalizeDialogLocale } from './userFacingDialogs.js'
import { getExternalOpenConfirmation } from './services/externalOpenConfirmation.js'
import { bindWindowCapability, unbindWindowCapability } from './ipc/windowCapabilities.js'
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
import {
  checkReminderPanelWakeNow,
  startReminderPanelWakeMonitor,
  stopReminderPanelWakeMonitor,
  syncRuntimeState,
} from './windowRuntimeState.js'
import { sanitizeRuntimeLogMessage } from './runtimeLogSanitizer.js'
import { createLogger } from './logger.js'
import {
  clearPanelNavigationFailure,
  markPanelNavigationFailed,
} from './panelContentReady.js'
import { trustedRendererWebPreferences } from './webPreferences.js'
import { createWindowLoadRetry } from './windowLoadRetry.js'
import {
  PET_LOAD_FALLBACK_RETRY_URL,
  getPetLoadFallbackPath,
} from './windowLoadFallback.js'

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
let cancelFirstUsePanelRetirement = () => {}
let isSmokeTest = false
let SMOKE_RENDERER_TIMEOUT_MS = 15_000
let SMOKE_SUCCESS_GRACE_MS = 1_200
let SMOKE_FORCE_EXIT_GRACE_MS = 3_000
let settingsReturnFocus = {
  isPending: () => false,
  consume: () => {},
  cancel: () => {},
  request: () => {},
}

// A panel whose main frame never loaded cannot render a second open. Retry a
// bounded number of times, then destroy it so the next open creates a fresh
// window. The pet uses the same budget but cannot be destroyed: there is no
// automatic recreate path, and on Linux without a tray the app quits when its
// last window closes. Only the numeric error code is logged: URLs and page
// content never reach the console.
const WINDOW_LOAD_RETRY_LIMIT = 2
const WINDOW_LOAD_RETRY_BASE_DELAY_MS = 250
const panelLog = createLogger('panel.window')
const petLog = createLogger('pet.window')

// macOS Dock overlaps transparent windows near the bottom edge even within
// workArea bounds. Use a larger bottom margin on macOS to keep the pet's
// action buttons (mic, menu) above the Dock hit region.
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
  cancelFirstUsePanelRetirement = deps.cancelFirstUsePanelRetirement ?? (() => {})
  isSmokeTest = deps.isSmokeTest
  SMOKE_RENDERER_TIMEOUT_MS = deps.SMOKE_RENDERER_TIMEOUT_MS
  SMOKE_SUCCESS_GRACE_MS = deps.SMOKE_SUCCESS_GRACE_MS
  SMOKE_FORCE_EXIT_GRACE_MS = deps.SMOKE_FORCE_EXIT_GRACE_MS
  settingsReturnFocus = deps.settingsReturnFocus
}

function readExternalOpenLocale() {
  const saved = getExternalOpenConfirmation().uiLanguage
  if (saved) return saved
  try {
    return app.getLocale()
  } catch {
    return 'en-US'
  }
}

function readPetLoadFallbackLocale() {
  try {
    return normalizeDialogLocale(readExternalOpenLocale())
  } catch {
    return 'en-US'
  }
}

async function confirmExternalWindowOpen(parent, url) {
  const copy = externalOpenDialogCopy(readExternalOpenLocale())
  const dialogOptions = {
    type: 'question',
    buttons: [copy.open, copy.cancel],
    defaultId: 1,
    cancelId: 1,
    title: copy.title,
    message: copy.message,
    detail: url,
    noLink: true,
  }
  try {
    const parentReady = parent && typeof parent.isDestroyed === 'function' && !parent.isDestroyed()
    const { response } = parentReady
      ? await dialog.showMessageBox(parent, dialogOptions)
      : await dialog.showMessageBox(dialogOptions)
    return response === 0
  } catch (err) {
    console.warn('[security] external open confirmation failed:', getRedactedErrorMessage(err))
    return false
  }
}

function reportBlockedExternalOpen(label, url, err) {
  console.warn(
    `[security] blocked ${label} external URL:`,
    summarizeWindowNavigationUrlForLog(url),
    summarizeWindowNavigationErrorForLog(err),
  )
}

function reportExternalOpenFailure(label, safeUrl, err) {
  console.warn(
    `[security] failed to open ${label} external URL:`,
    summarizeWindowNavigationUrlForLog(safeUrl),
    summarizeWindowNavigationErrorForLog(err),
  )
}

const openExternalUrlFromWindow = createExternalWindowOpenHandler({
  normalizeUrl: normalizeExternalWindowOpenUrl,
  getRequiresConfirmation: () => getExternalOpenConfirmation().requiresConfirmation,
  confirmOpen: (parent, url) => confirmExternalWindowOpen(parent, url),
  openExternal: (url) => shell.openExternal(url),
  reportBlocked: reportBlockedExternalOpen,
  reportOpenFailed: reportExternalOpenFailure,
})

function attachNavigationGuards(win, label, view) {
  const viewKind = view === 'panel' ? 'panel' : 'pet'
  const contents = win.webContents
  bindWindowCapability(contents, viewKind)
  contents.once('destroyed', () => {
    unbindWindowCapability(contents)
  })

  contents.setWindowOpenHandler(({ url }) => {
    void openExternalUrlFromWindow(url, label, win)
    return { action: 'deny' }
  })

  const leavesEntryRole = (url) => !isAllowedRendererNavigation(url, getRendererEntry(view))

  // Prevent the renderer from navigating away from the app origin or into
  // the other window's view role. If an attacker manages to redirect the
  // webContents, the preload bridge would be exposed to an untrusted page.
  contents.on('will-navigate', (event, url) => {
    // A caller-owned listener that ran first may have handled an app-initiated
    // navigation (for example the pet's local fallback retry). It never allows
    // an outside URL, so the guard's remaining checks do not apply.
    if (event.defaultPrevented) return
    if (leavesEntryRole(url)) {
      console.warn(`[security] blocked ${label} navigation to`, summarizeWindowNavigationUrlForLog(url))
      event.preventDefault()
    }
  })

  // replaceState and hash edits do not emit will-navigate, but they do change
  // the document URL. Privilege is already bound to this webContents; reverting
  // the URL keeps the page from painting the other view role.
  let restoringEntry = false
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame === false || restoringEntry) return
    if (!leavesEntryRole(url)) return
    console.warn(`[security] blocked ${label} in-page view change to`, summarizeWindowNavigationUrlForLog(url))
    restoringEntry = true
    const entry = getRendererEntry(view)
    contents.loadURL(entry).catch((err) => {
      console.warn(
        `[security] failed to restore ${label} entry URL:`,
        summarizeWindowNavigationErrorForLog(err),
      )
    }).finally(() => {
      restoringEntry = false
    })
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
    webPreferences: trustedRendererWebPreferences(getPreloadPath()),
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

  const inst = registerPetInstance(win)

  const getPetEntryUrl = () => getRendererEntry('pet')
  let hasLoadedOnce = false
  let fallbackShowPending = false
  let showingFallback = false

  // Both the tray show and the fallback page's retry control end up here, so an
  // exhausted pet always gets one fresh navigation through the same budget.
  const retryIfShowingFallback = () => {
    if (!showingFallback) return false
    if (!loadRetry.retryIfExhausted()) return false
    showingFallback = false
    return true
  }

  const loadRetry = createWindowLoadRetry({
    win,
    loadUrl: getPetEntryUrl,
    log: petLog,
    retryLimit: WINDOW_LOAD_RETRY_LIMIT,
    baseDelayMs: WINDOW_LOAD_RETRY_BASE_DELAY_MS,
    shouldIgnoreFinish: () => showingFallback,
    onReady: () => {
      showingFallback = false
      hasLoadedOnce = true
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
    },
    onExhausted: () => {
      if (win.isDestroyed() || showingFallback) return
      if (hasLoadedOnce) {
        // Destroying the pet clears mainWindow and no create path rebuilds it
        // automatically; on Linux without a tray it also quits the app. Hide the
        // raw Electron error page instead and leave the process/tray alive so a
        // user-initiated show can reload it once the renderer is available.
        win.hide()
        return
      }
      // First launch never completed: hiding would leave Linux without a tray
      // with nothing visible and no way back. Show the packaged static retry
      // page instead of Electron's error page, a blank view, or a data URL.
      // The UI-language setting rides along as `?lang=`, and the page itself
      // falls back to navigator.language when it cannot read the query.
      showingFallback = true
      fallbackShowPending = true
      win.loadFile(getPetLoadFallbackPath(), {
        query: { lang: readPetLoadFallbackLocale() },
      }).catch(() => undefined)
      win.show()
    },
  })

  // The fallback page's retry control navigates to this sentinel. Cancel the
  // navigation and run the normal recovery path instead. Registered before the
  // security guard so an app-initiated retry is not reported as a blocked
  // external navigation.
  win.webContents.on('will-navigate', (event, url) => {
    if (!showingFallback || url !== PET_LOAD_FALLBACK_RETRY_URL) return
    event.preventDefault()
    retryIfShowingFallback()
  })

  attachNavigationGuards(win, 'main-window', 'pet')

  // Tray, Dock, app-menu, and second-instance shows all land here. An exhausted
  // window gets one fresh navigation instead of re-exposing the error page. The
  // fallback show above is not a user request for a reload.
  win.on('show', () => {
    if (fallbackShowPending) {
      fallbackShowPending = false
      return
    }
    if (retryIfShowingFallback()) return
    loadRetry.retryIfExhausted()
  })

  win.on('hide', () => {
    fallbackShowPending = false
  })

  win.on('close', (event) => {
    const canHideToBackground = process.platform === 'darwin' || hasSystemTray()
    if (app.isQuitting || !canHideToBackground) return
    event.preventDefault()
    win.hide()
  })

  win.on('closed', () => {
    loadRetry.dispose()
    destroyPetInstance(inst)
    _setMainWindow(null)
    // The panel may be the surviving window; tell it immediately instead of
    // waiting for the next monitor poll.
    checkReminderPanelWakeNow()
  })

  win.webContents.on('did-finish-load', loadRetry.handleDidFinishLoad)

  win.webContents.on('did-fail-load', loadRetry.handleDidFailLoad)

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
  return createPanelWindowWithOptions()
}

/**
 * @param {{
 *   startWakeMonitor?: boolean,
 *   onRendererReady?: (win: import('electron').BrowserWindow) => void,
 *   onRendererFailed?: (win: import('electron').BrowserWindow) => void,
 * }} [options]
 */
export function createPanelWindowWithOptions(options = {}) {
  const existing = getPanelWindow()
  if (existing && !existing.isDestroyed()) return existing
  const startWakeMonitor = options.startWakeMonitor !== false

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
    webPreferences: trustedRendererWebPreferences(getPreloadPath()),
  })

  applyWindowsAppDetails(win)
  applyWindowIcon(win)
  attachNavigationGuards(win, 'panel-window', 'panel')

  // Mirror the pet-window log capture for the panel's renderer.
  attachRendererLogCapture(win.webContents, 'panel')

  attachDevToolsShortcut(win)

  const loadRetry = createWindowLoadRetry({
    win,
    loadUrl: () => getRendererEntry('panel'),
    log: panelLog,
    retryLimit: WINDOW_LOAD_RETRY_LIMIT,
    baseDelayMs: WINDOW_LOAD_RETRY_BASE_DELAY_MS,
    onNavigationFailed: () => markPanelNavigationFailed(win),
    onErrorPageFinish: () => queueMicrotask(() => clearPanelNavigationFailure(win)),
    onReady: () => {
      clearPanelNavigationFailure(win)
      syncRuntimeState()
      syncPetWindowState()
      emitPanelWindowState()
      emitPanelSection()
      options.onRendererReady?.(win)
    },
    onExhausted: () => {
      options.onRendererFailed?.(win)
      if (!win.isDestroyed()) win.destroy()
    },
  })

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
    cancelFirstUsePanelRetirement()
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
    loadRetry.dispose()
    cancelFirstUsePanelRetirement()
    stopReminderPanelWakeMonitor()
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
    cancelFirstUsePanelRetirement()
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

  win.webContents.on('did-fail-load', loadRetry.handleDidFailLoad)

  win.webContents.on('did-finish-load', loadRetry.handleDidFinishLoad)

  win.loadURL(getRendererEntry('panel'))

  _setPanelWindow(win)
  trackWindow(win, 'panel', { isTrackable: isPanelWindowTrackable })
  if (startWakeMonitor) startReminderPanelWakeMonitor()
  return win
}

