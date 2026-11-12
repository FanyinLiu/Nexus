// node:module resolve/load hooks that let node:test import the real
// electron/ipc/chatIpc.js with a stubbed `electron` module. The stub records
// the registered IPC handlers, resolves a trusted sender window, and forwards
// network requests to a per-test fetch function so log paths can be driven
// without launching Electron or touching the network.
//
// Registered via `register(new URL('./helpers/chat-ipc-electron-hooks.mjs', ...))`
// before the dynamic import of the module under test.

const ELECTRON_STUB = `
export const ipcMain = {
  handle(channel, listener) {
    globalThis.__nexusChatIpcHandlers?.set(channel, listener)
  },
}

export const BrowserWindow = {
  fromWebContents: () => globalThis.__nexusChatIpcOwnerWindow ?? null,
}

export const net = {
  fetch: (url, options) => {
    const fetchFn = globalThis.__nexusChatIpcFetch
    if (typeof fetchFn !== 'function') {
      throw new Error('chat IPC test fetch is not configured')
    }
    return fetchFn(url, options)
  },
}

export const app = {
  getPath: () => globalThis.__nexusChatIpcUserData ?? '',
  getLocale: () => 'en-US',
  isPackaged: false,
}

export const safeStorage = {
  isEncryptionAvailable: () => false,
}

export default { ipcMain, BrowserWindow, net, app, safeStorage }
`

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: 'chat-ipc-stub:electron', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === 'chat-ipc-stub:electron') {
    return { format: 'module', shortCircuit: true, source: ELECTRON_STUB }
  }
  return nextLoad(url, context)
}
