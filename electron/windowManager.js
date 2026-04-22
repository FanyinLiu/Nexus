import { app, BrowserWindow, Menu, nativeImage, screen, shell, Tray } from 'electron'
import nodeNet from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPreloadPath, getRendererEntry } from './rendererServer.js'
import { clampWindowPosition, getPanelWindowPosition, PANEL_WINDOW_GAP_PX } from './windowManagerHelpers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged
const isSmokeTest = process.env.SMOKE_TEST === '1'

const RUNTIME_CLIENT_TTL_MS = 25_000
// macOS Dock overlaps transparent windows near the bottom edge even within
// workArea bounds. Use a larger bottom margin on macOS to keep the pet's
// action buttons (mic, menu) above the Dock hit region.
const PET_WINDOW_SCREEN_MARGIN_PX = process.platform === 'darwin' ? 80 : 24
const PANEL_WINDOW_DEFAULT_WIDTH = 540
const PANEL_WINDOW_DEFAULT_HEIGHT = 780
const PANEL_WINDOW_MIN_WIDTH = 500
const PANEL_WINDOW_MIN_HEIGHT = 720
const PANEL_WINDOW_COLLAPSED_WIDTH = 380
const PANEL_WINDOW_COLLAPSED_HEIGHT = 92

export let mainWindow = null
export let panelWindow = null
let tray = null
let panelBlurTimer = null

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

export let panelWindowState = {
  collapsed: false,
}

let panelWindowExpandedBounds = null

export let petWindowState = {
  isPinned: true,
  clickThrough: false,
  petHotspotActive: false,
}

export let panelSection = 'chat'

function getPetIconPath() {
  const ext = process.platform === 'win32' ? 'ico' : 'png'
  const name = ext === 'png' ? 'nexus-256' : 'nexus'
  return isDev
    ? path.join(__dirname, '..', 'public', `${name}.${ext}`)
    : path.join(__dirname, '..', 'dist', `${name}.${ext}`)
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
      console.warn('[macOS] Failed to show dock icon:', err?.message)
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
      console.warn('[macOS] Failed to hide dock icon:', err?.message)
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
  for (const win of [mainWindow, panelWindow]) {
    if (!win || win.isDestroyed()) continue
    win.webContents.send('pet-window:state-changed', petWindowState)
  }
}

function sanitizePartialState(partialState) {
  const safe = Object.create(null)
  for (const [key, value] of Object.entries(partialState)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    safe[key] = value
  }
  return safe
}

export function updateRuntimeState(partialState, originWebContentsId = null) {
  const safe = sanitizePartialState(partialState)
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
  if (!mainWindow || mainWindow.isDestroyed()) return

  mainWindow.setAlwaysOnTop(Boolean(petWindowState.isPinned), process.platform === 'darwin' ? 'floating' : 'screen-saver')
  mainWindow.setIgnoreMouseEvents(
    Boolean(petWindowState.clickThrough) && !Boolean(petWindowState.petHotspotActive),
    { forward: true },
  )
}

export function updatePetWindowState(partialState = {}) {
  const safe = sanitizePartialState(partialState)
  petWindowState = {
    ...petWindowState,
    ...safe,
  }

  applyPetWindowState()
  syncPetWindowState()
  return petWindowState
}

export function getLaunchOnStartupState() {
  if (!app.isPackaged) {
    return false
  }

  try {
    return Boolean(app.getLoginItemSettings().openAtLogin)
  } catch {
    return false
  }
}

export function setLaunchOnStartupState(value) {
  if (!app.isPackaged) {
    return false
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(value),
    })
  } catch {
    return false
  }

  return getLaunchOnStartupState()
}

// clampWindowPosition and getPanelWindowPosition are imported from
// windowManagerHelpers.js — kept Electron-free for unit testing.

function rememberPanelWindowBounds() {
  if (!panelWindow || panelWindow.isDestroyed() || panelWindowState.collapsed) return
  panelWindowExpandedBounds = panelWindow.getBounds()
}

function emitPanelWindowState() {
  if (!panelWindow || panelWindow.isDestroyed()) return
  panelWindow.webContents.send('panel-window:state-changed', panelWindowState)
}

function getExpandedPanelBounds() {
  if (panelWindowExpandedBounds) {
    return {
      width: Math.max(panelWindowExpandedBounds.width, PANEL_WINDOW_MIN_WIDTH),
      height: Math.max(panelWindowExpandedBounds.height, PANEL_WINDOW_MIN_HEIGHT),
      x: panelWindowExpandedBounds.x,
      y: panelWindowExpandedBounds.y,
    }
  }

  const ownerBounds = mainWindow?.getBounds()
  const { workArea } = ownerBounds
    ? screen.getDisplayMatching(ownerBounds)
    : screen.getPrimaryDisplay()
  const position = getPanelWindowPosition(
    PANEL_WINDOW_DEFAULT_WIDTH,
    PANEL_WINDOW_DEFAULT_HEIGHT,
    ownerBounds,
    workArea,
  )

  return {
    width: PANEL_WINDOW_DEFAULT_WIDTH,
    height: PANEL_WINDOW_DEFAULT_HEIGHT,
    x: position.x,
    y: position.y,
  }
}

export function updatePanelWindowState(partialState = {}) {
  const safe = sanitizePartialState(partialState)
  panelWindowState = {
    ...panelWindowState,
    ...safe,
  }

  if (!panelWindow || panelWindow.isDestroyed()) {
    return panelWindowState
  }

  if (panelWindowState.collapsed) {
    panelWindowExpandedBounds = panelWindow.getBounds()
    const currentBounds = panelWindow.getBounds()
    const { workArea } = screen.getDisplayMatching(currentBounds)
    const nextPosition = clampWindowPosition(
      PANEL_WINDOW_COLLAPSED_WIDTH,
      PANEL_WINDOW_COLLAPSED_HEIGHT,
      currentBounds.x,
      currentBounds.y + Math.max(currentBounds.height - PANEL_WINDOW_COLLAPSED_HEIGHT, 0),
      workArea,
    )

    panelWindow.setResizable(false)
    panelWindow.setMinimumSize(PANEL_WINDOW_COLLAPSED_WIDTH, PANEL_WINDOW_COLLAPSED_HEIGHT)
    panelWindow.setBounds({
      x: nextPosition.x,
      y: nextPosition.y,
      width: PANEL_WINDOW_COLLAPSED_WIDTH,
      height: PANEL_WINDOW_COLLAPSED_HEIGHT,
    }, true)
  } else {
    const expandedBounds = getExpandedPanelBounds()
    const { workArea } = screen.getDisplayMatching(expandedBounds)
    const nextPosition = clampWindowPosition(
      expandedBounds.width,
      expandedBounds.height,
      expandedBounds.x,
      expandedBounds.y,
      workArea,
    )

    panelWindow.setResizable(true)
    panelWindow.setMinimumSize(PANEL_WINDOW_MIN_WIDTH, PANEL_WINDOW_MIN_HEIGHT)
    panelWindow.setBounds({
      x: nextPosition.x,
      y: nextPosition.y,
      width: expandedBounds.width,
      height: expandedBounds.height,
    }, true)
  }

  emitPanelWindowState()
  return panelWindowState
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

export function createMainWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  const width = 420
  const height = 620
  const { x, y } = clampWindowPosition(
    width,
    height,
    workArea.x + workArea.width - width - PET_WINDOW_SCREEN_MARGIN_PX,
    workArea.y + workArea.height - height - PET_WINDOW_SCREEN_MARGIN_PX,
    workArea,
  )

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minWidth: 280,
    minHeight: 400,
    maxWidth: 1400,
    maxHeight: 1400,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    icon: getPetIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  win.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver')

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url)
      }
    } catch { /* ignore malformed URLs */ }
    return { action: 'deny' }
  })

  // Prevent the renderer from navigating away from the app origin.
  // If an attacker manages to redirect the webContents, the preload bridge
  // would be exposed to an untrusted page.
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = getRendererEntry()
    if (!url.startsWith(allowed)) {
      console.warn('[security] blocked main-window navigation to', url)
      event.preventDefault()
    }
  })

  win.on('closed', () => {
    mainWindow = null
  })

  win.webContents.on('did-finish-load', () => {
    const bounds = win.getBounds()
    console.log('[pet-window] position on show:', bounds)
    // On macOS the pet should follow the user across Spaces and stay visible
    // even when another app enters fullscreen mode — otherwise switching to a
    // fullscreen Safari/Chrome hides the companion entirely.
    if (process.platform === 'darwin') {
      try {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      } catch (err) {
        console.warn('[pet-window] setVisibleOnAllWorkspaces failed:', err?.message)
      }
    }
    win.show()
    win.focus()
    win.moveTop()
    syncRuntimeState()
    syncPetWindowState()
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('Renderer failed to load:', errorCode, errorDescription)
    win.show()
  })

  win.webContents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') {
      console.error('Renderer console:', details.message)
    }
  })

  // F12 / Ctrl+Shift+I → open DevTools (dev builds only).
  if (!app.isPackaged) {
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

  win.loadURL(getRendererEntry('pet'))

  if (isSmokeTest) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        app.quit()
      }, 1200)
    })
  }

  mainWindow = win
  return win
}

export function createPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    return panelWindow
  }

  const ownerBounds = mainWindow?.getBounds()
  const width = panelWindowState.collapsed ? PANEL_WINDOW_COLLAPSED_WIDTH : PANEL_WINDOW_DEFAULT_WIDTH
  const height = panelWindowState.collapsed ? PANEL_WINDOW_COLLAPSED_HEIGHT : PANEL_WINDOW_DEFAULT_HEIGHT
  const { workArea } = ownerBounds
    ? screen.getDisplayMatching(ownerBounds)
    : screen.getPrimaryDisplay()
  const { x, y } = panelWindowState.collapsed
    ? clampWindowPosition(
        width,
        height,
        (panelWindowExpandedBounds?.x ?? ownerBounds?.x ?? workArea.x + workArea.width - width - 72),
        (panelWindowExpandedBounds?.y ?? ownerBounds?.y ?? workArea.y + 72) + Math.max((panelWindowExpandedBounds?.height ?? height) - height, 0),
        workArea,
      )
    : getPanelWindowPosition(width, height, ownerBounds, workArea)

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    show: false,
    frame: false,
    transparent: false,
    hasShadow: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: !panelWindowState.collapsed,
    minWidth: panelWindowState.collapsed ? PANEL_WINDOW_COLLAPSED_WIDTH : PANEL_WINDOW_MIN_WIDTH,
    minHeight: panelWindowState.collapsed ? PANEL_WINDOW_COLLAPSED_HEIGHT : PANEL_WINDOW_MIN_HEIGHT,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    backgroundColor: '#f3f3f3',
    icon: getPetIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url)
      }
    } catch { /* ignore malformed URLs */ }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const allowed = getRendererEntry()
    if (!url.startsWith(allowed)) {
      console.warn('[security] blocked panel-window navigation to', url)
      event.preventDefault()
    }
  })

  // F12 / Ctrl+Shift+I → open DevTools (dev builds only).
  if (!app.isPackaged) {
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

  win.on('show', holdDock)
  win.on('hide', releaseDockForPanel)

  win.on('closed', () => {
    if (panelBlurTimer) {
      clearTimeout(panelBlurTimer)
      panelBlurTimer = null
    }
    releaseDockForPanel()
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
  })

  win.loadURL(getRendererEntry('panel'))

  panelWindow = win
  return win
}

function emitPanelSection() {
  if (!panelWindow || panelWindow.isDestroyed()) return
  panelWindow.webContents.send('panel-section:changed', { section: panelSection })
}

export function setPanelSection(section) {
  panelSection = section === 'settings' ? 'settings' : 'chat'
}

export function showPanelWindow(section = 'chat') {
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

export function showPetContextMenu(sourceWindow = mainWindow) {
  if (!sourceWindow || sourceWindow.isDestroyed()) return

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
        showPanelWindow('settings')
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
  if (process.platform !== 'darwin') {
    // On Windows/Linux the tray context menu is sufficient.
    Menu.setApplicationMenu(null)
    return
  }

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
    } else {
      // Windows / Linux: prefer the monochrome 22×22 tray silhouette over
      // the full-colour app icon so it reads cleanly at taskbar sizes.
      // Falls back to the app icon if the tray asset is missing from the
      // build (e.g. truncated `dist/`).
      const trayCandidates = [
        path.join(__dirname, '..', 'public', 'nexus-tray.png'),
        path.join(__dirname, '..', 'dist', 'nexus-tray.png'),
      ]
      let trayImage = null
      for (const candidate of trayCandidates) {
        const img = nativeImage.createFromPath(candidate)
        if (!img.isEmpty()) { trayImage = img; break }
      }
      tray = new Tray(trayImage ?? nativeImage.createFromPath(getPetIconPath()))
    }
  } catch (err) {
    console.warn('[tray] failed to create system tray:', err?.message)
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
    return `${host}:${port} 当前不可达，请检查本地网络栈或绑定地址。`
  }
  if (code === 'ETIMEDOUT') {
    return `${host}:${port} 连接超时（${timeoutMs}ms）。`
  }

  return `${host}:${port} 连接失败：${error instanceof Error ? error.message : '未知错误'}`
}

function normalizeLocalServiceProbeTarget(target = {}) {
  const host = typeof target.host === 'string' && target.host.trim()
    ? target.host.trim()
    : '127.0.0.1'
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
      message: '端口无效，无法执行本地探测。',
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
