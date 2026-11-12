// node:module resolve/load hooks that let node:test import the real
// electron/ipc/windowIpc.js without booting Electron.
//
// The 'desktop-context:get' handler is the privacy boundary this harness
// exists for: the real handler, the real payload schemas, the real saved-flag
// policy store, and the real sanitizer stay in place, while the three capture
// sources (active window, screenshot, clipboard) are counters that never touch
// a real window, screen, or clipboard. The counter bag lives on
// globalThis.__nexusDesktopContextIpc so the test can reset and read it.
//
// The desktop-context service module is replaced because the real one shells
// out to osascript/powershell/xdotool on capture. The replacement re-exports
// the real policy module (same file URL), so saved flags are still read from
// the real store the test points at a temp directory.
//
// Registered via `register(new URL('./helpers/desktop-context-ipc-hooks.mjs',
// import.meta.url))` before the dynamic import of the module under test.

const STATE_KEY = '__nexusTestMainProcess'
const CAPTURE_KEY = '__nexusDesktopContextIpc'

const POLICY_URL = new URL('../../electron/services/desktopContextPolicy.js', import.meta.url).href

const STATE_PRELUDE = `
function testState() {
  if (!globalThis.${STATE_KEY}) {
    globalThis.${STATE_KEY} = {
      handlers: new Map(),
      userData: '',
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
    if (!state.userData) state.userData = mkdtempSync(join(tmpdir(), 'nexus-desktop-context-ipc-'))
    return state.userData
  },
  isPackaged: false,
}
export const ipcMain = {
  handle(channel, listener) {
    testState().handlers.set(channel, listener)
  },
}
export const BrowserWindow = {
  getAllWindows: () => [],
  fromWebContents: () => null,
  getFocusedWindow: () => null,
}
export const dialog = {
  showMessageBox: async () => ({ response: 1 }),
}
export const shell = {
  openExternal: async () => undefined,
}
export const systemPreferences = {
  getMediaAccessStatus: () => 'not-determined',
  askForMediaAccess: async () => false,
}
export const powerMonitor = {
  on() {},
  getSystemIdleTime: () => 0,
}
`

const WINDOW_MANAGER_STUB = `
export const mainWindow = null
export const panelWindow = null
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
export function showPanelWindow() {}
export function closeSettingsWindow() {}
export function closePanelWindow() {}
export function requestFirstUsePanelRetire() { return { requested: false } }
export function confirmFirstUsePanelRetire() { return { retired: false } }
export function getPanelSectionSnapshot() { return { section: 'chat' } }
export function showPetContextMenu() { return Promise.resolve(null) }
export function getLaunchOnStartupState() { return false }
export function setLaunchOnStartupState() {}
export function dragWindowBy() {}
export function getViewKind() { return 'pet' }
export function probeLocalServiceTarget() { return null }
export function getPlatformProfile() { return { startup: { supported: false } } }
`

const DESKTOP_CONTEXT_SERVICE_STUB = `
const state = globalThis.${CAPTURE_KEY} ??= {
  activeWindowCaptures: 0,
  screenshotCaptures: 0,
  clipboardReads: 0,
  activeWindowSnapshot: null,
  screenshotSnapshot: null,
  clipboardText: '',
}
export { getSavedDesktopContextFlags, normalizeDesktopContextPolicy } from ${JSON.stringify(POLICY_URL)}
export const clipboard = {
  readText() {
    state.clipboardReads += 1
    return state.clipboardText
  },
}
export async function captureActiveWindowContext() {
  state.activeWindowCaptures += 1
  return state.activeWindowSnapshot
}
export async function captureScreenshotContext() {
  state.screenshotCaptures += 1
  return state.screenshotSnapshot
}
`

const EMPTY_SERVICE_STUB = `
export async function listAvailablePetModels() { return [] }
export async function importPetModelFromDialog() { return null }
export async function saveTextFileFromDialog() { return { canceled: true } }
export async function openTextFileFromDialog() { return { canceled: true } }
export async function invokeRegisteredTool() { return null }
export async function getSystemMediaSessionSnapshot() { return null }
export async function controlSystemMediaSession() { return null }
export async function inspectIntegrationRuntime() { return null }
export function audit() {}
export function applySystemVibrancy() { return false }
`

const VALIDATE_STUB = `
export function requireTrustedSender() {}
export function installIpcChannelBinding() {}
`

const MODULE_STUBS = new Map([
  ['/electron/windowManager.js', WINDOW_MANAGER_STUB],
  ['/electron/services/petModelService.js', EMPTY_SERVICE_STUB],
  ['/electron/tools/toolRegistry.js', EMPTY_SERVICE_STUB],
  ['/electron/services/desktopContextService.js', DESKTOP_CONTEXT_SERVICE_STUB],
  ['/electron/mediaSessionRuntime.js', EMPTY_SERVICE_STUB],
  ['/electron/integrationRuntime.js', EMPTY_SERVICE_STUB],
  ['/electron/services/auditLog.js', EMPTY_SERVICE_STUB],
  ['/electron/systemVibrancy.js', EMPTY_SERVICE_STUB],
  ['/electron/ipc/validate.js', VALIDATE_STUB],
])

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: 'desktop-context-ipc-stub:electron', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === 'desktop-context-ipc-stub:electron') {
    return { format: 'module', shortCircuit: true, source: ELECTRON_STUB }
  }
  for (const [suffix, source] of MODULE_STUBS) {
    if (url.endsWith(suffix)) {
      return { format: 'module', shortCircuit: true, source }
    }
  }
  return nextLoad(url, context)
}
