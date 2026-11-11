// node:module resolve/load hooks that let node:test import
// electron/services/desktopPresence.js without a real Electron process.
//
// 'electron' resolves to a stub whose Accessibility answer, forced error, and
// window list live on globalThis.__nexusDesktopPresenceStub, so a test can flip
// trust, force an accessibility throw, and capture IPC sends.
// 'uiohook-napi' resolves to a fake native hook whose start/stop/listener state
// lives on globalThis.__nexusDesktopPresenceHook. Tests emit synthetic key
// events through it and can make start() throw. Nothing here touches a real
// keyboard hook, a real window, or the user's settings.
//
// Registered via `register(new URL('./helpers/desktop-presence-stub-hooks.mjs',
// import.meta.url))` before the dynamic import of the module under test.

const ELECTRON_STUB_URL = 'desktop-presence-stub:electron'
const UIOHOOK_STUB_URL = 'desktop-presence-stub:uiohook'

// 'electron' is a static import of the module under test, but 'uiohook-napi'
// is loaded lazily on the first typing refresh. Create both state bags here so
// a test can inspect/reset the hook counters before that lazy import happens.
globalThis.__nexusDesktopPresenceStub ??= {
  trustAccessibility: false,
  accessibilityError: null,
  windows: [],
}
globalThis.__nexusDesktopPresenceHook ??= {
  starts: 0,
  stops: 0,
  keydown: 0,
  keyup: 0,
  listeners: new Map(),
  startError: null,
  emit: () => {},
}

const ELECTRON_SOURCE = `
const state = globalThis.__nexusDesktopPresenceStub ??= {
  trustAccessibility: false,
  accessibilityError: null,
  windows: [],
}
state.windows ??= []
export const systemPreferences = {
  isTrustedAccessibilityClient() {
    if (state.trustAccessibility === 'throw') {
      throw state.accessibilityError ?? new Error('simulated accessibility probe failure')
    }
    return state.trustAccessibility === true
  },
}
export const app = {
  on() {},
  once() {},
  removeListener() {},
  getPath() {
    return '/nonexistent/nexus-presence-test-user-data'
  },
}
export class BrowserWindow {
  static getAllWindows() {
    return state.windows
  }
}
export const powerMonitor = {
  getSystemIdleTime() {
    return 0
  },
  on() {},
  removeListener() {},
}
export const screen = {
  getCursorScreenPoint() {
    return { x: 0, y: 0 }
  },
}
export const shell = {
  async openExternal() {
    return undefined
  },
}
`

const UIOHOOK_SOURCE = `
const state = globalThis.__nexusDesktopPresenceHook ??= {
  starts: 0,
  stops: 0,
  keydown: 0,
  keyup: 0,
  listeners: new Map(),
  startError: null,
}
state.listeners ??= new Map()
function updateCount(event) {
  state[event] = state.listeners.get(event)?.size ?? 0
}
export const uIOhook = {
  on(event, listener) {
    const set = state.listeners.get(event) ?? new Set()
    set.add(listener)
    state.listeners.set(event, set)
    updateCount(event)
    return uIOhook
  },
  off(event, listener) {
    state.listeners.get(event)?.delete(listener)
    updateCount(event)
    return uIOhook
  },
  start() {
    state.starts += 1
    if (state.startError) throw state.startError
  },
  stop() {
    state.stops += 1
  },
}
state.emit = (event, payload) => {
  for (const listener of state.listeners.get(event) ?? []) listener(payload)
}
`

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: ELECTRON_STUB_URL, shortCircuit: true }
  }
  if (specifier === 'uiohook-napi') {
    return { url: UIOHOOK_STUB_URL, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === ELECTRON_STUB_URL) {
    return { format: 'module', shortCircuit: true, source: ELECTRON_SOURCE }
  }
  if (url === UIOHOOK_STUB_URL) {
    return { format: 'module', shortCircuit: true, source: UIOHOOK_SOURCE }
  }
  return nextLoad(url, context)
}
