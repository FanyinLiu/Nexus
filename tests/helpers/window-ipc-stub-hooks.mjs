// node:module resolve/load hooks that let node:test import the real
// electron/ipc/windowIpc.js without booting Electron.
//
// 'electron' resolves to a virtual stub whose ipcMain records every handler,
// so a test can invoke the real 'window:request-model-setup' and
// 'window:consume-model-setup-request' handlers. The main-process singletons
// windowIpc.js reaches for (windows, services, audit log) are replaced with
// inert stubs; the model setup request gate and the IPC payload schemas stay
// real, because they own the behavior under test.

const STATE_KEY = '__nexusTestMainProcess'

// Shared prelude: every stub records into one main-process state object so
// the test can observe window calls and the panel event channel.
const STATE_PRELUDE = `
function testState() {
  if (!globalThis.${STATE_KEY}) {
    globalThis.${STATE_KEY} = {
      handlers: new Map(),
      panelRequests: [],
      panelShown: [],
      panelEventSink: null,
    }
  }
  return globalThis.${STATE_KEY}
}
`

const ELECTRON_STUB = `
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
${STATE_PRELUDE}
export const app = {
  getPath() {
    const state = testState()
    if (!state.userData) state.userData = mkdtempSync(join(tmpdir(), 'nexus-window-ipc-'))
    return state.userData
  },
}
export const ipcMain = {
  handle(channel, listener) {
    testState().handlers.set(channel, listener)
  },
}
export const BrowserWindow = {
  getAllWindows: () => [],
  fromWebContents: () => null,
}
export const dialog = {
  showMessageBox: async () => ({ response: 1 }),
}
export const powerMonitor = {
  on() {},
  getSystemIdleTime: () => 0,
}
`

const WINDOW_MANAGER_STUB = `${STATE_PRELUDE}
export const mainWindow = null
export const panelWindow = {
  isDestroyed: () => false,
  webContents: {
    send: (channel, payload) => {
      testState().panelRequests.push(channel)
      // A test may hand the event to the panel renderer, the way Electron
      // delivers it to the webContents.
      testState().panelEventSink?.(channel, payload)
    },
  },
}
export const panelWindowState = {}
export function getPetWindowStateForEvent() {
  return { isPinned: false, clickThrough: false, petHotspotActive: false }
}
export function buildRuntimeStateSnapshot() { return {} }
export function updateHeartbeat() {}
export function updateRuntimeState() {}
export function updatePetWindowStateForEvent() {}
export function setPetFreeModeForEvent() {}
export function updatePanelWindowState() {}
export function showPanelWindow(section, options) {
  testState().panelShown.push({ section, options })
}
export function closeSettingsWindow() {}
export function closePanelWindow() {}
export function getPanelSectionSnapshot() { return { section: 'chat' } }
export function showPetContextMenu() {}
export function getLaunchOnStartupState() { return false }
export function setLaunchOnStartupState() {}
export function dragWindowBy() {}
export function getViewKind() { return 'pet' }
export function probeLocalServiceTarget() { return null }
export function getPlatformProfile() { return { startup: { supported: false } } }
`

const PET_MODEL_SERVICE_STUB = `
export async function listAvailablePetModels() { return [] }
export async function importPetModelFromDialog() { return null }
export async function saveTextFileFromDialog() { return { canceled: true } }
export async function openTextFileFromDialog() { return { canceled: true } }
`

const TOOL_REGISTRY_STUB = `
export async function invokeRegisteredTool() { return null }
`

const DESKTOP_CONTEXT_SERVICE_STUB = `
export async function captureActiveWindowContext() { return null }
export async function captureScreenshotContext() { return null }
export function getSavedDesktopContextFlags() {
  return { activeWindow: false, clipboard: false, screenshot: false }
}
export function normalizeDesktopContextPolicy(policy) { return policy }
export const clipboard = { readText: () => '' }
`

const MEDIA_SESSION_RUNTIME_STUB = `
export async function getSystemMediaSessionSnapshot() { return null }
export async function controlSystemMediaSession() { return null }
`

const INTEGRATION_RUNTIME_STUB = `
export async function inspectIntegrationRuntime() { return null }
`

const AUDIT_LOG_STUB = `
export function audit() {}
`

const SYSTEM_VIBRANCY_STUB = `
export function applySystemVibrancy() { return false }
`

const VALIDATE_STUB = `
export function requireTrustedSender() {}
export function installIpcChannelBinding() {}
`

// Suffix matched against the resolved module URL, so only the exact
// main-process singletons are replaced.
const MODULE_STUBS = new Map([
  ['/electron/windowManager.js', WINDOW_MANAGER_STUB],
  ['/electron/services/petModelService.js', PET_MODEL_SERVICE_STUB],
  ['/electron/tools/toolRegistry.js', TOOL_REGISTRY_STUB],
  ['/electron/services/desktopContextService.js', DESKTOP_CONTEXT_SERVICE_STUB],
  ['/electron/mediaSessionRuntime.js', MEDIA_SESSION_RUNTIME_STUB],
  ['/electron/integrationRuntime.js', INTEGRATION_RUNTIME_STUB],
  ['/electron/services/auditLog.js', AUDIT_LOG_STUB],
  ['/electron/systemVibrancy.js', SYSTEM_VIBRANCY_STUB],
  ['/electron/ipc/validate.js', VALIDATE_STUB],
])

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: 'electron-stub:electron', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === 'electron-stub:electron') {
    return { format: 'module', shortCircuit: true, source: ELECTRON_STUB }
  }
  for (const [suffix, source] of MODULE_STUBS) {
    if (url.endsWith(suffix)) {
      return { format: 'module', shortCircuit: true, source }
    }
  }
  return nextLoad(url, context)
}
