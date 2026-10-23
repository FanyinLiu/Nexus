/**
 * Lets node:test import electron/ipc/personaIpc.js and call the save handler.
 * The trusted-sender check is a no-op here; payload checks stay in the handler.
 * userData comes from globalThis.__nexusPersonaIpcUserData.
 */

const electronSource = `
export const app = {
  getPath(name) {
    if (name !== 'userData') throw new Error('unexpected app path ' + String(name))
    return globalThis.__nexusPersonaIpcUserData
  },
}
export const ipcMain = {
  handle(channel, listener) {
    const handlers = globalThis.__nexusPersonaIpcHandlers ??= new Map()
    handlers.set(channel, listener)
  },
}
export const shell = { async openPath() { return '' } }
export const dialog = {}
export class BrowserWindow {}
`

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: 'electron-stub:persona-ipc', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === 'electron-stub:persona-ipc') {
    return { format: 'module', shortCircuit: true, source: electronSource }
  }
  if (url.endsWith('/electron/ipc/validate.js')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export function requireTrustedSender() {}\n',
    }
  }
  return nextLoad(url, context)
}
