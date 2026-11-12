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
// 'shared/typingActivity.js' resolves to a wrapper around the real module that
// records the opaque token each keydown/keyup passes into the machine. The
// wrapper forwards every other export unchanged, so the state machine itself
// still runs for real. Tokens live on globalThis.__nexusDesktopPresenceMachine
// and let a test pin that the handler tokenizes on event.keycode, not
// event.key, without adding a production seam.
//
// Registered via `register(new URL('./helpers/desktop-presence-stub-hooks.mjs',
// import.meta.url))` before the dynamic import of the module under test.

const ELECTRON_STUB_URL = 'desktop-presence-stub:electron'
const UIOHOOK_STUB_URL = 'desktop-presence-stub:uiohook'
const TYPING_ACTIVITY_STUB_PREFIX = 'desktop-presence-stub:typing-activity?real='

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

function typingActivityWrapperSource(realUrl) {
  return `
const state = globalThis.__nexusDesktopPresenceMachine ??= { tokens: { down: [], up: [] } }
state.tokens ??= { down: [], up: [] }
export * from ${JSON.stringify(realUrl)}
import { createTypingActivityMachine as createRealMachine } from ${JSON.stringify(realUrl)}
export function createTypingActivityMachine(options) {
  const machine = createRealMachine(options)
  return {
    ...machine,
    keyDown(token, now) {
      state.tokens.down.push(token)
      return machine.keyDown(token, now)
    },
    keyUp(token, now) {
      state.tokens.up.push(token)
      return machine.keyUp(token, now)
    },
  }
}
`
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: ELECTRON_STUB_URL, shortCircuit: true }
  }
  if (specifier === 'uiohook-napi') {
    return { url: UIOHOOK_STUB_URL, shortCircuit: true }
  }
  const resolved = await nextResolve(specifier, context)
  // The wrapper imports the real module by absolute URL, so specifier and
  // resolved URL match there. Only the relative import from the module under
  // test is wrapped, which keeps the wrapper from wrapping itself.
  if (
    resolved.url !== specifier
    && resolved.url.includes('/shared/typingActivity.js')
    && !resolved.url.startsWith('desktop-presence-stub:')
  ) {
    return {
      url: `${TYPING_ACTIVITY_STUB_PREFIX}${encodeURIComponent(resolved.url)}`,
      shortCircuit: true,
    }
  }
  return resolved
}

export async function load(url, context, nextLoad) {
  if (url === ELECTRON_STUB_URL) {
    return { format: 'module', shortCircuit: true, source: ELECTRON_SOURCE }
  }
  if (url === UIOHOOK_STUB_URL) {
    return { format: 'module', shortCircuit: true, source: UIOHOOK_SOURCE }
  }
  if (url.startsWith(TYPING_ACTIVITY_STUB_PREFIX)) {
    const realUrl = decodeURIComponent(url.slice(TYPING_ACTIVITY_STUB_PREFIX.length))
    return {
      format: 'module',
      shortCircuit: true,
      source: typingActivityWrapperSource(realUrl),
    }
  }
  return nextLoad(url, context)
}
