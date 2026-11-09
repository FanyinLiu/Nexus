import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { createHookRenderer } = await import('./helpers/directNotificationHookHarness.ts')
const {
  nextReminderWakeToken,
  runtimeHeartbeatIntervalMs,
  shouldApplyHeartbeatSnapshot,
  useRuntimeHeartbeat,
  useRuntimeStateBridge,
} = await import('../src/app/controllers/useDesktopBridge.ts')
const { shouldRunReminderScheduler } = await import('../src/features/reminders/runtime.ts')

type RuntimeSnapshot = { petOnline: boolean; panelOnline: boolean }

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function installHeartbeatWindow(initial: RuntimeSnapshot) {
  const beats: string[] = []
  let snapshot = initial
  let intervalMs = 0
  let intervalCallback = () => {}
  const windowStub = {
    desktopPet: {
      heartbeatRuntimeState: ({ view }: { view: string }) => {
        beats.push(view)
        return Promise.resolve(snapshot)
      },
    },
    setInterval: (callback: () => void, ms: number) => {
      intervalMs = ms
      intervalCallback = callback
      return 1
    },
    clearInterval: () => undefined,
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowStub })
  return {
    beats,
    setSnapshot: (next: RuntimeSnapshot) => { snapshot = next },
    getIntervalMs: () => intervalMs,
    runInterval: () => intervalCallback(),
    cleanup: () => { Reflect.deleteProperty(globalThis, 'window') },
  }
}

test('panel applies its own heartbeat snapshot and hands the scheduler over when the pet goes offline', async () => {
  const environment = installHeartbeatWindow({ petOnline: true, panelOnline: true })
  let applied: RuntimeSnapshot | null = null
  const renderer = createHookRenderer(() => useRuntimeHeartbeat('panel', (value) => {
    applied = typeof value === 'function'
      ? value(applied) as RuntimeSnapshot
      : value as RuntimeSnapshot
  }))
  try {
    renderer.render(undefined)
    await flushAsync()

    assert.deepEqual(environment.beats, ['panel'])
    assert.equal(environment.getIntervalMs(), runtimeHeartbeatIntervalMs('panel'))
    assert.equal(runtimeHeartbeatIntervalMs('panel'), 4_000)
    assert.equal(shouldApplyHeartbeatSnapshot('panel'), true)
    assert.equal(applied?.petOnline, true)
    assert.equal(shouldRunReminderScheduler('panel', applied!), false)
    assert.equal(shouldRunReminderScheduler('pet', applied!), true)

    environment.setSnapshot({ petOnline: false, panelOnline: true })
    environment.runInterval()
    await flushAsync()

    assert.equal(applied?.petOnline, false, 'the heartbeat snapshot reached local state')
    assert.equal(shouldRunReminderScheduler('panel', applied!), true, 'the panel takes over')
  } finally {
    renderer.unmount()
    environment.cleanup()
  }
})

test('pet beats at the slow interval and does not apply its own heartbeat snapshot', async () => {
  const environment = installHeartbeatWindow({ petOnline: true, panelOnline: true })
  let applied: RuntimeSnapshot | null = null
  const renderer = createHookRenderer(() => useRuntimeHeartbeat('pet', (value) => {
    applied = typeof value === 'function'
      ? value(applied) as RuntimeSnapshot
      : value as RuntimeSnapshot
  }))
  try {
    renderer.render(undefined)
    await flushAsync()

    assert.deepEqual(environment.beats, ['pet'])
    assert.equal(environment.getIntervalMs(), runtimeHeartbeatIntervalMs('pet'))
    assert.equal(runtimeHeartbeatIntervalMs('pet'), 10_000)
    assert.equal(shouldApplyHeartbeatSnapshot('pet'), false)
    assert.equal(applied, null)
    assert.equal(shouldRunReminderScheduler('pet', { petOnline: false, panelOnline: false }), true)
  } finally {
    renderer.unmount()
    environment.cleanup()
  }
})

test('an offline runtime snapshot bumps the panel wake token only', () => {
  assert.equal(nextReminderWakeToken('panel', { mood: 'idle', petOnline: false }, 0), 1)
  assert.equal(nextReminderWakeToken('panel', { mood: 'idle', petOnline: false }, 4), 5)
  assert.equal(nextReminderWakeToken('panel', { mood: 'idle', petOnline: true }, 4), 4)
  assert.equal(nextReminderWakeToken('pet', { mood: 'idle', petOnline: false }, 4), 4)
})

test('runtime-state subscription applies snapshots and bumps the panel wake token', async () => {
  let listener: ((state: RuntimeSnapshot & Record<string, unknown>) => void) | null = null
  let unsubscribed = false
  const initial = { mood: 'idle', petOnline: true, petLastSeenAt: '2026-01-01T00:00:00.000Z' }
  const windowStub = {
    desktopPet: {
      getRuntimeState: () => Promise.resolve(initial),
      subscribeRuntimeState: (callback: (state: RuntimeSnapshot & Record<string, unknown>) => void) => {
        listener = callback
        return () => { unsubscribed = true }
      },
    },
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowStub })

  let snapshot: RuntimeSnapshot | null = null
  let mood: string | null = null
  let continuousVoiceActive = false
  let panelSettingsOpen = false
  const applyRemoteMood = (value: string) => { mood = value }
  const renderer = createHookRenderer(() => useRuntimeStateBridge({
    view: 'panel',
    applyRemoteMood,
    setRuntimeSnapshotState: (value) => {
      snapshot = typeof value === 'function' ? value(snapshot) as RuntimeSnapshot : value as RuntimeSnapshot
    },
    setPetRuntimeContinuousVoiceActive: (value) => {
      continuousVoiceActive = typeof value === 'function' ? Boolean(value(continuousVoiceActive)) : Boolean(value)
    },
    setRemotePanelSettingsOpen: (value) => {
      panelSettingsOpen = typeof value === 'function' ? Boolean(value(panelSettingsOpen)) : Boolean(value)
    },
  }))
  try {
    assert.equal(renderer.render(undefined), 0)
    await flushAsync()
    assert.equal(snapshot?.petOnline, true)
    assert.ok(listener, 'the panel subscribes to runtime snapshots')

    listener!({
      mood: 'concerned',
      petOnline: false,
      petLastSeenAt: '2026-01-01T00:00:10.000Z',
      continuousVoiceActive: true,
      panelSettingsOpen: true,
    })
    assert.equal(renderer.render(undefined), 1, 'an offline snapshot wakes the scheduler')
    assert.equal(snapshot?.petOnline, false)
    assert.equal(snapshot?.petLastSeenAt, '2026-01-01T00:00:10.000Z')
    assert.equal(mood, 'concerned')
    assert.equal(continuousVoiceActive, true)
    assert.equal(panelSettingsOpen, true)

    listener!({
      mood: 'idle',
      petOnline: true,
      petLastSeenAt: '2026-01-01T00:00:20.000Z',
    })
    assert.equal(renderer.render(undefined), 1, 'an online snapshot only stops scheduling')
    assert.equal(snapshot?.petOnline, true)
  } finally {
    renderer.unmount()
    assert.equal(unsubscribed, true, 'unmount removes the runtime-state subscription')
    Reflect.deleteProperty(globalThis, 'window')
  }
})
