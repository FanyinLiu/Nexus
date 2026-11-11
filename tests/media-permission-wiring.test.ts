import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./helpers/window-ipc-stub-hooks.mjs', import.meta.url))

const voiceRuntimeIpc = await import('../electron/ipc/voiceRuntimeIpc.js')
const externalActionPolicyIpc = await import('../electron/ipc/externalActionPolicyIpc.js')
const { registerPermissionConsumers } = await import('../electron/ipc/permissionWiring.js')
const { createMediaPermissionLifecycle } = await import('../electron/services/mediaPermissionLifecycle.js')

type Handler = (event: unknown, payload: unknown) => unknown

function handlers(): Map<string, Handler> {
  const state = (globalThis as {
    __nexusTestMainProcess?: { handlers: Map<string, Handler> }
  }).__nexusTestMainProcess
  assert.ok(state, 'window IPC stub did not install a handler map')
  return state.handlers
}

function createFakeLifecycle() {
  const voicePayloads: unknown[] = []
  const desktopPayloads: unknown[] = []
  const statusRequests: unknown[] = []
  return {
    voicePayloads,
    desktopPayloads,
    statusRequests,
    lifecycle: {
      observeVoiceRuntime(payload: unknown) {
        voicePayloads.push(payload)
        return false
      },
      observeDesktopContext(payload: unknown) {
        desktopPayloads.push(payload)
        return false
      },
      async inspectReadOnly(payload: unknown) {
        statusRequests.push(payload)
        return { platform: 'darwin', microphone: 'unknown', screenRecording: 'unknown' }
      },
    },
  }
}

const voicePayload = {
  speechInputEnabled: true,
  speechInputProviderId: 'local-sensevoice',
  speechOutputEnabled: false,
  speechOutputProviderId: 'edge-tts',
  microphoneActive: true,
  settingsRevision: 4,
}

test('voice-runtime:sync forwards the revision to observeVoiceRuntime', async () => {
  const fake = createFakeLifecycle()
  voiceRuntimeIpc.register({ voiceSidecarSupervisor: { applySettings() {} }, mediaPermissionLifecycle: fake.lifecycle })
  const handler = handlers().get('voice-runtime:sync')
  assert.equal(typeof handler, 'function')

  await handler!(undefined, voicePayload)

  assert.deepEqual(fake.voicePayloads, [voicePayload])
})

test('external-action-policy:sync forwards the revision and combined screenshot flag', async () => {
  const fake = createFakeLifecycle()
  externalActionPolicyIpc.register({ mediaPermissionLifecycle: fake.lifecycle })
  const handler = handlers().get('external-action-policy:sync')
  assert.equal(typeof handler, 'function')

  await handler!(undefined, {
    policies: {},
    desktopContext: {
      activeWindow: false,
      clipboard: false,
      screenshot: true,
    },
    settingsRevision: 9,
  })

  assert.deepEqual(fake.desktopPayloads, [{
    settingsRevision: 9,
    screenshot: true,
  }])
})

test('external-action-policy:get does not read media permissions', async () => {
  const fake = createFakeLifecycle()
  externalActionPolicyIpc.register({ mediaPermissionLifecycle: fake.lifecycle })
  const handler = handlers().get('external-action-policy:get')
  assert.equal(typeof handler, 'function')

  await handler!(undefined, undefined)

  assert.deepEqual(fake.statusRequests, [])
})

test('the real voice handler baseline then off → on produces exactly one guide', async () => {
  const calls: Array<{ type: string, kind?: string }> = []
  const deps = {
    platform: 'darwin',
    systemPreferences: {
      getMediaAccessStatus(kind: string) {
        calls.push({ type: 'status', kind })
        return 'denied'
      },
      async askForMediaAccess() {
        calls.push({ type: 'ask' })
        return false
      },
    },
    dialog: {
      async showMessageBox() {
        calls.push({ type: 'dialog' })
        return { response: 1 }
      },
    },
    shell: {
      async openExternal() {
        calls.push({ type: 'open' })
      },
    },
  }
  const lifecycle = createMediaPermissionLifecycle({
    platform: 'darwin',
    macDeps: deps,
    windowsDeps: deps,
  })
  voiceRuntimeIpc.register({ voiceSidecarSupervisor: { applySettings() {} }, mediaPermissionLifecycle: lifecycle })
  const handler = handlers().get('voice-runtime:sync')
  assert.equal(typeof handler, 'function')

  await handler!(undefined, { ...voicePayload, microphoneActive: false, settingsRevision: 1 })
  await handler!(undefined, { ...voicePayload, microphoneActive: true, settingsRevision: 2 })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(calls.filter((call) => call.type === 'dialog').length, 1)
})

test('registerPermissionConsumers rejects a missing or invalid lifecycle', () => {
  const consumer = { register() {} }
  const base = {
    voiceSidecarSupervisor: { applySettings() {} },
    voiceRuntimeIpc: consumer,
    externalActionPolicyIpc: consumer,
    mediaPermissionIpc: consumer,
  }
  assert.throws(
    () => registerPermissionConsumers({ ...base, mediaPermissionLifecycle: undefined }),
    /permission lifecycle is required/,
  )
  assert.throws(
    () => registerPermissionConsumers({ ...base, mediaPermissionLifecycle: {} }),
    /permission lifecycle is required/,
  )
})

test('handlers reject a missing lifecycle instead of silently doing nothing', async () => {
  assert.throws(
    () => voiceRuntimeIpc.register({ voiceSidecarSupervisor: { applySettings() {} } }),
    /mediaPermissionLifecycle is required/,
  )
  assert.throws(
    () => externalActionPolicyIpc.register({}),
    /mediaPermissionLifecycle is required/,
  )
  const mediaPermissionIpc = await import('../electron/ipc/mediaPermissionIpc.js')
  assert.throws(
    () => mediaPermissionIpc.register({}),
    /mediaPermissionLifecycle is required/,
  )
})

test('ipcRegistry hands the same lifecycle instance to all three permission consumers', () => {
  const seen: Array<{ consumer: string, lifecycle: unknown }> = []
  const lifecycle = {
    marker: 'shared',
    observeVoiceRuntime: () => false,
    observeDesktopContext: () => false,
    inspectReadOnly: async () => ({ platform: 'darwin', microphone: 'unknown', screenRecording: 'unknown' }),
  }
  const consumer = (name: string) => ({
    register(options: { mediaPermissionLifecycle?: unknown }) {
      seen.push({ consumer: name, lifecycle: options.mediaPermissionLifecycle })
    },
  })

  registerPermissionConsumers({
    mediaPermissionLifecycle: lifecycle,
    voiceSidecarSupervisor: { applySettings() {} },
    voiceRuntimeIpc: consumer('voice'),
    externalActionPolicyIpc: consumer('external'),
    mediaPermissionIpc: consumer('status'),
  })

  assert.deepEqual(seen.map((item) => item.consumer).sort(), ['external', 'status', 'voice'])
  assert.ok(seen.every((item) => item.lifecycle === lifecycle))

  const registry = readFileSync(new URL('../electron/ipcRegistry.js', import.meta.url), 'utf8')
  assert.match(registry, /registerPermissionConsumers\(\{[\s\S]*mediaPermissionLifecycle[\s\S]*voiceRuntimeIpc[\s\S]*externalActionPolicyIpc[\s\S]*mediaPermissionIpc/)
})

test('no electron IPC module imports the lifecycle service directly', () => {
  const ipcDir = new URL('../electron/ipc/', import.meta.url)
  for (const file of readdirSync(ipcDir).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(new URL(file, ipcDir), 'utf8')
    assert.doesNotMatch(source, /mediaPermissionLifecycle\.js/, `${file} must receive the lifecycle by injection`)
  }
})
