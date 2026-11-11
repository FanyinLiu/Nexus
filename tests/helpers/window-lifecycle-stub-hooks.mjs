// Electron and host-module stubs for windowManager/windowCreation lifecycle
// tests. The production window code runs for real; only the Electron windows
// and unrelated host services are replaced.
//
// The fake BrowserWindow records show/focus/closed/destroy calls and lets a
// test emit webContents events, which is enough to prove that a pending
// first-use retirement is cancelled by visibility and that the hidden takeover
// panel resolves only after did-finish-load.

export const STATE_KEY = '__nexusTestWindowLifecycle'

const STATE_PRELUDE = `
function testState() {
  if (!globalThis.${STATE_KEY}) {
    globalThis.${STATE_KEY} = {
      windows: [],
      sends: [],
      bySender: new Map(),
      monitorStarts: 0,
      monitorStops: 0,
      powerMonitorListeners: {},
      panelWindowSetter: null,
      snapshot: { petOnline: true, panelOnline: true, petLastSeenAt: '', voiceState: 'idle', continuousVoiceActive: false, assistantActivity: 'idle', searchInProgress: false, ttsInProgress: false },
      nextWindowId: 1,
    }
  }
  return globalThis.${STATE_KEY}
}
`

const ELECTRON_STUB = `
import { EventEmitter } from 'node:events'
${STATE_PRELUDE}
export const app = {
  isPackaged: false,
  isQuitting: false,
  dock: { show() {}, hide() {} },
  getPath: () => process.cwd(),
  on() {},
  once() {},
  quit() {},
}
export const screen = {
  getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
}
export const powerMonitor = {
  on(event, listener) {
    const listeners = testState().powerMonitorListeners
    if (!listeners[event]) listeners[event] = []
    listeners[event].push(listener)
  },
  removeListener() {},
}
export const Menu = {
  buildFromTemplate: () => ({ popup: (_options, callback) => callback?.() }),
  setApplicationMenu() {},
}
export const nativeImage = {
  createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }),
  createEmpty: () => ({ isEmpty: () => true }),
}
export class Tray extends EventEmitter {
  destroy() {}
  isDestroyed() { return false }
  setToolTip() {}
  setContextMenu() {}
  on() { return this }
}
export const dialog = { showMessageBox: async () => ({ response: 1 }), showErrorBox() {} }
export const shell = { openExternal: async () => undefined }
export class BrowserWindow extends EventEmitter {
  constructor(options = {}) {
    super()
    this.options = options
    this.id = testState().nextWindowId++
    this.destroyed = false
    this.visible = false
    this.focused = false
    this.minimized = false
    this.bounds = { x: options.x ?? 0, y: options.y ?? 0, width: options.width ?? 400, height: options.height ?? 600 }
    this.loadCount = 0
    this.webContents = {
      id: this.id,
      loading: true,
      isLoadingMainFrame: () => this.webContents.loading,
      send: (channel, payload) => {
        testState().sends.push({ window: this, channel, payload })
      },
      on: (event, listener) => this.onWebContents(event, listener),
      once: (event, listener) => this.onceWebContents(event, listener),
      removeListener: (event, listener) => {
        const entries = this.webContentsEvents.get(event) ?? []
        const index = entries.indexOf(listener)
        if (index >= 0) entries.splice(index, 1)
      },
      isDevToolsOpened: () => false,
      setWindowOpenHandler: () => undefined,
    }
    this.webContentsEvents = new Map()
    testState().windows.push(this)
  }
  static fromWebContents(sender) {
    return testState().bySender.get(sender) ?? null
  }
  static getAllWindows() {
    return testState().windows.filter((win) => !win.destroyed)
  }
  onWebContents(event, listener) {
    const entries = this.webContentsEvents.get(event) ?? []
    entries.push(listener)
    this.webContentsEvents.set(event, entries)
  }
  onceWebContents(event, listener) {
    const wrapper = (...args) => {
      this.webContents.removeListener(event, wrapper)
      listener(...args)
    }
    this.onWebContents(event, wrapper)
  }
  emitWebContents(event, ...args) {
    if (event === 'did-finish-load') this.webContents.loading = false
    for (const listener of [...(this.webContentsEvents.get(event) ?? [])]) listener(...args)
  }
  isDestroyed() { return this.destroyed }
  isVisible() { return this.visible }
  isMinimized() { return this.minimized }
  isFocused() { return this.focused }
  restore() { this.minimized = false }
  show() { this.visible = true; this.emit('show') }
  hide() { this.visible = false; this.emit('hide') }
  focus() { this.focused = true; this.emit('focus') }
  moveTop() {}
  getBounds() { return this.bounds }
  setPosition(x, y) { this.bounds = { ...this.bounds, x, y } }
  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  loadURL(url) {
    this.url = url
    this.loadCount += 1
    this.webContents.loading = true
    return Promise.resolve()
  }
  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.visible = false
    this.emit('closed')
  }
}
`

const WINDOW_MANAGER_HELPERS_STUB = `
export function clampWindowPosition(_w, _h, x, y) { return { x, y } }
export function getPanelWindowPosition(width, height, owner, workArea) {
  return { x: (owner?.x ?? 0) + 24, y: (workArea?.y ?? 0) + 24, width, height }
}
`

const PLATFORM_PROFILE_STUB = `
export function buildPlatformProfile() { return {} }
`

const SETTINGS_RETURN_FOCUS_STUB = `
export function createSettingsReturnFocusCoordinator() {
  return { isPending: () => false, consume() {}, cancel() {}, request() {} }
}
`

const WINDOW_ASSETS_STUB = `
export function createNativeImageFromCandidates() { return null }
export function getPetIconCandidates() { return [] }
export function getPetIconPath() { return '/fake/pet-icon.png' }
export function applyWindowIcon() {}
export function applyWindowsAppDetails() {}
`

const LAUNCH_ON_STARTUP_STUB = `
let enabled = false
export function getLaunchOnStartupState() { return enabled }
export function setLaunchOnStartupState(next) { enabled = next; return enabled }
`

const RUNTIME_LOG_STUB = `
export const RUNTIME_LOG_DISPLAY_PATH = '/fake/runtime.log'
export class RuntimeLogWriteBuffer { enqueue() {} drain() { return Promise.resolve() } }
export function createRendererRuntimeLogEntry() { return {} }
export function serializeRuntimeLogEntry() { return '' }
export function sanitizeRuntimeLogMessage(message) { return String(message ?? '') }
`

const ERROR_REDACTION_STUB = `
export function getRedactedErrorMessage(error) { return String(error?.message ?? error ?? '') }
export function redactSensitiveErrorText(value) { return String(value ?? '') }
`

const MAIN_MESSAGES_STUB = `
export function mainT(key) { return key }
`

const PET_WINDOW_INSTANCES_STUB = `
export function applyPetWindowInstances() {}
export function configurePetWindowInstances() {}
export function getPetInstanceForWindow() { return null }
export function destroyPetInstance() {}
export function registerPetInstance() {}
export function getPetWindowStateForEvent() { return { isPinned: false, clickThrough: false, petHotspotActive: false } }
export function updatePetWindowStateForEvent() {}
export function setPetFreeModeForEvent() {}
`

const PANEL_WINDOW_CONTROLLER_STUB = `
export const panelWindowState = { collapsed: false }
export function configurePanelWindowController() {}
export function getPanelWindowCreationState() {
  return { width: 460, height: 660, x: 10, y: 10, resizable: true, minWidth: 400, minHeight: 540 }
}
export function isPanelWindowTrackable() { return true }
export function rememberPanelWindowBounds() {}
export function emitPanelWindowState() {}
export function updatePanelWindowState() { return panelWindowState }
`

const PET_CONTEXT_MENU_STUB = `
export function popupPetContextMenu() { return Promise.resolve(null) }
`

const PANEL_SECTION_INTENT_STUB = `
export function initialPanelSectionState() { return { section: 'chat', intent: null, intentToken: 0 } }
export function requestPanelSection() { return initialPanelSectionState() }
export function consumePanelSectionIntent(state) { return state }
export function panelSectionSnapshot(state) { return state }
`

const WINDOW_RUNTIME_STATE_STUB = `${STATE_PRELUDE}
export function bindRuntimeWindows() {}
export function buildRuntimeStateSnapshot() { return { ...testState().snapshot } }
export function updateRuntimeState() {}
export function updateHeartbeat() {}
export function startReminderPanelWakeMonitor() { testState().monitorStarts += 1 }
export function stopReminderPanelWakeMonitor() { testState().monitorStops += 1 }
export function checkReminderPanelWakeNow() {}
export function syncRuntimeState() {}
`

const RENDERER_SERVER_STUB = `
export function getPreloadPath() { return '/fake/preload.js' }
export function getRendererEntry(view) { return 'file:///fake/index.html?view=' + view }
`

const WINDOW_BOUNDS_STORE_STUB = `
export function getSavedBounds() { return null }
export function trackWindow() {}
`

const WINDOW_NAVIGATION_STUB = `
export function externalWindowOpenNeedsConfirmation() { return false }
export function isAllowedRendererNavigation() { return true }
export function normalizeExternalWindowOpenUrl(url) { return url }
export function summarizeWindowNavigationErrorForLog() { return '' }
export function summarizeWindowNavigationUrlForLog() { return '' }
`

const USER_FACING_DIALOGS_STUB = `
export function externalOpenDialogCopy() { return { title: '', message: '', detail: '' } }
`

const EXTERNAL_OPEN_CONFIRMATION_STUB = `
export function getExternalOpenConfirmation() { return { confirmed: true } }
`

const WINDOW_CAPABILITIES_STUB = `
export function bindWindowCapability() {}
export function unbindWindowCapability() {}
`

const MODULE_STUBS = new Map([
  ['/electron/platformProfile.js', PLATFORM_PROFILE_STUB],
  ['/electron/windowManagerHelpers.js', WINDOW_MANAGER_HELPERS_STUB],
  ['/electron/settingsReturnFocus.js', SETTINGS_RETURN_FOCUS_STUB],
  ['/electron/windowAssets.js', WINDOW_ASSETS_STUB],
  ['/electron/launchOnStartup.js', LAUNCH_ON_STARTUP_STUB],
  ['/electron/runtimeLogSanitizer.js', RUNTIME_LOG_STUB],
  ['/electron/services/errorRedaction.js', ERROR_REDACTION_STUB],
  ['/electron/mainMessages.js', MAIN_MESSAGES_STUB],
  ['/electron/petWindowInstances.js', PET_WINDOW_INSTANCES_STUB],
  ['/electron/panelWindowController.js', PANEL_WINDOW_CONTROLLER_STUB],
  ['/electron/petContextMenu.js', PET_CONTEXT_MENU_STUB],
  ['/shared/panelSectionIntent.js', PANEL_SECTION_INTENT_STUB],
  ['/electron/windowRuntimeState.js', WINDOW_RUNTIME_STATE_STUB],
  ['/electron/rendererServer.js', RENDERER_SERVER_STUB],
  ['/electron/services/windowBoundsStore.js', WINDOW_BOUNDS_STORE_STUB],
  ['/electron/windowNavigation.js', WINDOW_NAVIGATION_STUB],
  ['/electron/userFacingDialogs.js', USER_FACING_DIALOGS_STUB],
  ['/electron/services/externalOpenConfirmation.js', EXTERNAL_OPEN_CONFIRMATION_STUB],
  ['/electron/ipc/windowCapabilities.js', WINDOW_CAPABILITIES_STUB],
])

export const hookUrl = import.meta.url

export function windowLifecycleState() {
  if (!globalThis[STATE_KEY]) {
    globalThis[STATE_KEY] = {
      windows: [],
      sends: [],
      bySender: new Map(),
      monitorStarts: 0,
      monitorStops: 0,
      powerMonitorListeners: {},
      panelWindowSetter: null,
      snapshot: { petOnline: true, panelOnline: true, petLastSeenAt: '', voiceState: 'idle', continuousVoiceActive: false, assistantActivity: 'idle', searchInProgress: false, ttsInProgress: false },
      nextWindowId: 1,
    }
  }
  return globalThis[STATE_KEY]
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: 'electron-stub:window-lifecycle', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === 'electron-stub:window-lifecycle') {
    return { format: 'module', shortCircuit: true, source: ELECTRON_STUB }
  }
  for (const [suffix, source] of MODULE_STUBS) {
    if (url.endsWith(suffix)) {
      return { format: 'module', shortCircuit: true, source }
    }
  }
  return nextLoad(url, context)
}
