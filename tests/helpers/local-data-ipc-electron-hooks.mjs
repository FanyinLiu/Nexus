// node:module resolve/load hooks that let node:test import the real
// electron/ipc/localDataIpc.js without booting Electron.
//
// 'electron' resolves to a virtual stub whose ipcMain records every handler and
// whose app.getPath('userData') returns the temp directory selected by the
// test. The trusted-sender policy, payload schemas, and local-data services
// stay real so the tests pin the actual IPC gate and the mutation paths.

const STATE_KEY = '__nexusLocalDataIpcTestState'

const ELECTRON_STUB = `
function testState() {
  if (!globalThis.${STATE_KEY}) {
    globalThis.${STATE_KEY} = {
      handlers: new Map(),
      userData: null,
      ownerWindows: new Map(),
    }
  }
  return globalThis.${STATE_KEY}
}
export const app = {
  getPath(name) {
    if (name !== 'userData') throw new Error('unexpected app path ' + String(name))
    const userData = testState().userData
    if (!userData) throw new Error('local-data IPC test userData is not configured')
    return userData
  },
}
export const ipcMain = {
  handle(channel, listener) {
    testState().handlers.set(channel, listener)
  },
}
export class BrowserWindow {
  static fromWebContents(webContents) {
    return testState().ownerWindows.get(webContents) ?? null
  }
}
`

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: 'electron-stub:local-data-ipc', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === 'electron-stub:local-data-ipc') {
    return { format: 'module', shortCircuit: true, source: ELECTRON_STUB }
  }
  return nextLoad(url, context)
}
