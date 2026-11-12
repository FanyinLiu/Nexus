import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bindWindowCapability } from '../electron/ipc/windowCapabilities.js'
import { registerIpcUntrustedSenderHooks } from './helpers/ipc-untrusted-sender-hooks.mjs'

registerIpcUntrustedSenderHooks()

type Handler = (event: unknown, payload?: unknown) => unknown

interface TestState {
  handlers: Map<string, Handler>
  backendCalls: string[]
  ownerWindow: unknown
}

const STATE_KEY = '__nexusIpcUntrustedSenderState'
const TRUSTED_URL = 'http://localhost/index.html?view=panel'

function state(): TestState {
  const holder = globalThis as Record<string, unknown>
  holder[STATE_KEY] ??= {
    handlers: new Map<string, Handler>(),
    backendCalls: [],
    ownerWindow: null,
  }
  return holder[STATE_KEY] as TestState
}

function resetBackends() {
  state().backendCalls.length = 0
}

function untrustedEvent() {
  state().ownerWindow = null
  return {
    sender: { id: 2 },
    senderFrame: { url: TRUSTED_URL, parent: null },
  }
}

function trustedEvent() {
  const sender = { id: 1 }
  state().ownerWindow = { webContents: { getURL: () => TRUSTED_URL } }
  bindWindowCapability(sender, 'panel')
  return {
    sender,
    senderFrame: { url: TRUSTED_URL, parent: null },
  }
}

async function invoke(channel: string, event: unknown) {
  const handler = state().handlers.get(channel)
  assert.ok(handler, `${channel} handler was not registered`)
  return handler(event, {})
}

interface ModuleCase {
  file: string
  channels: string[]
  positiveChannel: string
  positiveBackendCall: string
}

const MODULE_CASES: ModuleCase[] = [
  {
    file: 'memoryIpc',
    channels: [
      'memory:clear-user-data',
      'memory:flush-complete',
      'memory:hybrid-search',
      'memory:keyword-search',
      'memory:long-term-clear',
      'memory:long-term-load',
      'memory:long-term-save',
      'memory:ollama-detect',
      'memory:ollama-embed',
      'memory:reset-local-storage',
      'memory:vector-index',
      'memory:vector-index-batch',
      'memory:vector-remove',
      'memory:vector-search',
      'memory:vector-stats',
    ],
    positiveChannel: 'memory:vector-stats',
    positiveBackendCall: 'getStats',
  },
  {
    file: 'personaIpc',
    channels: [
      'persona:import-card',
      'persona:init',
      'persona:load-memory',
      'persona:load-profile',
      'persona:load-soul',
      'persona:open-dir',
      'persona:paths',
      'persona:profile-dir',
      'persona:save-memory',
      'persona:save-soul',
      'persona:save-style',
    ],
    positiveChannel: 'persona:load-soul',
    positiveBackendCall: 'loadSoul',
  },
  {
    file: 'vaultIpc',
    channels: [
      'vault:delete',
      'vault:is-available',
      'vault:list-slots',
      'vault:retrieve',
      'vault:retrieve-many',
      'vault:store',
      'vault:store-many',
    ],
    positiveChannel: 'vault:is-available',
    positiveBackendCall: 'vaultIsAvailable',
  },
  {
    file: 'localDataIpc',
    channels: [
      'local-data:chat-comparison-preview',
      'local-data:chat-migration-apply',
      'local-data:chat-migration-rollback',
      'local-data:chat-migration-status',
      'local-data:chat-session-mirror',
      'local-data:chat-sessions-read',
      'local-data:companion-comparison-preview',
      'local-data:companion-dataset-mirror',
      'local-data:companion-migration-apply',
      'local-data:companion-migration-rollback',
      'local-data:companion-migration-status',
      'local-data:companion-read',
      'local-data:memory-migration-apply',
      'local-data:memory-migration-rollback',
      'local-data:memory-migration-status',
      'local-data:memory-read',
      'local-data:mirror-onboarding',
      'local-data:status',
    ],
    positiveChannel: 'local-data:status',
    positiveBackendCall: 'getLocalDataStatus',
  },
  {
    file: 'pluginIpc',
    channels: [
      'plugin-bus:publish',
      'plugin-bus:recent',
      'plugin-bus:stats',
      'plugin-bus:subscribe',
      'plugin-bus:subscriptions',
      'plugin-bus:unsubscribe',
      'plugin:approve',
      'plugin:dir',
      'plugin:disable',
      'plugin:enable',
      'plugin:list',
      'plugin:restart',
      'plugin:revoke',
      'plugin:scan',
      'plugin:start',
      'plugin:status',
      'plugin:stop',
    ],
    positiveChannel: 'plugin:list',
    positiveBackendCall: 'listPlugins',
  },
]

for (const moduleCase of MODULE_CASES) {
  test(`${moduleCase.file}: untrusted senders are rejected before any backend call`, async () => {
    state().handlers.clear()
    resetBackends()

    const module = await import(`../electron/ipc/${moduleCase.file}.js`)
    module.register()

    assert.deepEqual([...state().handlers.keys()].sort(), moduleCase.channels)

    for (const channel of moduleCase.channels) {
      resetBackends()
      await assert.rejects(
        () => invoke(channel, untrustedEvent()),
        (error: unknown) => {
          // Pin the rejection to the trust boundary itself. Otherwise a
          // missing trust check could hide behind a payload-validation error
          // and the mutation test would pass for the wrong reason.
          assert.match(
            String((error as Error | undefined)?.message),
            /^IPC rejected: sender is not a known application window$/,
            `${channel} rejected for a reason other than the trust boundary`,
          )
          return true
        },
        `${channel} should reject an untrusted sender`,
      )
      assert.deepEqual(
        state().backendCalls,
        [],
        `${channel} reached a backend even though the sender was untrusted`,
      )
    }

    // Positive control: the same harness must reach the backend for a trusted
    // panel sender, proving the zero-call assertions above are meaningful.
    resetBackends()
    await invoke(moduleCase.positiveChannel, trustedEvent())
    assert.deepEqual(
      state().backendCalls,
      [moduleCase.positiveBackendCall],
      `${moduleCase.positiveChannel} should reach its backend for a trusted sender`,
    )
    state().ownerWindow = null
  })
}
