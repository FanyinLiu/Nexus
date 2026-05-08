import { app, BrowserWindow, dialog, session } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import net from 'node:net'

import { initPetModelService, isPathInsideRoot, getImportedPetModelsRoot, IMPORTED_PET_MODELS_ROUTE } from './services/petModelService.js'
import { initRendererServer, ensureRendererServer, getRendererServerUrl, closeRendererServer } from './rendererServer.js'
import { mainWindow, panelWindow, panelSection, createMainWindow, createApplicationMenu, createTray, applyPetWindowState, hasSystemTray } from './windowManager.js'
import { registerIpc } from './ipcRegistry.js'
import { autoStartPlugins } from './services/pluginHost.js'
import { initAutoUpdater } from './services/updaterService.js'
import { closeAuditLog } from './services/auditLog.js'
import { runMacPermissionChecks } from './services/macPermissions.js'
import { runWindowsPermissionChecks } from './services/windowsPermissions.js'
import { initModelManager } from './services/modelManager.js'
import { ensurePythonRuntimeStatus, getPythonRuntimeStatus } from './services/pythonRuntime.js'

// ── Console safety: suppress broken-pipe errors on stdout/stderr ──

function isBrokenPipeConsoleError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /(?:EPIPE|broken pipe)/iu.test(message)
}

function createSafeConsoleMethod(methodName) {
  const originalMethod = console[methodName]?.bind(console)
  if (typeof originalMethod !== 'function') {
    return () => {}
  }

  return (...args) => {
    try {
      originalMethod(...args)
    } catch (error) {
      if (!isBrokenPipeConsoleError(error)) {
        throw error
      }
    }
  }
}

console.log = createSafeConsoleMethod('log')
console.info = createSafeConsoleMethod('info')
console.warn = createSafeConsoleMethod('warn')
console.error = createSafeConsoleMethod('error')

// Suppress async EPIPE errors on stdout/stderr streams (e.g. when launcher pipe closes)
for (const stream of [process.stdout, process.stderr]) {
  stream?.on('error', (err) => {
    if (isBrokenPipeConsoleError(err)) return
    try { process.stderr.write(`[main] stream error: ${err?.message}\n`) } catch {}
  })
}

process.on('uncaughtException', (err) => {
  if (isBrokenPipeConsoleError(err)) return
  dialog.showErrorBox('Uncaught Exception', err?.stack || String(err))
  app.exit(1)
})

// ── Paths & feature flags ──

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged
const useDevServer = process.env.DESKTOP_PET_USE_DEV_SERVER === '1'
const devServerUrl = 'http://127.0.0.1:47821'
const hasSingleInstanceLock = app.requestSingleInstanceLock()
const WINDOWS_APP_USER_MODEL_ID = 'ai.factory.desktoppet'
const LOGIN_LAUNCH_ARG = '--launch-at-login'
const isLinuxWaylandSession = process.platform === 'linux'
  && String(process.env.XDG_SESSION_TYPE ?? '').trim().toLowerCase() === 'wayland'
const linuxHasX11Display = String(process.env.DISPLAY ?? '').trim().length > 0
const linuxWaylandOptIn = process.env.NEXUS_LINUX_USE_WAYLAND === '1'
const LINUX_WM_CLASS = String(process.env.NEXUS_LINUX_WM_CLASS ?? 'Nexus').trim() || 'Nexus'

// Tray-style lifecycle: allow window `close` handlers to hide windows during
// normal operation, but still let windows actually close when the app is
// explicitly quitting.
app.on('before-quit', () => {
  app.isQuitting = true
})

// Keep Windows taskbar identity stable so window/taskbar/tray icon grouping
// uses the app's own model id instead of Electron defaults.
if (process.platform === 'win32') {
  try {
    app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)
  } catch (err) {
    console.warn('[windows] Failed to set AppUserModelId:', err?.message)
  }
}

// ── Chromium flags ──

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

if (process.platform === 'linux' && LINUX_WM_CLASS) {
  // Keep runtime WM_CLASS aligned with desktop entry so dock/taskbar grouping
  // uses a single icon entry instead of spawning duplicates.
  app.commandLine.appendSwitch('class', LINUX_WM_CLASS)
}

if (isLinuxWaylandSession && linuxHasX11Display && !linuxWaylandOptIn) {
  // The companion relies on APIs that still vary across Wayland compositors
  // (skipTaskbar, programmatic move/focus). Prefer XWayland by default so
  // Linux behavior stays closer to macOS/Windows unless explicitly overridden.
  app.commandLine.appendSwitch('ozone-platform', 'x11')
  console.info('[linux] Wayland session detected; forcing XWayland for window-behavior parity. Set NEXUS_LINUX_USE_WAYLAND=1 to opt in to native Wayland.')
}

// On macOS, transparent BrowserWindows + WebGL trigger a SharedImageManager
// mailbox race in the Skia renderer path. Disabling UseSkiaRenderer falls back
// to the legacy compositor which handles transparent windows + WebGL correctly.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'UseSkiaRenderer')
}

if (!hasSingleInstanceLock) {
  app.quit()
}

// ── Media permission handlers ──

function isTrustedRendererOrigin(origin) {
  const normalized = String(origin ?? '').trim()
  if (!normalized) return false

  try {
    const parsed = new URL(normalized)
    return ['127.0.0.1', 'localhost'].includes(parsed.hostname)
  } catch {
    return normalized.startsWith('file://')
  }
}

// ── AI service auto-start (OmniVoice TTS + GLM-ASR STT) ──

const OMNIVOICE_PORT = 8000
const GLM_ASR_PORT = 8001

const childServices = []

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(1000)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.connect(port, host)
  })
}

// Allow users to override the Python binary used for OmniVoice / GLM-ASR.
// Fixes the common case on macOS where `python3` is Apple's stock 3.9 which
// can't install transformers>=5.0.0. Users can set NEXUS_PYTHON=/opt/homebrew/bin/python3.11
function resolvePythonCommand() {
  const status = getPythonRuntimeStatus()
  if (status?.binary) return status.binary
  if (process.env.NEXUS_PYTHON) return process.env.NEXUS_PYTHON
  return process.platform === 'win32' ? 'python' : 'python3'
}

async function ensureServiceRunning({ tag, port, command, args, cwd, timeoutSec = 60 }) {
  if (await isPortOpen('127.0.0.1', port)) {
    console.info(`[${tag}] Already running on port ${port}`)
    return
  }

  console.info(`[${tag}] Starting on port ${port} via ${command}...`)
  // Pipe stderr so we can surface startup failures (missing deps, Python version
  // mismatch, etc.) to the main-process console instead of silently giving up.
  const child = spawn(command, args, {
    cwd,
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
    windowsHide: true,
  })
  child.unref()
  childServices.push(child)

  // Capture stderr into a ring buffer and only surface it if the process
  // fails — live-streaming + tail-on-exit used to double-print 200+ line
  // Python tracebacks when a sidecar exited early during boot. Now the
  // user sees a single summary on exit, and nothing noisy while things
  // are healthy.
  let stderrTail = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk).slice(-4000)
  })
  child.on('exit', (code, signal) => {
    if (code !== 0) {
      console.warn(`[${tag}] Process exited early (code=${code}, signal=${signal}).`)
      if (stderrTail.trim()) {
        console.warn(`[${tag}] stderr tail:\n${stderrTail.trim()}`)
      }
    }
  })
  child.on('error', (err) => {
    console.warn(`[${tag}] Spawn error: ${err?.message}`)
  })

  for (let i = 0; i < timeoutSec; i++) {
    if (await isPortOpen('127.0.0.1', port)) {
      console.info(`[${tag}] Ready`)
      return
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  console.warn(`[${tag}] Did not start within ${timeoutSec}s`)
}

// Python sidecar scripts live in scripts/ and are listed under asarUnpack in
// package.json. Packaged builds see them on disk at
// `<resourcesPath>/app.asar.unpacked/scripts/*.py`. Dev runs read the repo
// root directly. We must return a real on-disk path because child_process
// spawn bypasses Electron's asar fs shim — a virtual asar path would ENOTDIR.
function resolveAppRoot() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
}

function pythonScriptPath(relativePath) {
  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', relativePath)
    if (fs.existsSync(unpacked)) return unpacked
  }
  const devCandidate = path.join(resolveAppRoot(), relativePath)
  return fs.existsSync(devCandidate) ? devCandidate : null
}

function ensureOmniVoiceRunning() {
  const scriptPath = pythonScriptPath('scripts/omnivoice_server.py')
  if (!scriptPath) {
    console.info('[OmniVoice] Script not bundled in this build — skipping auto-start.')
    return Promise.resolve()
  }
  return ensureServiceRunning({
    tag: 'OmniVoice',
    port: OMNIVOICE_PORT,
    command: resolvePythonCommand(),
    args: [scriptPath, '--port', String(OMNIVOICE_PORT)],
    cwd: path.dirname(scriptPath),
    timeoutSec: 90,
  })
}

function ensureGlmAsrRunning() {
  const scriptPath = pythonScriptPath('scripts/glm_asr_server.py')
  if (!scriptPath) {
    console.info('[GLM-ASR] Script not bundled in this build — skipping auto-start.')
    return Promise.resolve()
  }
  return ensureServiceRunning({
    tag: 'GLM-ASR',
    port: GLM_ASR_PORT,
    command: resolvePythonCommand(),
    args: [scriptPath, '--port', String(GLM_ASR_PORT)],
    cwd: path.dirname(scriptPath),
    timeoutSec: 120,
  })
}

function registerMediaPermissionHandlers() {
  const defaultSession = session.defaultSession
  if (!defaultSession) return

  defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (permission === 'media' || permission === 'audioCapture') {
      return isTrustedRendererOrigin(requestingOrigin)
    }

    return false
  })

  defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'media' || permission === 'audioCapture') {
      callback(isTrustedRendererOrigin(
        details?.requestingUrl
        ?? details?.embeddingOrigin
        ?? webContents?.getURL?.(),
      ))
      return
    }

    callback(false)
  })
}

function detectLaunchAtLogin() {
  if (process.argv.includes(LOGIN_LAUNCH_ARG)) {
    return true
  }
  if (process.platform !== 'darwin') {
    return false
  }
  try {
    const loginItem = app.getLoginItemSettings()
    return loginItem?.wasOpenedAtLogin === true || loginItem?.wasOpenedAsHidden === true
  } catch {
    return false
  }
}

// ── Initialize service modules ──

initPetModelService({
  isDev,
  useDevServer,
  getRendererServerUrl,
  getPanelWindow: () => panelWindow,
  getMainWindow: () => mainWindow,
})

initRendererServer({
  isDev,
  useDevServer,
  devServerUrl,
  getPanelSection: () => panelSection,
  getImportedPetModelsRoot,
  isPathInsideRoot,
  importedPetModelsRoute: IMPORTED_PET_MODELS_ROUTE,
})

// ── App lifecycle ──

app.whenReady()
  .then(async () => {
    await ensureRendererServer()
    registerMediaPermissionHandlers()
    registerIpc()
    initModelManager()

    // macOS: hide dock icon for desktop pet (floating widget mode)
    if (process.platform === 'darwin' && app.dock) {
      try { app.dock.hide() } catch (err) {
        console.warn('[macOS] Failed to hide dock icon:', err?.message)
      }
    }

    createApplicationMenu()
    createTray()
    const launchAtLogin = detectLaunchAtLogin()
    const startHidden = launchAtLogin && hasSystemTray()
    if (startHidden) {
      console.info('[startup] login launch detected; starting hidden in tray mode.')
    }
    createMainWindow({ showOnReady: !startHidden })
    applyPetWindowState()
    initAutoUpdater({
      getWindows: () => [mainWindow, panelWindow].filter(Boolean),
    })
    // macOS 隐私权限自检:未授权时主动弹 OS 对话框,已拒绝时弹 Electron 对话框
    // 引导用户打开系统设置。非阻塞,失败不影响其他启动流程。
    runMacPermissionChecks().catch((err) => console.warn('[mac-perm] auto-check error:', err?.message))
    runWindowsPermissionChecks().catch((err) => console.warn('[windows-perm] auto-check error:', err?.message))
    autoStartPlugins().catch((err) => console.warn('[pluginHost] auto-start error:', err.message))

    // Probe Python + dependencies before attempting to spawn the optional
    // AI services. If Python is missing or torch/transformers aren't
    // installed, skip the spawn quietly — users shouldn't see ImportError
    // tracebacks just because they haven't set up the optional Python stack.
    ensurePythonRuntimeStatus()
      .then((status) => {
        if (status.omniVoice.ready) {
          ensureOmniVoiceRunning().catch((err) => console.warn('[OmniVoice] auto-start error:', err.message))
        } else {
          console.info('[OmniVoice] Skipping auto-start — Python prerequisites not met.')
        }
        if (status.glmAsr.ready) {
          ensureGlmAsrRunning().catch((err) => console.warn('[GLM-ASR] auto-start error:', err.message))
        } else {
          console.info('[GLM-ASR] Skipping auto-start — Python prerequisites not met.')
        }
      })
      .catch((err) => console.warn('[Python] Runtime probe failed:', err?.message))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      }
    })
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Failed to initialize the application:', error)

    try {
      dialog.showErrorBox('Nexus 启动失败', message)
    } catch {}

    app.quit()
  })

app.on('second-instance', () => {
  if (!mainWindow) return

  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.focus()
  mainWindow.moveTop()
  panelWindow?.moveTop()
})

app.on('window-all-closed', () => {
  // Keep the process alive in tray mode so behavior matches companion apps:
  // explicit quit from tray/menu. On Linux, keep alive only when a tray icon
  // is actually available to avoid a headless process with no way back.
  if (process.platform === 'darwin' || hasSystemTray()) {
    return
  }
  app.quit()
})

app.on('will-quit', () => {
  closeRendererServer()
  for (const child of childServices) {
    if (child && !child.killed) {
      try { if (child.pid) process.kill(child.pid) } catch {}
    }
  }
  closeAuditLog()
})
