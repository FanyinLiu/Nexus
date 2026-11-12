// node:module resolve/load hooks that let node:test import five real IPC
// modules (memory, persona, vault, local-data, plugin) without booting
// Electron. Only the `electron` module and the backend singletons are
// replaced; `electron/ipc/validate.js`, the trusted-sender policy, the window
// capability matrix, and the payload schemas stay real so the test exercises
// the actual trust boundary. Every stub backend records into one shared state
// object so the table test can prove an untrusted sender never reaches it.

import { register } from 'node:module'

const STATE_KEY = '__nexusIpcUntrustedSenderState'

/** Register this module's resolve/load hooks for subsequent imports. */
export function registerIpcUntrustedSenderHooks() {
  register(import.meta.url)
}

const STATE_PRELUDE = `
function testState() {
  if (!globalThis.${STATE_KEY}) {
    globalThis.${STATE_KEY} = {
      handlers: new Map(),
      backendCalls: [],
      ownerWindow: null,
    }
  }
  return globalThis.${STATE_KEY}
}

function hit(name) {
  testState().backendCalls.push(name)
}
`

const ELECTRON_STUB = `
${STATE_PRELUDE}
export const app = {
  getPath() { return '/tmp/nexus-ipc-untrusted-sender' },
  on() {},
  quit() {},
}
export const ipcMain = {
  handle(channel, listener) {
    testState().handlers.set(channel, (event, ...args) => {
      Object.defineProperty(event, 'channel', { value: channel, configurable: true })
      return listener(event, ...args)
    })
  },
  on(channel, listener) {
    testState().handlers.set(channel, (event, ...args) => {
      Object.defineProperty(event, 'channel', { value: channel, configurable: true })
      return listener(event, ...args)
    })
  },
}
export class BrowserWindow {
  static fromWebContents() {
    return testState().ownerWindow
  }
}
export const dialog = {
  async showMessageBox() { return { response: 1 } },
  async showOpenDialog() { return { canceled: true, filePaths: [] } },
}
export const shell = {
  async openPath() { return '' },
  async openExternal() { return undefined },
}
export const session = {
  defaultSession: {
    async clearStorageData() {},
    async flushStorageData() {},
  },
}
`

const MEMORY_USER_DATA_CLEAR_STUB = `${STATE_PRELUDE}
export async function clearMemoryUserData() {
  hit('clearMemoryUserData')
  return { removed: 0, localDataCleared: 0, snapshotMemoryFilesRemoved: 0 }
}
`

const MEMORY_FLUSH_ACK_GATE_STUB = `${STATE_PRELUDE}
export function createMemoryFlushAckGate() {
  return { acknowledge() { hit('flushAck') } }
}
export function createMemoryQuitFlushHandler() {
  return () => {}
}
`

const UPDATE_INSTALL_QUIT_FLAG_STUB = `
export function isUpdateInstallQuit() { return false }
`

const MEMORY_VECTOR_STORE_STUB = `${STATE_PRELUDE}
export async function indexMemory() { hit('indexMemory') }
export async function indexBatch() { hit('indexBatch') }
export async function searchSimilar() { hit('searchSimilar'); return [] }
export async function searchKeyword() { hit('searchKeyword'); return [] }
export async function searchHybrid() { hit('searchHybrid'); return [] }
export async function removeMemory() { hit('removeMemory'); return true }
export async function removeMemories() { hit('removeMemories'); return 0 }
export function getStats() { hit('getStats'); return { count: 0 } }
`

const LONG_TERM_MEMORY_STORE_STUB = `${STATE_PRELUDE}
export function createLongTermMemoryFileStore() {
  return {
    async load() { hit('longTermLoad'); return { exists: false, memories: [] } },
    async save() { hit('longTermSave'); return { ok: true, count: 0 } },
    async clear() { hit('longTermClear'); return { ok: true } },
  }
}
export function resolveLongTermMemoryFilePath() {
  return '/tmp/nexus-ipc-untrusted-sender/long-term-memory.json'
}
`

const OLLAMA_EMBED_STUB = `${STATE_PRELUDE}
export async function embedWithOllama() {
  hit('embedWithOllama')
  return { ok: false, code: 'error', message: 'stub' }
}
export async function detectOllamaModel() {
  hit('detectOllamaModel')
  return { reachable: false, installed: false }
}
`

const NET_STUB = `${STATE_PRELUDE}
export async function performNetworkRequest() {
  hit('performNetworkRequest')
  throw new Error('network disabled in test')
}
`

const PERSONA_LOADER_STUB = `${STATE_PRELUDE}
export function loadSoul() { hit('loadSoul'); return '' }
export function loadPersonaMemory() { hit('loadPersonaMemory'); return '' }
export async function savePersonaProfileSoul() { hit('savePersonaProfileSoul'); return true }
export async function saveSoul() { hit('saveSoul') }
export async function savePersonaProfileStyle() { hit('savePersonaProfileStyle'); return true }
export function getPersonaPaths() { hit('getPersonaPaths'); return {} }
export function getPersonaAbsolutePaths() { hit('getPersonaAbsolutePaths'); return { personaDir: '/tmp' } }
export async function ensurePersonaDir() { hit('ensurePersonaDir'); return {} }
export async function loadPersonaProfile() { hit('loadPersonaProfile'); return {} }
export function getPersonaProfileDisplayDir() { hit('getPersonaProfileDisplayDir'); return '/tmp' }
export async function writePersonaProfile() { hit('writePersonaProfile') }
`

const PERSONA_PROFILE_LOADER_STUB = `
export function acceptPersonaSoulContent(value) { return value }
`

const CHARACTER_CARD_PARSER_STUB = `
export async function parseCharacterCard() { return {} }
`

const CHARACTER_CARD_MAPPER_STUB = `
export function mapCardToPersona() {
  return { profileId: 'test', files: {}, profile: {}, greeting: null, lorebookEntries: [] }
}
`

const KEY_VAULT_STUB = `${STATE_PRELUDE}
export async function vaultStore() { hit('vaultStore') }
export async function vaultDelete() { hit('vaultDelete'); return true }
export async function vaultListSlots() { hit('vaultListSlots'); return [] }
export async function vaultStoreMany() { hit('vaultStoreMany') }
export function vaultIsAvailable() { hit('vaultIsAvailable'); return true }
`

const VAULT_REFS_STUB = `${STATE_PRELUDE}
export function issueVaultRefForSender() {
  hit('issueVaultRefForSender')
  return 'nexus-vault-ref:test'
}
`

const LOCAL_DATA_STORE_STUB = `${STATE_PRELUDE}
export async function applyChatLocalDataMigration() { hit('applyChatLocalDataMigration'); return { ok: true } }
export async function compareChatLocalDataSessions() { hit('compareChatLocalDataSessions'); return { ok: true } }
export function getChatLocalDataMigrationStatus() { hit('getChatLocalDataMigrationStatus'); return { ok: true } }
export function getLocalDataStatus() { hit('getLocalDataStatus'); return { ok: true } }
export async function mirrorChatLocalDataSession() { hit('mirrorChatLocalDataSession'); return { ok: true } }
export async function mirrorLocalDataOnboardingState() { hit('mirrorLocalDataOnboardingState'); return { ok: true } }
export async function readChatLocalDataSessions() { hit('readChatLocalDataSessions'); return { sessions: [] } }
export async function rollbackChatLocalDataMigration() { hit('rollbackChatLocalDataMigration'); return { ok: true } }
`

const LOCAL_DATA_MEMORY_STORE_STUB = `${STATE_PRELUDE}
export async function applyMemoryLocalDataMigration() { hit('applyMemoryLocalDataMigration'); return { ok: true } }
export function getMemoryLocalDataMigrationStatus() { hit('getMemoryLocalDataMigrationStatus'); return { ok: true } }
export async function readMemoryLocalData() { hit('readMemoryLocalData'); return { memories: [] } }
export async function rollbackMemoryLocalDataMigration() { hit('rollbackMemoryLocalDataMigration'); return { ok: true } }
`

const LOCAL_DATA_COMPANION_STUB = `${STATE_PRELUDE}
export async function applyCompanionLocalDataMigration() { hit('applyCompanionLocalDataMigration'); return { ok: true } }
export async function compareCompanionLocalData() { hit('compareCompanionLocalData'); return { ok: true } }
export function getCompanionLocalDataMigrationStatus() { hit('getCompanionLocalDataMigrationStatus'); return { ok: true } }
export async function mirrorCompanionLocalDataDataset() { hit('mirrorCompanionLocalDataDataset'); return { ok: true } }
export async function readCompanionLocalData() { hit('readCompanionLocalData'); return { records: [] } }
export async function rollbackCompanionLocalDataMigration() { hit('rollbackCompanionLocalDataMigration'); return { ok: true } }
`

const PLUGIN_HOST_STUB = `${STATE_PRELUDE}
export async function scanPlugins() { hit('scanPlugins') }
export function listPlugins() { hit('listPlugins'); return [] }
export async function startPlugin() { hit('startPlugin'); return {} }
export async function stopPlugin() { hit('stopPlugin') }
export async function restartPlugin() { hit('restartPlugin'); return {} }
export async function enablePlugin() { hit('enablePlugin'); return {} }
export async function disablePlugin() { hit('disablePlugin'); return {} }
export function getPluginStatus() { hit('getPluginStatus'); return null }
export function getPluginsDisplayDir_() { hit('getPluginsDisplayDir_'); return '/tmp' }
export async function approvePlugin() { hit('approvePlugin') }
export async function revokePluginApproval() { hit('revokePluginApproval') }
`

const MCP_HOST_STUB = `${STATE_PRELUDE}
export function getStatus() { hit('mcpGetStatus'); return null }
`

const PLUGIN_MESSAGE_BUS_STUB = `${STATE_PRELUDE}
export function publish() { hit('busPublish'); return 0 }
export function subscribe() { hit('busSubscribe'); return true }
export function unsubscribe() { hit('busUnsubscribe') }
export function listSubscriptions() { hit('busListSubscriptions'); return {} }
export function getRecentMessages() { hit('busGetRecentMessages'); return [] }
export function getStats() { hit('busGetStats'); return {} }
`

const AUDIT_LOG_STUB = `
export function audit() {}
`

// Suffix matched against the resolved module URL so only the exact backend
// singleton is replaced, never a same-named file elsewhere.
const MODULE_STUBS = new Map([
  ['/electron/services/memoryUserDataClear.js', MEMORY_USER_DATA_CLEAR_STUB],
  ['/electron/services/memoryFlushAckGate.js', MEMORY_FLUSH_ACK_GATE_STUB],
  ['/electron/services/updateInstallQuitFlag.js', UPDATE_INSTALL_QUIT_FLAG_STUB],
  ['/electron/services/memoryVectorStore.js', MEMORY_VECTOR_STORE_STUB],
  ['/electron/services/longTermMemoryFileStore.js', LONG_TERM_MEMORY_STORE_STUB],
  ['/electron/services/ollamaEmbed.js', OLLAMA_EMBED_STUB],
  ['/electron/net.js', NET_STUB],
  ['/electron/services/personaLoader.js', PERSONA_LOADER_STUB],
  ['/electron/services/personaProfileLoader.js', PERSONA_PROFILE_LOADER_STUB],
  ['/electron/services/characterCardParser.js', CHARACTER_CARD_PARSER_STUB],
  ['/electron/services/characterCardMapper.js', CHARACTER_CARD_MAPPER_STUB],
  ['/electron/services/keyVault.js', KEY_VAULT_STUB],
  ['/electron/services/vaultRefs.js', VAULT_REFS_STUB],
  ['/electron/services/localDataStore.js', LOCAL_DATA_STORE_STUB],
  ['/electron/services/localDataMemoryStore.js', LOCAL_DATA_MEMORY_STORE_STUB],
  ['/electron/services/localDataCompanionMigration.js', LOCAL_DATA_COMPANION_STUB],
  ['/electron/services/pluginHost.js', PLUGIN_HOST_STUB],
  ['/electron/services/mcpHost.js', MCP_HOST_STUB],
  ['/electron/services/pluginMessageBus.js', PLUGIN_MESSAGE_BUS_STUB],
  ['/electron/services/auditLog.js', AUDIT_LOG_STUB],
])

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: 'electron-stub:ipc-untrusted-sender', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === 'electron-stub:ipc-untrusted-sender') {
    return { format: 'module', shortCircuit: true, source: ELECTRON_STUB }
  }
  for (const [suffix, source] of MODULE_STUBS) {
    if (url.endsWith(suffix)) {
      return { format: 'module', shortCircuit: true, source }
    }
  }
  return nextLoad(url, context)
}
