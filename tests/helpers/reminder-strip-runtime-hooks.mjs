// node:module resolve/load hooks that let node:test import the real
// electron/services/reminderStrip.js without launching Electron.
//
// 'electron' resolves to a virtual stub whose BrowserWindow records every
// instance and its per-webContents IPC handlers, so a test can deliver the
// same 'reminder-strip:action' payload the strip page would send. The
// main-process singletons reminderStrip.js reaches for (windowManager,
// logger, proactiveNotification) are inert except for a focus counter: the
// companion-panel focus call is the observable side effect under test.

export const STATE_KEY = '__nexusTestReminderStrip'

// Shared prelude: every stub records into one state object so the test can
// observe focus calls and reach the strip window's action handler.
const STATE_PRELUDE = `
function testState() {
  if (!globalThis.${STATE_KEY}) {
    globalThis.${STATE_KEY} = { windows: [], focusCalls: 0 }
  }
  return globalThis.${STATE_KEY}
}
`

const ELECTRON_STUB = `
${STATE_PRELUDE}
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 }
export const screen = {
  getDisplayMatching: () => ({ workArea: WORK_AREA }),
  getDisplayNearestPoint: () => ({ workArea: WORK_AREA }),
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
}
export class BrowserWindow {
  constructor(options) {
    this.options = options
    this.handlers = new Map()
    this.destroyed = false
    this.visible = false
    this.bounds = { x: 0, y: 0, width: 0, height: 0 }
    this.webContents = {
      setWindowOpenHandler: () => {},
      on: () => {},
      send: () => {},
      ipc: {
        handle: (channel, listener) => {
          this.handlers.set(channel, listener)
        },
      },
    }
    testState().windows.push(this)
  }
  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  once() {}
  on() {}
  loadFile() {
    return Promise.resolve()
  }
  isDestroyed() {
    return this.destroyed
  }
  isVisible() {
    return this.visible
  }
  getBounds() {
    return this.bounds
  }
  setBounds(bounds) {
    this.bounds = bounds
  }
  showInactive() {
    this.visible = true
  }
  hide() {
    this.visible = false
  }
  destroy() {
    this.destroyed = true
    this.visible = false
  }
}
`

const WINDOW_MANAGER_STUB = `
export const mainWindow = null
`

const LOGGER_STUB = `
export function createLogger() {
  const logger = { debug() {}, info() {}, warn() {}, error() {} }
  logger.child = () => logger
  return logger
}
`

const PROACTIVE_NOTIFICATION_STUB = `${STATE_PRELUDE}
export function focusCompanionPanel() {
  testState().focusCalls += 1
}
export function showProactiveNotification() {
  return false
}
`

const MODULE_STUBS = new Map([
  ['/electron/windowManager.js', WINDOW_MANAGER_STUB],
  ['/electron/logger.js', LOGGER_STUB],
  ['/electron/services/proactiveNotification.js', PROACTIVE_NOTIFICATION_STUB],
])

export const hookUrl = import.meta.url

/** Reset the recorded windows and focus calls between tests. */
export function resetReminderStripState() {
  globalThis[STATE_KEY] = { windows: [], focusCalls: 0 }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: 'electron-stub:reminder-strip', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === 'electron-stub:reminder-strip') {
    return { format: 'module', shortCircuit: true, source: ELECTRON_STUB }
  }
  for (const [suffix, source] of MODULE_STUBS) {
    if (url.endsWith(suffix)) {
      return { format: 'module', shortCircuit: true, source }
    }
  }
  return nextLoad(url, context)
}
