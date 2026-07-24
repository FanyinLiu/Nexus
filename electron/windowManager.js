import { promises as fsp } from 'node:fs'
import { app, BrowserWindow, Menu, nativeImage, screen, shell, Tray } from 'electron'
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

import {
  bindRuntimeWindows,
} from './windowRuntimeState.js'
export {
  runtimeState,
  runtimeClientHeartbeat,
  buildRuntimeStateSnapshot,
  syncRuntimeState,
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
  isDev,
  isSmokeTest,
  SMOKE_RENDERER_TIMEOUT_MS,
  SMOKE_SUCCESS_GRACE_MS,
  SMOKE_FORCE_EXIT_GRACE_MS,
  flushRuntimeLogWriteBuffer,
  settingsReturnFocus,
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

export { probeLocalServiceTarget } from './localServiceProbe.js'

export function getViewKind(event) {
  return BrowserWindow.fromWebContents(event.sender) === panelWindow ? 'panel' : 'pet'
}
