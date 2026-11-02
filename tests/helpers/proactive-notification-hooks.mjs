// node:module resolve/load hooks that let node:test import the real
// electron/services/proactiveNotification.js without launching Electron.
//
// 'electron' resolves to a virtual stub whose Notification class records every
// instance, the options it was built with, its event handlers, and whether
// show() ran. windowManager is swapped for an inert panel whose focus() bumps a
// counter, so the click handler's two side effects are observable. Unlike
// electron-main-stub-hooks.mjs this hook must NOT stub proactiveNotification.js
// itself: that module is the subject under test.

export const STATE_KEY = '__nexusTestProactiveNotification'

const STATE_PRELUDE = `
function testState() {
  if (!globalThis.${STATE_KEY}) {
    globalThis.${STATE_KEY} = {
      supported: true,
      instances: [],
      shown: 0,
      focusCalls: 0,
      createdWindows: 0,
    }
  }
  return globalThis.${STATE_KEY}
}
`

const ELECTRON_STUB = `
${STATE_PRELUDE}
export class Notification {
  static isSupported() {
    return testState().supported
  }
  constructor(options) {
    this.options = options
    this.handlers = new Map()
    this.shown = false
    testState().instances.push(this)
  }
  on(event, handler) {
    const handlers = this.handlers.get(event) ?? []
    handlers.push(handler)
    this.handlers.set(event, handlers)
    return this
  }
  show() {
    this.shown = true
    testState().shown += 1
  }
}
`

const WINDOW_MANAGER_STUB = `${STATE_PRELUDE}
export const panelWindow = null
export const mainWindow = null
export function getPetIconPath() {
  return '/fake/pet-icon.png'
}
export function createPanelWindow() {
  testState().createdWindows += 1
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore() {},
    show() {},
    focus() {
      testState().focusCalls += 1
    },
  }
}
`

const MODULE_STUBS = new Map([
  ['/electron/windowManager.js', WINDOW_MANAGER_STUB],
])

export const hookUrl = import.meta.url

/** Reset supported flag and every recorded side effect between tests. */
export function resetProactiveNotificationState() {
  globalThis[STATE_KEY] = {
    supported: true,
    instances: [],
    shown: 0,
    focusCalls: 0,
    createdWindows: 0,
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: 'electron-stub:proactive-notification', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === 'electron-stub:proactive-notification') {
    return { format: 'module', shortCircuit: true, source: ELECTRON_STUB }
  }
  for (const [suffix, source] of MODULE_STUBS) {
    if (url.endsWith(suffix)) {
      return { format: 'module', shortCircuit: true, source }
    }
  }
  return nextLoad(url, context)
}
