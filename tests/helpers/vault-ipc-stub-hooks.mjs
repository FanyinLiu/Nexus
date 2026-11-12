// node:module resolve/load hooks that let node:test import the real
// electron/ipc/vaultIpc.js without booting Electron, touching the real
// Keychain, or writing an audit log. 'electron' resolves to a virtual stub
// whose ipcMain records the vault handlers; the vault backend, audit log,
// and trusted-sender check are replaced with in-memory fakes so a test can
// observe exactly which backend calls and audit entries a handler produces.
//
// The payload schemas, vault ref issuer, and vault audit summarizers stay
// real: they own the behavior under test.

const STATE_KEY = '__nexusTestVaultIpc'

// Shared prelude: every stub reads and mutates one main-process state object
// owned by the test, so the fake backend and audit log stay isolated per case.
const STATE_PRELUDE = `
function testState() {
  if (!globalThis.${STATE_KEY}) {
    globalThis.${STATE_KEY} = {
      handlers: new Map(),
      auditEntries: [],
      vault: new Map(),
      calls: {
        store: [],
        delete: [],
        listSlots: 0,
        storeMany: [],
        retrieveMany: [],
        isAvailable: 0,
      },
    }
  }
  return globalThis.${STATE_KEY}
}
`

const ELECTRON_STUB = `
${STATE_PRELUDE}
export const ipcMain = {
  handle(channel, listener) {
    testState().handlers.set(channel, listener)
  },
}
export const app = {
  getPath() {
    return ''
  },
}
export const BrowserWindow = {
  fromWebContents: () => null,
}
`

const VALIDATE_STUB = `
${STATE_PRELUDE}
export function requireTrustedSender(event) {
  if (event?.trusted !== true) {
    throw new Error('IPC rejected: untrusted sender')
  }
}
export function installIpcChannelBinding() {}
`

const AUDIT_LOG_STUB = `
${STATE_PRELUDE}
export function audit(category, action, details) {
  testState().auditEntries.push({ category, action, details })
}
export function closeAuditLog() {}
`

// In-memory vault backend. Every mutation and read is recorded so the tests
// can prove untrusted senders never reach it and the happy path does.
const KEY_VAULT_STUB = `
${STATE_PRELUDE}
export async function vaultStore(slot, plaintext) {
  const state = testState()
  state.calls.store.push({ slot, plaintext })
  if (plaintext) state.vault.set(slot, String(plaintext))
  else state.vault.delete(slot)
}

export async function vaultDelete(slot) {
  const state = testState()
  state.calls.delete.push(slot)
  state.vault.delete(slot)
}

export async function vaultListSlots() {
  const state = testState()
  state.calls.listSlots += 1
  return [...state.vault.keys()]
}

export async function vaultStoreMany(entries) {
  const state = testState()
  state.calls.storeMany.push({ ...entries })
  for (const [slot, value] of Object.entries(entries)) {
    if (value) state.vault.set(slot, String(value))
    else state.vault.delete(slot)
  }
}

export async function vaultRetrieveMany(slots) {
  const state = testState()
  state.calls.retrieveMany.push([...slots])
  const values = {}
  for (const slot of slots) {
    if (state.vault.has(slot)) values[slot] = state.vault.get(slot)
  }
  return values
}

export function vaultIsAvailable() {
  const state = testState()
  state.calls.isAvailable += 1
  return true
}
`

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: 'electron-stub:electron', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === 'electron-stub:electron') {
    return { format: 'module', shortCircuit: true, source: ELECTRON_STUB }
  }
  if (url.endsWith('/electron/ipc/validate.js')) {
    return { format: 'module', shortCircuit: true, source: VALIDATE_STUB }
  }
  if (url.endsWith('/electron/services/auditLog.js')) {
    return { format: 'module', shortCircuit: true, source: AUDIT_LOG_STUB }
  }
  if (url.endsWith('/electron/services/keyVault.js')) {
    return { format: 'module', shortCircuit: true, source: KEY_VAULT_STUB }
  }
  return nextLoad(url, context)
}
