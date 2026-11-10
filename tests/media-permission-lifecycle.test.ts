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
const { buildExternalActionPolicySyncPayload } = await import('../src/features/integrations/externalActionPolicySync.ts')

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
    getDesktopContextFlags: () => ({ screenshot: false }),
    delayMs: 0,
  })

  assert.deepEqual(media.calls, [])
  assert.equal(snapshot.microphone, 'unknown')
  assert.equal(snapshot.screenRecording, 'unknown')
})

test('startup checks screen recording only when the combined screen result is on and never prompts', async () => {
  const media = createMediaDeps({ screen: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)

  const snapshot = await runStartupPermissionChecks({
    lifecycle,
    getDesktopContextFlags: () => ({ screenshot: true }),
    delayMs: 0,
  })

  assert.deepEqual(media.calls, [{ type: 'status', kind: 'screen' }])
  assert.equal(count(media.calls, 'dialog'), 0)
  assert.equal(count(media.calls, 'open'), 0)
  assert.equal(snapshot.screenRecording, 'denied')
})

test('master off with the screen sub-switch on is not a startup screen check', async () => {
  const media = createMediaDeps({ screen: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)
  const combined = buildExternalActionPolicySyncPayload({
    contextAwarenessEnabled: false,
    screenContextEnabled: true,
    settingsRevision: 1,
  } as never).desktopContext.screenshot

  await runStartupPermissionChecks({
    lifecycle,
    getDesktopContextFlags: () => ({ screenshot: combined }),
    delayMs: 0,
  })

  assert.deepEqual(media.calls, [])
})

test('the first voice sync is a global baseline: two startup windows on never prompt', async () => {
  const media = createMediaDeps({ microphone: 'not-determined' })
  const lifecycle = lifecycleFor('darwin', media)

  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 7, microphoneActive: true }), false)
  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 7, microphoneActive: true }), false)
  await flush()

  assert.equal(count(media.calls, 'ask'), 0)
  assert.equal(count(media.calls, 'dialog'), 0)
})

test('the first screen-context sync is baseline and a denied startup never re-nags', async () => {
  const media = createMediaDeps({ screen: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)

  assert.equal(lifecycle.observeDesktopContext({ settingsRevision: 3, screenshot: true }), false)
  assert.equal(lifecycle.observeDesktopContext({ settingsRevision: 3, screenshot: true }), false)
  await flush()

  assert.equal(count(media.calls, 'dialog'), 0)
  assert.equal(count(media.calls, 'open'), 0)
})

test('microphone off → on while denied guides once, stays quiet while on, and guides again after off/on', async () => {
  const media = createMediaDeps({ microphone: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)

  lifecycle.observeVoiceRuntime({ settingsRevision: 1, microphoneActive: false })
  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 2, microphoneActive: true }), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)

  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 2, microphoneActive: true }), false)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)

  lifecycle.observeVoiceRuntime({ settingsRevision: 3, microphoneActive: false })
  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 4, microphoneActive: true }), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 2)
})

test('screen recording off → on while denied guides once, stays quiet while on, and guides again after off/on', async () => {
  const media = createMediaDeps({ screen: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)

  lifecycle.observeDesktopContext({ settingsRevision: 1, screenshot: false })
  assert.equal(lifecycle.observeDesktopContext({ settingsRevision: 2, screenshot: true }), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)

  assert.equal(lifecycle.observeDesktopContext({ settingsRevision: 2, screenshot: true }), false)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)

  lifecycle.observeDesktopContext({ settingsRevision: 3, screenshot: false })
  assert.equal(lifecycle.observeDesktopContext({ settingsRevision: 4, screenshot: true }), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 2)
})

test('interleaved stale false from one window does not add another guide', async () => {
  const media = createMediaDeps({ microphone: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)

  lifecycle.observeVoiceRuntime({ settingsRevision: 1, microphoneActive: false })
  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 3, microphoneActive: true }), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)

  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 2, microphoneActive: false }), false)
  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 2, microphoneActive: false }), false)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)
})

test('a destroyed window cannot suppress the next real off → on guide', async () => {
  const media = createMediaDeps({ microphone: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)

  lifecycle.observeVoiceRuntime({ settingsRevision: 2, microphoneActive: true })
  await flush()
  assert.equal(count(media.calls, 'dialog'), 0)

  lifecycle.observeVoiceRuntime({ settingsRevision: 3, microphoneActive: false })
  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 4, microphoneActive: true }), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)
})

test('panel false then true while the pet stays silent is one real off → on guide', async () => {
  const media = createMediaDeps({ microphone: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)

  lifecycle.observeVoiceRuntime({ settingsRevision: 1, microphoneActive: true })
  await flush()
  assert.equal(count(media.calls, 'dialog'), 0)

  lifecycle.observeVoiceRuntime({ settingsRevision: 2, microphoneActive: false })
  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 3, microphoneActive: true }), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)
})

test('only wake word on is still a microphone off → on guide', async () => {
  const media = createMediaDeps({ microphone: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)
  const base = {
    speechInputEnabled: false,
    speechInputProviderId: 'local-sensevoice',
    speechOutputEnabled: false,
    speechOutputProviderId: 'edge-tts',
    wakeWordEnabled: true,
    continuousVoiceModeEnabled: false,
    wakewordAlwaysOn: false,
    settingsRevision: 2,
  }

  lifecycle.observeVoiceRuntime({ settingsRevision: 1, microphoneActive: false })
  assert.equal(lifecycle.observeVoiceRuntime(buildVoiceRuntimeSyncPayload(base)), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)
})

test('always-on wake word enabled at startup with mic denied never prompts or guides', async () => {
  const media = createMediaDeps({ microphone: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)
  const payload = buildVoiceRuntimeSyncPayload({
    speechInputEnabled: false,
    speechInputProviderId: 'local-sensevoice',
    speechOutputEnabled: false,
    speechOutputProviderId: 'edge-tts',
    wakeWordEnabled: true,
    continuousVoiceModeEnabled: false,
    wakewordAlwaysOn: true,
    settingsRevision: 6,
  })

  assert.equal(lifecycle.observeVoiceRuntime(payload), false)
  await flush()

  assert.equal(count(media.calls, 'ask'), 0)
  assert.equal(count(media.calls, 'dialog'), 0)
})

test('master off → on with the screen sub-switch already on guides once when denied', async () => {
  const media = createMediaDeps({ screen: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)
  const off = buildExternalActionPolicySyncPayload({
    contextAwarenessEnabled: false,
    screenContextEnabled: true,
    settingsRevision: 1,
  } as never).desktopContext.screenshot
  const on = buildExternalActionPolicySyncPayload({
    contextAwarenessEnabled: true,
    screenContextEnabled: true,
    settingsRevision: 2,
  } as never).desktopContext.screenshot

  lifecycle.observeDesktopContext({ settingsRevision: 1, screenshot: off })
  assert.equal(lifecycle.observeDesktopContext({ settingsRevision: 2, screenshot: on }), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)
})

test('same-revision microphone changes update value without an edge; only a revision increase guides', async () => {
  const media = createMediaDeps({ microphone: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)

  lifecycle.observeVoiceRuntime({ settingsRevision: 1, microphoneActive: false })
  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 1, microphoneActive: true }), false)
  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 2, microphoneActive: true }), false)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 0)

  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 2, microphoneActive: false }), false)
  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 2, microphoneActive: true }), false)
  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 3, microphoneActive: true }), false)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 0)

  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 4, microphoneActive: false }), false)
  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 5, microphoneActive: true }), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)

  // An older revision cannot move the state back.
  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 4, microphoneActive: false }), false)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)
})

test('same-revision screen changes update value without an edge; only a revision increase guides', async () => {
  const media = createMediaDeps({ screen: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)

  lifecycle.observeDesktopContext({ settingsRevision: 1, screenshot: false })
  assert.equal(lifecycle.observeDesktopContext({ settingsRevision: 1, screenshot: true }), false)
  assert.equal(lifecycle.observeDesktopContext({ settingsRevision: 2, screenshot: true }), false)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 0)

  assert.equal(lifecycle.observeDesktopContext({ settingsRevision: 2, screenshot: false }), false)
  assert.equal(lifecycle.observeDesktopContext({ settingsRevision: 2, screenshot: true }), false)
  assert.equal(lifecycle.observeDesktopContext({ settingsRevision: 3, screenshot: true }), false)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 0)

  assert.equal(lifecycle.observeDesktopContext({ settingsRevision: 4, screenshot: false }), false)
  assert.equal(lifecycle.observeDesktopContext({ settingsRevision: 5, screenshot: true }), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)

  assert.equal(lifecycle.observeDesktopContext({ settingsRevision: 4, screenshot: false }), false)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)
})

test('panel false survives a pet re-commit carrying the old revision', async () => {
  const media = createMediaDeps({ microphone: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)

  lifecycle.observeVoiceRuntime({ settingsRevision: 1, microphoneActive: true })
  await flush()
  assert.equal(count(media.calls, 'dialog'), 0)

  lifecycle.observeVoiceRuntime({ settingsRevision: 3, microphoneActive: false })
  // Pet re-commits its old true snapshot with revision 2.
  lifecycle.observeVoiceRuntime({ settingsRevision: 2, microphoneActive: true })
  await flush()
  assert.equal(count(media.calls, 'dialog'), 0)

  // A fresh true proves main still ended at false.
  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 4, microphoneActive: true }), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)
})

test('legacy settings without a revision use the first sync as baseline', async () => {
  const media = createMediaDeps({ microphone: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)

  assert.equal(lifecycle.observeVoiceRuntime({ microphoneActive: true }), false)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 0)

  assert.equal(lifecycle.observeVoiceRuntime({ microphoneActive: false }), false)
  // Same-revision changes are still not edges; the first revision increase is.
  assert.equal(lifecycle.observeVoiceRuntime({ microphoneActive: true }), false)
  assert.equal(lifecycle.observeVoiceRuntime({ microphoneActive: false }), false)
  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 1, microphoneActive: true }), true)
  await flush()
  assert.equal(count(media.calls, 'dialog'), 1)
})

test('media-permission:status only inspects enabled features and logs only state changes', async (t) => {
  const media = createMediaDeps({ microphone: 'denied', screen: 'denied' })
  const lifecycle = lifecycleFor('darwin', media)
  const info = t.mock.method(console, 'info', () => undefined)

  const off = await lifecycle.inspectReadOnly({ microphone: false, screenContextActive: false })
  assert.deepEqual(media.calls, [])
  assert.equal(off.microphone, 'unknown')
  assert.equal(off.screenRecording, 'unknown')
  assert.equal(info.mock.callCount(), 0)

  await lifecycle.inspectReadOnly({ microphone: true, screenContextActive: false })
  assert.deepEqual(media.calls, [{ type: 'status', kind: 'microphone' }])
  assert.equal(info.mock.callCount(), 1)

  await lifecycle.inspectReadOnly({ microphone: true, screenContextActive: false })
  await lifecycle.inspectReadOnly({ microphone: true, screenContextActive: false })
  assert.deepEqual(media.calls, [
    { type: 'status', kind: 'microphone' },
    { type: 'status', kind: 'microphone' },
    { type: 'status', kind: 'microphone' },
  ])
  assert.equal(info.mock.callCount(), 1)

  await lifecycle.inspectReadOnly({ microphone: false, screenContextActive: true })
  await lifecycle.inspectReadOnly({ microphone: false, screenContextActive: true })
  assert.deepEqual(media.calls, [
    { type: 'status', kind: 'microphone' },
    { type: 'status', kind: 'microphone' },
    { type: 'status', kind: 'microphone' },
    { type: 'status', kind: 'screen' },
    { type: 'status', kind: 'screen' },
  ])
  assert.equal(info.mock.callCount(), 2)
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
    getDesktopContextFlags: () => ({ screenshot: true }),
    delayMs: 0,
  })

  assert.deepEqual(media.calls, [])
  assert.equal(snapshot.microphone, 'unknown')
  assert.equal(snapshot.screenRecording, 'unknown')
})

test('the voice-runtime sync marks speech, wake word, continuous listening, and revision', () => {
  const base = {
    speechInputEnabled: false,
    speechInputProviderId: 'local-sensevoice',
    speechOutputEnabled: false,
    speechOutputProviderId: 'edge-tts',
    wakeWordEnabled: false,
    continuousVoiceModeEnabled: false,
    wakewordAlwaysOn: false,
    settingsRevision: 9,
  }

  assert.equal(buildVoiceRuntimeSyncPayload(base).microphoneActive, false)
  assert.equal(buildVoiceRuntimeSyncPayload({ ...base, speechInputEnabled: true }).microphoneActive, true)
  assert.equal(buildVoiceRuntimeSyncPayload({ ...base, wakeWordEnabled: true }).microphoneActive, true)
  assert.equal(buildVoiceRuntimeSyncPayload({ ...base, continuousVoiceModeEnabled: true }).microphoneActive, true)
  assert.equal(buildVoiceRuntimeSyncPayload({ ...base, wakewordAlwaysOn: true }).microphoneActive, true)
  assert.equal(buildVoiceRuntimeSyncPayload(base).settingsRevision, 9)
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
