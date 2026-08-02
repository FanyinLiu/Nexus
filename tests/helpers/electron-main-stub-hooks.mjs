// node:module resolve/load hooks that let node:test import electron
// main-process modules which statically `import ... from 'electron'`.
// Registered via `register(new URL('./helpers/electron-main-stub-hooks.mjs', ...))`
// before the dynamic import of the module under test.
//
// Only electron/ipcRegistry.js and electron/services/errorRedaction.js load
// for real: 'electron' itself resolves to a virtual stub, and every eager
// IPC module / TTS service the registry pulls in is swapped for a no-op
// stub so no real handlers, windows, or network services start.

let skillIpcImportAttempts = 0

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: 'electron-stub:electron', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === 'electron-stub:electron') {
    // ipcRegistry.js only uses `app.once`.
    return { format: 'module', shortCircuit: true, source: 'export const app = { once() {} }\n' }
  }
  if (url.endsWith('/electron/ipc/skillIpc.js')) {
    // First deferred import fails (simulated broken module on disk). Node
    // does not cache failed module loads, so a retried import() re-enters
    // this hook and succeeds on the second attempt.
    skillIpcImportAttempts += 1
    if (skillIpcImportAttempts === 1) {
      throw new Error('simulated skillIpc import failure for /Users/nexus-test-user with key sk-0123456789abcdef')
    }
    return { format: 'module', shortCircuit: true, source: 'export function register() {}\n' }
  }
  if (url.includes('/electron/ipc/')) {
    return { format: 'module', shortCircuit: true, source: 'export function register() {}\n' }
  }
  if (url.endsWith('/electron/services/ttsService.js')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export async function synthesizeRemoteTts() {}\nexport async function warmupRemoteTtsSession() {}\n',
    }
  }
  if (url.endsWith('/electron/ttsStreamService.js')) {
    return { format: 'module', shortCircuit: true, source: 'export function createTtsStreamService() { return {} }\n' }
  }
  return nextLoad(url, context)
}
