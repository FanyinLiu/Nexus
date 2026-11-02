// @ts-nocheck
import { promises as fsp } from 'node:fs'
import { app, BrowserWindow, Menu, nativeImage, screen, Tray } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPlatformProfile } from './platformProfile.js'
import { clampWindowPosition, getPanelWindowPosition } from './windowManagerHelpers.js'
import { createSettingsReturnFocusCoordinator } from './settingsReturnFocus.js'
import {
  createNativeImageFromCandidates,
  getPetIconCandidates,
  getPetIconPath,
} from './windowAssets.js'
import { getLaunchOnStartupState } from './launchOnStartup.js'
import {
  createRendererRuntimeLogEntry,
  RUNTIME_LOG_DISPLAY_PATH,
  RuntimeLogWriteBuffer,
  sanitizeRuntimeLogMessage,
  serializeRuntimeLogEntry,
} from './runtimeLogSanitizer.js'
import { getRedactedErrorMessage } from './services/errorRedaction.js'
import { mainT } from './mainMessages.js'
import {
  applyPetWindowInstances,
  configurePetWindowInstances,
  getPetInstanceForWindow,
} from './petWindowInstances.js'
import { configurePanelWindowController } from './panelWindowController.js'
import { popupPetContextMenu } from './petContextMenu.js'
import {
  consumePanelSectionIntent,
  initialPanelSectionState,
  panelSectionSnapshot,
  requestPanelSection,
} from '../shared/panelSectionIntent.js'

import {
  bindRuntimeWindows,
} from './windowRuntimeState.js'
export {
  buildRuntimeStateSnapshot,
  updateRuntimeState,
  updateHeartbeat,
} from './windowRuntimeState.js'
import {
  configureWindowCreation,
  createMainWindow,
  createPanelWindow,
} from './windowCreation.js'
export { createMainWindow, createPanelWindow } from './windowCreation.js'

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

const PET_ALWAYS_ON_TOP_LEVEL = 'floating'
const WINDOWS_TRAY_GUID = '4cf28656-71be-4e31-8f33-b83f76e8db10'

/** @type {import('electron').BrowserWindow | null} */
export let mainWindow = null
let petHiddenForPanel = false
/** @type {import('electron').BrowserWindow | null} */
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


configurePetWindowInstances({
  getMainWindow: () => mainWindow,
  getPanelWindow: () => panelWindow,
  alwaysOnTopLevel: PET_ALWAYS_ON_TOP_LEVEL,
})
configurePanelWindowController({
  getMainWindow: () => mainWindow,
  getPanelWindow: () => panelWindow,
})
bindRuntimeWindows({
  getMainWindow: () => mainWindow,
  getPanelWindow: () => panelWindow,
})
configureWindowCreation({
  getMainWindow: () => mainWindow,
  getPanelWindow: () => panelWindow,
  setMainWindow: (win) => { mainWindow = win },
  setPanelWindow: (win) => { panelWindow = win },
  getPetHiddenForPanel: () => petHiddenForPanel,
  setPetHiddenForPanel: (v) => { petHiddenForPanel = v },
  getPanelBlurTimer: () => panelBlurTimer,
  setPanelBlurTimer: (t) => { panelBlurTimer = t },
  attachRendererLogCapture,
  acquireDock,
  releaseDock,
  hasSystemTray,
  syncPetWindowState: () => applyPetWindowInstances(),
  // Function declaration is hoisted; safe to pass before its source location.
  emitPanelSection,
  isSmokeTest,
  SMOKE_RENDERER_TIMEOUT_MS,
  SMOKE_SUCCESS_GRACE_MS,
  SMOKE_FORCE_EXIT_GRACE_MS,
  settingsReturnFocus,
})

export let panelSection = 'chat'
let panelSectionState = initialPanelSectionState()

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

function emitPanelSection() {
  if (!panelWindow || panelWindow.isDestroyed()) return
  panelWindow.webContents.send('panel-section:changed', panelSectionSnapshot(panelSectionState))
}

function setPanelSection(section) {
  panelSectionState = requestPanelSection(panelSectionState, section)
  panelSection = panelSectionState.section
}

/**
 * Catch-up read for a renderer that subscribed after the section event.
 * Clears the intent so this read is not itself a second request; the token
 * stays on the event copy that was already sent.
 * @returns {{ section: 'chat' | 'settings', intent: 'text' | 'recent' | null, intentToken: number }}
 */
export function getPanelSectionSnapshot() {
  const snapshot = panelSectionSnapshot(panelSectionState)
  panelSectionState = consumePanelSectionIntent(panelSectionState)
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

/**
 * Open the pet context menu. Resolves `'messages'` when that item was chosen,
 * otherwise `null` once the menu closes; the IPC handler forwards the result
 * so the renderer can open the inbox overlay.
 * @param {import('electron').BrowserWindow | null} [sourceWindow]
 * @returns {Promise<'messages' | null>}
 */
export function showPetContextMenu(sourceWindow = mainWindow) {
  if (!sourceWindow || sourceWindow.isDestroyed()) return Promise.resolve(null)

  return popupPetContextMenu({
    handlers: {
      chat: () => {
        showPanelWindow('chat')
      },
      settings: () => {
        showPanelWindow('settings', { settingsReturnTarget: 'pet' })
      },
      resetPosition: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        const { workArea } = screen.getPrimaryDisplay()
        const bounds = mainWindow.getBounds()
        const nextX = workArea.x + Math.round((workArea.width - bounds.width) / 2)
        const nextY = workArea.y + Math.round((workArea.height - bounds.height) / 2)
        mainWindow.setPosition(nextX, nextY)
      },
      hidePet: () => {
        mainWindow?.hide()
      },
      quit: () => {
        app.quit()
      },
    },
    popup: (template, onClose) => {
      Menu.buildFromTemplate(template).popup({ window: sourceWindow, callback: onClose })
    },
  })
}

export function createApplicationMenu() {
  if (process.platform === 'darwin') {
    const template = [
      {
        label: app.name,
        submenu: [
          { label: mainT('menu.about', { appName: app.name }), role: 'about' },
          { type: 'separator' },
          { label: mainT('menu.hide'), role: 'hide' },
          { label: mainT('menu.hideOthers'), role: 'hideOthers' },
          { label: mainT('menu.unhide'), role: 'unhide' },
          { type: 'separator' },
          { label: mainT('menu.quit'), role: 'quit' },
        ],
      },
      {
        label: mainT('menu.edit'),
        submenu: [
          { label: mainT('menu.undo'), role: 'undo' },
          { label: mainT('menu.redo'), role: 'redo' },
          { type: 'separator' },
          { label: mainT('menu.cut'), role: 'cut' },
          { label: mainT('menu.copy'), role: 'copy' },
          { label: mainT('menu.paste'), role: 'paste' },
          { label: mainT('menu.selectAll'), role: 'selectAll' },
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
          label: mainT('menu.showPet'),
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
          label: mainT('menu.openPanel'),
          click: () => {
            showPanelWindow('chat')
          },
        },
        {
          label: mainT('menu.settings'),
          click: () => {
            showPanelWindow('settings')
          },
        },
        { type: 'separator' },
        { label: mainT('menu.quit'), role: 'quit' },
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
      label: mainT('menu.showPet'),
      click: () => {
        mainWindow?.show()
        mainWindow?.moveTop()
      },
    },
    {
      label: mainT('menu.openPanel'),
      click: () => {
        showPanelWindow('chat')
      },
    },
    {
      label: mainT('menu.settings'),
      click: () => {
        showPanelWindow('settings')
      },
    },
    {
      label: mainT('menu.quit'),
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

export { probeLocalServiceTarget } from './localServiceProbe.js'

export function getViewKind(event) {
  return BrowserWindow.fromWebContents(event.sender) === panelWindow ? 'panel' : 'pet'
}
