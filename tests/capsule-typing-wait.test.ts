/**
 * A capsule the user scheduled still waits while they are typing.
 *
 * These tests drive the real `runFutureCapsuleTick` against a seeded capsule
 * store and a recording `window.desktopPet`, plus the pure typing gate with
 * fake time. They pin the product rule (wait until typing stops, five-minute
 * ceiling), the privacy rule (only a boolean is read, nothing is logged) and
 * the concurrency rule (an overlapping tick cannot deliver twice).
 */

import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'

import { routeDelivery } from '../shared/proactiveDelivery.js'
import type { DeliveryContext, ProactiveMessage } from '../shared/proactiveDelivery.js'
import {
  emptyProactiveEtiquetteState,
  saveProactiveEtiquetteState,
} from '../src/features/autonomy/proactiveEtiquette.ts'
import type { ProactiveEtiquetteState } from '../src/features/autonomy/proactiveEtiquette.ts'
import {
  DEFAULT_PROACTIVE_QUIET_END,
  DEFAULT_PROACTIVE_QUIET_START,
} from '../src/features/autonomy/proactiveBudget.ts'
import { noteDesktopTyping, noteUserTyping, clearDesktopTyping } from '../src/features/autonomy/userTyping.ts'
import { TYPING_QUIET_RESUME_MS } from '../shared/typingActivity.js'
import {
  CAPSULE_TYPING_MAX_WAIT_MS,
  waitForCapsuleTypingPause,
} from '../src/features/futureCapsule/capsuleTypingWait.ts'
import type {
  CapsuleTypingWaitReason,
  CapsuleTypingWaitResult,
} from '../src/features/futureCapsule/capsuleTypingWait.ts'
import { loadFutureCapsules } from '../src/features/futureCapsule/futureCapsuleStore.ts'
import type { FutureCapsuleRecord } from '../src/features/futureCapsule/futureCapsuleStore.ts'
import { runFutureCapsuleTick } from '../src/hooks/useFutureCapsuleScheduler.ts'
import { localDayKey } from '../src/lib/localDate.ts'
import { FUTURE_CAPSULE_STORE_STORAGE_KEY } from '../src/lib/storage/core.ts'
import type { AppSettings } from '../src/types/index.ts'

const NOW = new Date(2026, 4, 1, 12, 0, 0).getTime()
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const MAX_WAIT = 300_000

function makeSettings(patch: Partial<AppSettings> = {}): AppSettings {
  return {
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    proactiveQuietHoursStart: DEFAULT_PROACTIVE_QUIET_START,
    proactiveQuietHoursEnd: DEFAULT_PROACTIVE_QUIET_END,
    proactiveAwayNotificationsEnabled: true,
    contextAwarenessEnabled: false,
    activeWindowContextEnabled: false,
    companionAwarenessPaused: false,
    typingAwarenessEnabled: false,
    ...patch,
  } as unknown as AppSettings
}

function makeCapsule(id = 'capsule-typing'): FutureCapsuleRecord {
  return {
    id,
    message: 'Remember to breathe',
    createdAt: '2019-01-01T08:00:00.000Z',
    scheduledFor: '2020-01-01',
    status: 'pending',
  }
}

type DeliveryCall = { message: ProactiveMessage; context: DeliveryContext }

type TypingSeams = {
  readPermission?: () => unknown | Promise<unknown>
  isTyping?: () => boolean
}

type Deferred = { promise: Promise<void>; resolve: () => void }

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

interface InstallOptions {
  now?: number
  settings?: Partial<AppSettings>
  capsule?: FutureCapsuleRecord
  /** Raw `getDesktopTypingStatus` result; a function may throw. */
  typingStatus?: unknown | (() => unknown)
  /** Omit the method from the bridge entirely. */
  typingBridge?: boolean
  /** Fake clock instant where the aggregate typing signal stops. */
  typingUntil?: number
  /** Gate every fake sleep on this promise to overlap two ticks. */
  sleepGate?: Promise<void>
  /** Poll hook used to assert that nothing was delivered yet. */
  onSleep?: (clock: { time: number }, deliveries: DeliveryCall[]) => void
}

interface Environment {
  now: number
  clock: { time: number; typing: boolean }
  settings: AppSettings
  deliveries: DeliveryCall[]
  deliveryTimes: number[]
  bridgeCalls: string[]
  firstSleep: Promise<void>
  runTick: (isStopped?: () => boolean, seams?: TypingSeams) => Promise<void>
}

/**
 * Seed the capsule store and a recording preload bridge.
 *
 * The fake sleep advances a test clock, refreshes the aggregate desktop-typing
 * signal (so the real `isUserTypingAnywhere` path stays coherent) and only
 * then resolves, which keeps the production wiring under test.
 */
function installEnvironment(t: TestContext, options: InstallOptions = {}): Environment {
  const now = options.now ?? NOW
  const typingUntil = options.typingUntil ?? Number.POSITIVE_INFINITY
  const clock = { time: now, typing: now < typingUntil }
  const settings = makeSettings(options.settings)
  const capsule = options.capsule ?? makeCapsule()
  const store = new Map<string, string>([[FUTURE_CAPSULE_STORE_STORAGE_KEY, JSON.stringify([capsule])]])
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
  }

  const deliveries: DeliveryCall[] = []
  const deliveryTimes: number[] = []
  const bridgeCalls: string[] = []
  const typingStatus = options.typingStatus ?? { permission: 'granted' }
  const desktopPet: Record<string, unknown> = {
    deliverProactiveMessage: async (payload: DeliveryCall) => {
      deliveries.push(payload)
      deliveryTimes.push(clock.time)
      return routeDelivery(payload.message, payload.context)
    },
    showProactiveNotification: async () => undefined,
    getDesktopContext: async () => null,
  }
  if (options.typingBridge !== false) {
    desktopPet.getDesktopTypingStatus = async () => {
      bridgeCalls.push('getDesktopTypingStatus')
      return typeof typingStatus === 'function'
        ? (typingStatus as () => unknown)()
        : typingStatus
    }
  }

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage, desktopPet, dispatchEvent: () => true },
    configurable: true,
    writable: true,
  })

  const firstSleep = deferred()
  noteDesktopTyping(clock.typing, now)
  t.after(() => {
    clearDesktopTyping()
    noteUserTyping(0)
    Reflect.deleteProperty(globalThis, 'window')
  })

  const sleep = async (ms: number) => {
    clock.time += ms
    clock.typing = clock.time < typingUntil
    noteDesktopTyping(clock.typing, clock.time)
    options.onSleep?.(clock, deliveries)
    firstSleep.resolve()
    if (options.sleepGate) await options.sleepGate
  }

  return {
    now,
    clock,
    settings,
    deliveries,
    deliveryTimes,
    bridgeCalls,
    firstSleep: firstSleep.promise,
    runTick: (isStopped = () => false, seams = {}) => runFutureCapsuleTick({
      settings,
      now,
      typingWait: {
        sleep,
        now: () => clock.time,
        ...seams,
      },
    }, isStopped),
  }
}

interface WaitHarnessOptions {
  enabled?: boolean
  permission?: unknown | (() => unknown)
  typing?: (elapsedMs: number) => boolean
  stopped?: (elapsedMs: number) => boolean
  start?: number
  maxWaitMs?: number
  pollMs?: number
}

interface WaitHarness {
  result: Promise<CapsuleTypingWaitResult>
  now: () => number
  typingCalls: number[]
  permissionCalls: number[]
  sleeps: number[]
}

/** Pure fake-time harness for the typing gate itself. */
function createWaitHarness(options: WaitHarnessOptions = {}): WaitHarness {
  const start = options.start ?? NOW
  let time = start
  const typingCalls: number[] = []
  const permissionCalls: number[] = []
  const sleeps: number[] = []
  const permission = options.permission === undefined
    ? { permission: 'granted' }
    : options.permission
  const result = waitForCapsuleTypingPause({
    enabled: options.enabled ?? true,
    readPermission: () => {
      permissionCalls.push(time)
      return typeof permission === 'function' ? (permission as () => unknown)() : permission
    },
    isTyping: () => {
      typingCalls.push(time)
      return (options.typing ?? (() => true))(time - start)
    },
    sleep: async (ms) => {
      sleeps.push(ms)
      time += ms
    },
    now: () => time,
    isStopped: () => (options.stopped ?? (() => false))(time - start),
    ...(options.maxWaitMs === undefined ? {} : { maxWaitMs: options.maxWaitMs }),
    ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
  })
  return { result, now: () => time, typingCalls, permissionCalls, sleeps }
}

test('the typing wait budget is locked at five minutes', () => {
  assert.equal(CAPSULE_TYPING_MAX_WAIT_MS, 300_000)
  assert.equal(MAX_WAIT, 300_000)
})

function captureConsole(t: TestContext): string[][] {
  const calls: string[][] = []
  const target = console as unknown as Record<string, (...args: unknown[]) => void>
  const methods = ['log', 'info', 'warn', 'error', 'debug']
  const originals = methods.map((method) => target[method])
  for (const method of methods) {
    target[method] = (...args: unknown[]) => { calls.push(args.map((arg) => String(arg))) }
  }
  t.after(() => {
    methods.forEach((method, index) => { target[method] = originals[index]! })
  })
  return calls
}

test('a due capsule is not delivered while the user is typing', async (t) => {
  const env = installEnvironment(t, {
    settings: { typingAwarenessEnabled: true },
    typingUntil: Number.POSITIVE_INFINITY,
  })
  const stopAt = NOW + 2 * MINUTE
  const typingSnapshots: number[] = []

  await env.runTick(() => false, {
    isTyping: () => {
      typingSnapshots.push(env.deliveries.length)
      return env.clock.time < stopAt
    },
  })

  assert.ok(typingSnapshots.length >= 120, 'the gate polls roughly once a second')
  assert.deepEqual(
    typingSnapshots,
    typingSnapshots.map(() => 0),
    'nothing may be delivered during the two typing minutes',
  )
  assert.equal(env.deliveries.length, 1)
  assert.equal(env.deliveryTimes[0], stopAt, 'delivery happens only after the stop')
})

test('a capsule is delivered right after typing stops', async (t) => {
  const stopAt = NOW + 30_000
  const env = installEnvironment(t, {
    settings: { typingAwarenessEnabled: true },
    typingUntil: stopAt,
    onSleep: (clock, deliveries) => {
      if (clock.time < stopAt) {
        assert.equal(deliveries.length, 0, 'no delivery before typing stops')
      }
    },
  })

  await env.runTick()

  const graceEnd = stopAt + TYPING_QUIET_RESUME_MS
  assert.deepEqual(env.deliveryTimes, [graceEnd])
  assert.equal(env.deliveries[0]?.message.createdAt, graceEnd)
  assert.equal(loadFutureCapsules()[0]?.status, 'delivered')
})

test('typing cannot hold a capsule past the five-minute budget', async (t) => {
  const env = installEnvironment(t, {
    settings: { typingAwarenessEnabled: true },
    typingUntil: Number.POSITIVE_INFINITY,
    onSleep: (clock, deliveries) => {
      if (clock.time < NOW + MAX_WAIT) {
        assert.equal(deliveries.length, 0, 'no delivery before the budget')
      }
    },
  })

  await env.runTick()

  assert.deepEqual(env.deliveryTimes, [NOW + MAX_WAIT])
  assert.equal(env.deliveries[0]?.message.createdAt, NOW + MAX_WAIT)
})

test('the typing gate reports max_wait at the five-minute ceiling', async () => {
  const harness = createWaitHarness()

  assert.deepEqual(await harness.result, { waited: true, reason: 'max_wait' })
  assert.equal(harness.now() - NOW, MAX_WAIT)
  assert.equal(
    harness.sleeps.reduce((total, ms) => total + ms, 0),
    MAX_WAIT,
    'the gate never sleeps past the budget',
  )
})

test('the typing gate reports typing_stopped as soon as the boolean clears', async () => {
  const harness = createWaitHarness({ typing: (elapsed) => elapsed < 30_000 })

  assert.deepEqual(await harness.result, { waited: true, reason: 'typing_stopped' })
  assert.equal(harness.now() - NOW, 30_000)
})

test('the typing gate is idle without sleep when the user is not typing', async () => {
  const harness = createWaitHarness({ typing: () => false })

  assert.deepEqual(await harness.result, { waited: false, reason: 'not_typing' })
  assert.deepEqual(harness.sleeps, [])
})

test('the typing gate carries only the decision keys', async () => {
  const harnesses = [
    createWaitHarness({ enabled: false }),
    createWaitHarness({ permission: { permission: 'denied' } }),
    createWaitHarness({ typing: () => false }),
    createWaitHarness({ typing: (elapsed) => elapsed < 30_000 }),
    createWaitHarness(),
    createWaitHarness({ stopped: (elapsed) => elapsed >= 10_000 }),
  ]
  const reasons: CapsuleTypingWaitReason[] = []
  for (const harness of harnesses) {
    const result = await harness.result
    reasons.push(result.reason)
    assert.deepEqual(Object.keys(result).sort(), ['reason', 'waited'])
  }
  assert.deepEqual(reasons, [
    'signal_off',
    'denied',
    'not_typing',
    'typing_stopped',
    'max_wait',
    'stopped',
  ])
})

test('the typing gate reads nothing when the signal is off', async () => {
  const harness = createWaitHarness({ enabled: false, typing: () => true })

  assert.deepEqual(await harness.result, { waited: false, reason: 'signal_off' })
  assert.deepEqual(harness.permissionCalls, [], 'no permission read while off')
  assert.deepEqual(harness.typingCalls, [], 'no typing read while off')
  assert.deepEqual(harness.sleeps, [])
})

for (const scenario of [
  { name: 'denied', permission: { permission: 'denied' } as unknown },
  { name: 'unavailable', permission: { permission: 'unavailable' } as unknown },
  {
    name: 'throwing',
    permission: (() => { throw new Error('permission read failed') }) as unknown,
  },
  { name: 'garbled', permission: { permission: 'sometimes' } as unknown },
  { name: 'missing', permission: null as unknown },
]) {
  test(`a ${scenario.name} permission skips the wait without reading typing`, async () => {
    const harness = createWaitHarness({ permission: scenario.permission })

    assert.deepEqual(await harness.result, { waited: false, reason: 'denied' })
    assert.equal(harness.permissionCalls.length, 1)
    assert.deepEqual(harness.typingCalls, [], 'typing is never read without permission')
    assert.deepEqual(harness.sleeps, [])
  })
}

test('the typing signal being off delivers immediately without reading typing', async (t) => {
  const env = installEnvironment(t)
  let permissionCalls = 0
  let typingCalls = 0

  await env.runTick(() => false, {
    readPermission: () => {
      permissionCalls += 1
      return { permission: 'granted' }
    },
    isTyping: () => {
      typingCalls += 1
      return true
    },
  })

  assert.equal(permissionCalls, 0, 'the bridge is not asked while the setting is off')
  assert.equal(typingCalls, 0, 'neither the composer nor the desktop signal is read')
  assert.deepEqual(env.bridgeCalls, [], 'no typing-status call reached the bridge')
  assert.deepEqual(env.deliveryTimes, [NOW], 'the capsule is delivered immediately')
})

test('denied, unavailable, missing and garbled bridge statuses skip the wait', async (t) => {
  const scenarios = [
    { name: 'denied', status: { permission: 'denied' }, bridge: true },
    { name: 'unavailable', status: { permission: 'unavailable' }, bridge: true },
    {
      name: 'throwing',
      status: (() => { throw new Error('bridge failed') }) as unknown,
      bridge: true,
    },
    { name: 'garbled', status: { permission: 'sometimes' }, bridge: true },
    { name: 'missing', status: null, bridge: false },
  ]

  for (const scenario of scenarios) {
    const env = installEnvironment(t, {
      settings: { typingAwarenessEnabled: true },
      typingStatus: scenario.status,
      typingBridge: scenario.bridge,
    })
    let typingCalls = 0

    await env.runTick(() => false, {
      isTyping: () => {
        typingCalls += 1
        return true
      },
    })

    assert.equal(typingCalls, 0, `${scenario.name}: typing must not be read`)
    assert.deepEqual(env.deliveryTimes, [NOW], `${scenario.name}: no wait`)
    assert.equal(
      env.bridgeCalls.length,
      scenario.bridge ? 1 : 0,
      `${scenario.name}: the bridge is asked only when it exists`,
    )
  }
})

test('the typing wait writes nothing to the console', async (t) => {
  const calls = captureConsole(t)

  const typingEnv = installEnvironment(t, {
    settings: { typingAwarenessEnabled: true },
    typingUntil: NOW + 30_000,
  })
  await typingEnv.runTick()
  assert.equal(typingEnv.deliveries.length, 1)

  const maxEnv = installEnvironment(t, {
    settings: { typingAwarenessEnabled: true },
    typingUntil: Number.POSITIVE_INFINITY,
  })
  await maxEnv.runTick()
  assert.equal(maxEnv.deliveries.length, 1)

  const offEnv = installEnvironment(t)
  await offEnv.runTick()
  assert.equal(offEnv.deliveries.length, 1)

  assert.deepEqual(calls, [], 'a happy capsule tick adds no console output')
  for (const args of calls) {
    assert.equal(
      args.some((arg) => arg.toLowerCase().includes('typing')),
      false,
      'nothing may mention typing even on a surprising path',
    )
  }
})

test('a scheduler stopped during the wait leaves the capsule pending', async (t) => {
  const env = installEnvironment(t, {
    settings: { typingAwarenessEnabled: true },
    typingUntil: Number.POSITIVE_INFINITY,
  })

  await env.runTick(() => env.clock.time >= NOW + MINUTE)

  assert.deepEqual(env.deliveries, [])
  assert.equal(loadFutureCapsules()[0]?.status, 'pending')
})

test('an overlapping tick cannot deliver the capsule a second time', async (t) => {
  const gate = deferred()
  const env = installEnvironment(t, {
    settings: { typingAwarenessEnabled: true },
    typingUntil: Number.POSITIVE_INFINITY,
    sleepGate: gate.promise,
  })

  const first = env.runTick()
  await env.firstSleep
  // The first tick is now parked inside the typing wait with the capsule
  // still pending, exactly what the 5-minute interval overlap produces.
  const second = env.runTick()
  await second
  assert.deepEqual(env.deliveries, [], 'the overlapping tick must skip the in-flight capsule')

  noteDesktopTyping(false, env.clock.time)
  gate.resolve()
  await first

  assert.equal(env.deliveries.length, 1)
  assert.equal(env.deliveries[0]?.message.id, 'capsule:capsule-typing')
  assert.deepEqual(
    loadFutureCapsules().map((capsule) => capsule.status),
    ['delivered'],
  )
})

test('the typing wait does not re-enable the proactive pacing gate', async (t) => {
  const originalNow = Date.now
  Date.now = () => NOW
  t.after(() => { Date.now = originalNow })

  const stopAt = NOW + 30_000
  const env = installEnvironment(t, {
    settings: { typingAwarenessEnabled: true },
    typingUntil: stopAt,
  })
  const etiquette: ProactiveEtiquetteState = {
    ...emptyProactiveEtiquetteState(NOW),
    lastUserMessageAt: NOW - HOUR,
    budgetDay: localDayKey(NOW),
    budgetEntries: [
      { kind: 'open_loop', priority: 'normal', at: NOW - 3 * HOUR },
      { kind: 'bracket', priority: 'normal', at: NOW - 2 * HOUR },
      { kind: 'letter', priority: 'high', at: NOW - HOUR },
    ],
  }
  saveProactiveEtiquetteState(etiquette, NOW)

  await env.runTick()

  assert.deepEqual(env.deliveryTimes, [stopAt + TYPING_QUIET_RESUME_MS])
  assert.deepEqual(
    env.deliveries.map((delivery) => delivery.message.id),
    ['capsule:capsule-typing'],
  )
  assert.equal(loadFutureCapsules()[0]?.status, 'delivered')
})
