import { app, BrowserWindow, dialog, session } from 'electron'

import { initPetModelService } from './services/petModelService.js'
import {
  getImportedPetModelsRoot,
  isPathInsideRoot,
} from './services/petModelPaths.js'
import { IMPORTED_PET_MODELS_ROUTE } from './services/petModelUrlBuilders.js'
import { initRendererServer, ensureRendererServer, getRendererServerUrl, closeRendererServer } from './rendererServer.js'
import {
  mainWindow,
  panelWindow,
  panelSection,
  createMainWindow,
  createApplicationMenu,
  createTray,
  applyPetWindowState,
  flushRuntimeLogWriteBuffer,
  hasSystemTray,
} from './windowManager.js'
import { registerIpc } from './ipcRegistry.js'
import { autoStartPlugins } from './services/pluginHost.js'
import { initAutoUpdater } from './services/updaterService.js'
import { closeAuditLog } from './services/auditLog.js'
import { runMacPermissionChecks } from './services/macPermissions.js'
import { runWindowsPermissionChecks } from './services/windowsPermissions.js'
import { initModelManager } from './services/modelManager.js'
import { createDefaultVoiceSidecarHost } from './services/voiceSidecarHost.js'
import { initializeLocalDataStore } from './services/localDataStore.js'
import { getRedactedErrorMessage } from './services/errorRedaction.js'
import { createRendererReloadGuard, shouldReloadAfterRendererGone } from './crashRecovery.js'
import { crashDialogCopy, rendererStuckDialogCopy } from './userFacingDialogs.js'
import { getExternalOpenConfirmation } from './services/externalOpenConfirmation.js'

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
    try { process.stderr.write(`[main] stream error: ${getRedactedErrorMessage(err)}\n`) } catch {}
  })
}

function readProcessLocale() {
  try {
    const saved = getExternalOpenConfirmation().uiLanguage
    if (saved) return saved
  } catch {
    // The preference file is optional. The OS locale is the fallback.
  }
  try {
    return app.getLocale()
  } catch {
    return 'en-US'
  }
}

function showFriendlyDialog(copy) {
  try {
    dialog.showErrorBox(copy.title, copy.message)
  } catch (dialogError) {
    console.error('[main] crash dialog failed:', getRedactedErrorMessage(dialogError))
  }
}

const rendererReloadGuard = createRendererReloadGuard()

process.on('uncaughtException', (err) => {
  if (isBrokenPipeConsoleError(err)) return
  console.error('[main] uncaught exception:', getRedactedErrorMessage(err))
  showFriendlyDialog(crashDialogCopy(readProcessLocale()))
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection:', getRedactedErrorMessage(reason))
})

app.on('render-process-gone', (_event, webContents, details) => {
  const reason = details && typeof details.reason === 'string' ? details.reason : 'unknown'
  console.error('[main] render-process-gone:', getRedactedErrorMessage(reason))
  if (!shouldReloadAfterRendererGone(details)) return
  if (!webContents || webContents.isDestroyed()) return
  const guardId = typeof webContents.id === 'number' ? webContents.id : 'renderer'
  if (!rendererReloadGuard.allow(guardId)) {
    console.error('[main] renderer reload skipped after repeated failures')
    showFriendlyDialog(rendererStuckDialogCopy(readProcessLocale()))
    return
  }
  try {
    webContents.reload()
  } catch (error) {
    console.error('[main] renderer reload failed:', getRedactedErrorMessage(error))
  }
})

// ── Paths & feature flags ──

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
  void flushRuntimeLogWriteBuffer()
})

// Keep Windows taskbar identity stable so window/taskbar/tray icon grouping
// uses the app's own model id instead of Electron defaults.
if (process.platform === 'win32') {
  try {
    app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)
  } catch (err) {
    console.warn('[windows] Failed to set AppUserModelId:', getRedactedErrorMessage(err))
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

function isTrustedRendererOrigin(origin, ownerUrl = getRendererServerUrl()) {
  const normalized = String(origin ?? '').trim()
  if (!normalized) return false

  try {
    const parsed = new URL(normalized)
    const owner = new URL(String(ownerUrl ?? ''))
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return parsed.origin === owner.origin
  } catch {
    return false
  }
}

// ── On-demand local voice sidecars (OmniVoice TTS + GLM-ASR STT) ──

// The Python servers are expensive and optional. They are started/stopped by
// the renderer's voice-runtime sync (selected engine + matching voice switch),
// never unconditionally at launch. See voiceSidecarService.js.
const voiceSidecarSupervisor = createDefaultVoiceSidecarHost()

function registerMediaPermissionHandlers() {
  const defaultSession = session.defaultSession
  if (!defaultSession) return

  defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission === 'media' || permission === 'audioCapture') {
      return isTrustedRendererOrigin(requestingOrigin, webContents?.getURL?.())
    }

    return false
  })

  defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'media' || permission === 'audioCapture') {
      callback(isTrustedRendererOrigin(
        details?.requestingUrl
        ?? details?.embeddingOrigin
        ?? webContents?.getURL?.(),
        webContents?.getURL?.(),
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
    const localDataStatus = await initializeLocalDataStore()
    if (!localDataStatus.healthy) {
      console.warn('[local-data] main-process storage adapter unavailable:', localDataStatus.errorMessage)
    }
    registerMediaPermissionHandlers()
    registerIpc({ voiceSidecarSupervisor })
    initModelManager()

    // macOS: hide dock icon for desktop pet (floating widget mode)
    if (process.platform === 'darwin' && app.dock) {
      try { app.dock.hide() } catch (err) {
        console.warn('[macOS] Failed to hide dock icon:', getRedactedErrorMessage(err))
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
    runMacPermissionChecks().catch((err) => console.warn('[mac-perm] auto-check error:', getRedactedErrorMessage(err)))
    runWindowsPermissionChecks().catch((err) => console.warn('[windows-perm] auto-check error:', getRedactedErrorMessage(err)))
    autoStartPlugins().catch((err) => console.warn('[pluginHost] auto-start error:', getRedactedErrorMessage(err)))

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
      dialog.showErrorBox('Nexus 没能启动', message)
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
  voiceSidecarSupervisor.stopAllNow()
  closeAuditLog()
})
