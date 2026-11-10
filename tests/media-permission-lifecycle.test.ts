import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./helpers/electron-main-stub-hooks.mjs', import.meta.url))

const {
  createMediaPermissionLifecycle,
  runStartupPermissionChecks,
} = await import('../electron/services/mediaPermissionLifecycle.js')
const { runWindowsPermissionChecks } = await import('../electron/services/windowsPermissions.js')
const { buildVoiceRuntimeSyncPayload } = await import('../src/features/voice/voiceRuntimeSync.ts')

type MediaCall = { type: 'status' | 'ask' | 'dialog' | 'open', kind?: string }

function createMediaDeps(statuses: Record<string, string> = {}) {
  const calls: MediaCall[] = []
  return {
    calls,
    systemPreferences: {
      getMediaAccessStatus(kind: string) {
        calls.push({ type: 'status', kind })
        return statuses[kind] ?? 'not-determined'
      },
      async askForMediaAccess(kind: string) {
        calls.push({ type: 'ask', kind })
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
}

function lifecycleFor(platform: 'darwin' | 'win32', media: ReturnType<typeof createMediaDeps>) {
  const deps = { ...media, platform }
  return createMediaPermissionLifecycle({
    platform,
    macDeps: deps,
    windowsDeps: deps,
  })
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function count(calls: MediaCall[], type: MediaCall['type']): number {
  return calls.filter((call) => call.type === type).length
}

test('startup with voice off and screen context off never probes or prompts', async () => {
  const media = createMediaDeps({
    microphone: 'not-determined',
    screen: 'not-determined',
  })
  const lifecycle = lifecycleFor('darwin', media)

  const snapshot = await runStartupPermissionChecks({
    lifecycle,
    getDesktopContextFlags: () => ({ screenContextEnabled: false }),
    delayMs: 0,
  })

  assert.deepEqual(media.calls, [])
  assert.equal(snapshot.microphone, 'unknown')
  assert.equal(snapshot.screenRecording, 'unknown')
})

test('startup checks screen recording only when screenContextEnabled and never prompts', async () => {
  const media = createMediaDeps({ screen: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)

  const snapshot = await runStartupPermissionChecks({
    lifecycle,
    getDesktopContextFlags: () => ({ screenContextEnabled: true }),
    delayMs: 0,
  })

  assert.deepEqual(media.calls, [{ type: 'status', kind: 'screen' }])
  assert.equal(count(media.calls, 'dialog'), 0)
  assert.equal(count(media.calls, 'open'), 0)
  assert.equal(snapshot.screenRecording, 'denied')
})

test('the first voice sync is a global baseline: two startup windows on never prompt', async () => {
  const media = createMediaDeps({ microphone: 'not-determined' })
  const lifecycle = lifecycleFor('darwin', media)

  assert.equal(lifecycle.observeVoiceRuntime({ microphoneActive: true }), false)
  assert.equal(lifecycle.observeVoiceRuntime({ microphoneActive: true }), false)
  await flush()

  assert.equal(count(media.calls, 'ask'), 0)
  assert.equal(count(media.calls, 'dialog'), 0)
})

test('the first screen-context sync is baseline and a denied startup never re-nags', async () => {
  const media = createMediaDeps({ screen: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)

  assert.equal(lifecycle.observeDesktopContext({ screenContextEnabled: true }), false)
  assert.equal(lifecycle.observeDesktopContext({ screenContextEnabled: true }), false)
  await flush()

  assert.equal(count(media.calls, 'dialog'), 0)
  assert.equal(count(media.calls, 'open'), 0)
})

test('microphone off → on while denied guides once, stays quiet while on, and guides again after off/on', async () => {
  const media = createMediaDeps({ microphone: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)

  lifecycle.observeVoiceRuntime({ microphoneActive: false })
  assert.equal(lifecycle.observeVoiceRuntime({ microphoneActive: true }), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)

  assert.equal(lifecycle.observeVoiceRuntime({ microphoneActive: true }), false)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)

  lifecycle.observeVoiceRuntime({ microphoneActive: false })
  assert.equal(lifecycle.observeVoiceRuntime({ microphoneActive: true }), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 2)
})

test('screen recording off → on while denied guides once, stays quiet while on, and guides again after off/on', async () => {
  const media = createMediaDeps({ screen: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)

  lifecycle.observeDesktopContext({ screenContextEnabled: false })
  assert.equal(lifecycle.observeDesktopContext({ screenContextEnabled: true }), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)

  assert.equal(lifecycle.observeDesktopContext({ screenContextEnabled: true }), false)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)

  lifecycle.observeDesktopContext({ screenContextEnabled: false })
  assert.equal(lifecycle.observeDesktopContext({ screenContextEnabled: true }), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 2)
})

test('Windows checks the microphone and never the camera', async () => {
  const media = createMediaDeps({
    microphone: 'denied',
    camera: 'denied',
  })

  const summary = await runWindowsPermissionChecks({
    microphone: true,
    interactive: false,
    delayMs: 0,
    deps: { ...media, platform: 'win32' },
  })

  assert.deepEqual(media.calls, [{ type: 'status', kind: 'microphone' }])
  assert.deepEqual(summary, { microphone: 'denied' })
})

test('Windows startup performs no media probe when voice state is unavailable', async () => {
  const media = createMediaDeps({
    microphone: 'denied',
    camera: 'denied',
  })
  const lifecycle = lifecycleFor('win32', media)

  const snapshot = await runStartupPermissionChecks({
    lifecycle,
    getDesktopContextFlags: () => ({ screenContextEnabled: true }),
    delayMs: 0,
  })

  assert.deepEqual(media.calls, [])
  assert.equal(snapshot.microphone, 'unknown')
  assert.equal(snapshot.screenRecording, 'unknown')
})

test('the voice-runtime sync marks speech, wake word, and continuous listening as mic features', () => {
  const base = {
    speechInputEnabled: false,
    speechInputProviderId: 'local-sensevoice',
    speechOutputEnabled: false,
    speechOutputProviderId: 'edge-tts',
    wakeWordEnabled: false,
    continuousVoiceModeEnabled: false,
    wakewordAlwaysOn: false,
  }

  assert.equal(buildVoiceRuntimeSyncPayload(base).microphoneActive, false)
  assert.equal(buildVoiceRuntimeSyncPayload({ ...base, speechInputEnabled: true }).microphoneActive, true)
  assert.equal(buildVoiceRuntimeSyncPayload({ ...base, wakeWordEnabled: true }).microphoneActive, true)
  assert.equal(buildVoiceRuntimeSyncPayload({ ...base, continuousVoiceModeEnabled: true }).microphoneActive, true)
  assert.equal(buildVoiceRuntimeSyncPayload({ ...base, wakewordAlwaysOn: true }).microphoneActive, true)
})

test('IPC permission modules share the module-level lifecycle singleton', () => {
  for (const file of ['../electron/ipc/voiceRuntimeIpc.js', '../electron/ipc/externalActionPolicyIpc.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /import \{ mediaPermissionLifecycle \} from '\.\.\/services\/mediaPermissionLifecycle\.js'/)
    assert.doesNotMatch(source, /createMediaPermissionLifecycle\s*\(/)
  }
})

test('main starts only the gated read-only permission check', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8')

  assert.match(main, /runStartupPermissionChecks\s*\(/)
  assert.match(main, /getDesktopContextFlags:\s*getSavedDesktopContextFlags/)
  assert.doesNotMatch(main, /runMacPermissionChecks\s*\(/)
  assert.doesNotMatch(main, /runWindowsPermissionChecks\s*\(/)
  assert.doesNotMatch(main, /ensureMacMicrophonePermission\s*\(/)
  assert.doesNotMatch(main, /ensureWindowsMicrophonePermission\s*\(/)
  assert.doesNotMatch(main, /askForMediaAccess\s*\(/)
  assert.doesNotMatch(main, /getMediaAccessStatus\s*\(/)
})
