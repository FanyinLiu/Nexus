// node:module resolve/load hooks that let node:test import the real
// electron/ipc/memoryIpc.js with a stubbed `electron` module and a fake vector
// store. The stub records registered IPC handlers, resolves trusted senders
// from objects the test registers, and points app.getPath at a temp dir.
//
// Registered via `register(new URL('./helpers/memory-ipc-electron-hooks.mjs', ...))`
// before the dynamic import of the module under test.

const ELECTRON_STUB = `
export const ipcMain = {
  handle(channel, listener) {
    globalThis.__nexusMemoryIpcHandlers?.set(channel, listener)
  },
}

export const BrowserWindow = {
  fromWebContents(webContents) {
    return globalThis.__nexusMemoryIpcWindows?.get(webContents) ?? null
  },
  getAllWindows() {
    return globalThis.__nexusMemoryIpcAllWindows ?? []
  },
}

export const app = {
  getPath(name) {
    if (name !== 'userData') throw new Error('unexpected app.getPath call')
    const root = globalThis.__nexusMemoryIpcUserData
    if (typeof root !== 'string' || !root) throw new Error('memory IPC test userData is not set')
    return root
  },
  on() {},
  quit() {},
}

export const session = {
  get defaultSession() {
    const value = globalThis.__nexusMemoryIpcSession
    if (!value) throw new Error('memory IPC test session is not set')
    return value
  },
}

export const net = {
  fetch() {
    throw new Error('memory IPC tests must not use the network')
  },
}

export default { ipcMain, BrowserWindow, app, session, net }
`

const VECTOR_STORE_STUB = `
function backend() {
  const value = globalThis.__nexusMemoryVectorBackend
  if (!value) throw new Error('memory vector test backend is not set')
  return value
}

export async function indexMemory(...args) { return backend().indexMemory(...args) }
export async function indexBatch(...args) { return backend().indexBatch(...args) }
export async function searchSimilar(...args) { return backend().searchSimilar(...args) }
export async function removeMemory(...args) { return backend().removeMemory(...args) }
export async function removeMemories(...args) { return backend().removeMemories(...args) }
export async function searchKeyword(...args) { return backend().searchKeyword(...args) }
export async function searchHybrid(...args) { return backend().searchHybrid(...args) }
export async function getStats(...args) { return backend().getStats(...args) }
export async function clearAllEntries(...args) { return backend().clearAllEntries(...args) }
`

const NET_STUB = `
export async function performNetworkRequest() {
  throw new Error('memory IPC tests must not use the network')
}
`

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: 'memory-ipc-stub:electron', shortCircuit: true }
  }
  if (specifier.endsWith('memoryVectorStore.js')) {
    return { url: 'memory-ipc-stub:vector-store', shortCircuit: true }
  }
  if (specifier === '../net.js') {
    return { url: 'memory-ipc-stub:net', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === 'memory-ipc-stub:electron') {
    return { format: 'module', shortCircuit: true, source: ELECTRON_STUB }
  }
  if (url === 'memory-ipc-stub:vector-store') {
    return { format: 'module', shortCircuit: true, source: VECTOR_STORE_STUB }
  }
  if (url === 'memory-ipc-stub:net') {
    return { format: 'module', shortCircuit: true, source: NET_STUB }
  }
  return nextLoad(url, context)
}
