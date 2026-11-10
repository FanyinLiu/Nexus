// node:module resolve/load hooks that let node:test import
// electron/services/desktopPresence.js without a real Electron process.
//
// 'electron' resolves to a stub whose Accessibility answer is read from
// globalThis.__nexusDesktopPresenceStub so a test can flip trust at runtime.
// 'uiohook-napi' resolves to a fake native hook that counts start/stop and
// key listener attachment. Nothing here touches the real keyboard hook.
//
// Registered via `register(new URL('./helpers/desktop-presence-stub-hooks.mjs',
// import.meta.url))` before the dynamic import of the module under test.

const ELECTRON_STUB_URL = 'desktop-presence-stub:electron'
const UIOHOOK_STUB_URL = 'desktop-presence-stub:uiohook'

const ELECTRON_SOURCE = `
const state = globalThis.__nexusDesktopPresenceStub ??= { trustAccessibility: false }
export const systemPreferences = {
  isTrustedAccessibilityClient() {
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
    return []
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
const counts = globalThis.__nexusDesktopPresenceHookCounts ??= {
  starts: 0,
  stops: 0,
  keydown: 0,
  keyup: 0,
}
const listeners = new Map()
export const uIOhook = {
  on(event, listener) {
    const set = listeners.get(event) ?? new Set()
    set.add(listener)
    listeners.set(event, set)
    counts[event] = set.size
    return uIOhook
  },
  off(event, listener) {
    listeners.get(event)?.delete(listener)
    counts[event] = listeners.get(event)?.size ?? 0
    return uIOhook
  },
  start() {
    counts.starts += 1
  },
  stop() {
    counts.stops += 1
  },
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
