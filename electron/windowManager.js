import { app, BrowserWindow, Menu, screen, shell, Tray } from 'electron'
import nodeNet from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPreloadPath, getRendererEntry } from './rendererServer.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged
const isSmokeTest = process.env.SMOKE_TEST === '1'

const RUNTIME_CLIENT_TTL_MS = 25_000
const PET_WINDOW_SCREEN_MARGIN_PX = 24
const PANEL_WINDOW_GAP_PX = 28
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

export function syncRuntimeState() {
  const snapshot = buildRuntimeStateSnapshot()
  for (const win of [mainWindow, panelWindow]) {
    if (!win || win.isDestroyed()) continue
    win.webContents.send('runtime-state:changed', snapshot)
  }
}

export function syncPetWindowState() {
  for (const win of [mainWindow, panelWindow]) {
    if (!win || win.isDestroyed()) continue
    win.webContents.send('pet-window:state-changed', petWindowState)
  }
}

export function updateRuntimeState(partialState) {
  runtimeState = {
    ...runtimeState,
    ...partialState,
    updatedAt: new Date().toISOString(),
  }
  syncRuntimeState()
}

export function updateHeartbeat(view) {
  runtimeClientHeartbeat = {
    ...runtimeClientHeartbeat,
    [view]: Date.now(),
  }
  syncRuntimeState()
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
  petWindowState = {
    ...petWindowState,
    ...partialState,
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

function clampWindowPosition(width, height, preferredX, preferredY, workArea) {
  const maxX = workArea.x + Math.max(workArea.width - width, 0)
  const maxY = workArea.y + Math.max(workArea.height - height, 0)

  return {
    x: Math.min(Math.max(Math.round(preferredX), workArea.x), maxX),
    y: Math.min(Math.max(Math.round(preferredY), workArea.y), maxY),
  }
}

function getPanelWindowPosition(width, height, ownerBounds, workArea) {
  if (!ownerBounds) {
    return clampWindowPosition(
      width,
      height,
      workArea.x + workArea.width - width - 72,
      workArea.y + 72,
      workArea,
    )
  }

  const spaceLeft = ownerBounds.x - workArea.x
  const spaceRight = workArea.x + workArea.width - (ownerBounds.x + ownerBounds.width)
  const preferRight = spaceRight >= spaceLeft
  const rightX = ownerBounds.x + ownerBounds.width + PANEL_WINDOW_GAP_PX
  const leftX = ownerBounds.x - width - PANEL_WINDOW_GAP_PX
  const preferredX = preferRight ? rightX : leftX
  const preferredY = ownerBounds.y + ownerBounds.height - height

  return clampWindowPosition(width, height, preferredX, preferredY, workArea)
}

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
  panelWindowState = {
    ...panelWindowState,
    ...partialState,
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
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    icon: getPetIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })

  win.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver')

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('closed', () => {
    mainWindow = null
  })

  win.webContents.on('did-finish-load', () => {
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
      webSecurity: true,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('closed', () => {
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

export function createTray() {
  const iconPath = getPetIconPath()

  try {
    tray = new Tray(iconPath)
  } catch {
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
