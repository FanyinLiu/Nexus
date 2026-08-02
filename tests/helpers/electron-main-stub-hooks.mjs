// node:module resolve/load hooks that let node:test import electron
// main-process modules which statically `import ... from 'electron'`.
// Registered via `register(new URL('./helpers/electron-main-stub-hooks.mjs', ...))`
// before the dynamic import of the module under test.
//
// Only electron/ipcRegistry.js and electron/services/errorRedaction.js load
// for real: 'electron' itself resolves to a virtual stub, and every eager
// IPC module / TTS service the registry pulls in is swapped for a no-op
// stub so no real handlers, windows, or network services start.

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
    // Simulated flaky module: the module itself loads fine (so Node caches
    // it identically on every version), but its register() throws while the
    // test keeps globalThis.__nexusTestSkillIpcFail set. Node 22 caches
    // *failed* module loads, so throwing from the load hook made the retry
    // path untestable there (the second import() never re-entered this hook);
    // throwing from register() exercises the same catch-and-retry path in
    // loadDeferredModules on every Node version.
    return {
      format: 'module',
      shortCircuit: true,
      source: `export function register() {
        if (globalThis.__nexusTestSkillIpcFail) {
          throw new Error('simulated skillIpc import failure for /Users/nexus-test-user with key sk-0123456789abcdef')
        }
      }\n`,
    }
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
