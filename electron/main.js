import { app, BrowserWindow, dialog, session } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import net from 'node:net'

import { initPetModelService, isPathInsideRoot, getImportedPetModelsRoot, IMPORTED_PET_MODELS_ROUTE } from './services/petModelService.js'
import { initRendererServer, ensureRendererServer, getRendererServerUrl, closeRendererServer } from './rendererServer.js'
import { mainWindow, panelWindow, panelSection, createMainWindow, createTray, applyPetWindowState } from './windowManager.js'
import { registerIpc } from './ipcRegistry.js'
import { autoStartPlugins } from './services/pluginHost.js'

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

// ── Chromium flags ──

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

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

async function ensureServiceRunning({ tag, port, command, args, cwd, timeoutSec = 60 }) {
  if (await isPortOpen('127.0.0.1', port)) {
    console.info(`[${tag}] Already running on port ${port}`)
    return
  }

  console.info(`[${tag}] Starting on port ${port}...`)
  const child = spawn(command, args, {
    cwd,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  })
  child.unref()
  childServices.push(child)

  for (let i = 0; i < timeoutSec; i++) {
    if (await isPortOpen('127.0.0.1', port)) {
      console.info(`[${tag}] Ready`)
      return
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  console.warn(`[${tag}] Did not start within ${timeoutSec}s`)
}

function ensureOmniVoiceRunning() {
  const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'omnivoice_server.py')
  return ensureServiceRunning({
    tag: 'OmniVoice',
    port: OMNIVOICE_PORT,
    command: 'python',
    args: [scriptPath, '--port', String(OMNIVOICE_PORT)],
    cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
    timeoutSec: 90,
  })
}

function ensureGlmAsrRunning() {
  const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'glm_asr_server.py')
  return ensureServiceRunning({
    tag: 'GLM-ASR',
    port: GLM_ASR_PORT,
    command: 'python',
    args: [scriptPath, '--port', String(GLM_ASR_PORT)],
    cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
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

    // macOS: hide dock icon for desktop pet (floating widget mode)
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide()
    }

    createMainWindow()
    applyPetWindowState()
    createTray()
    autoStartPlugins().catch((err) => console.warn('[pluginHost] auto-start error:', err.message))
    ensureOmniVoiceRunning().catch((err) => console.warn('[OmniVoice] auto-start error:', err.message))
    ensureGlmAsrRunning().catch((err) => console.warn('[GLM-ASR] auto-start error:', err.message))

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
  closeRendererServer()
  for (const child of childServices) {
    if (child && !child.killed) {
      try { process.kill(child.pid) } catch {}
    }
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
