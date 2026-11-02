/**
 * A future-self capsule is user-scheduled content, so the scheduler must not
 * ask the proactive-etiquette gate whether it may arrive. These tests drive
 * the real `useFutureCapsuleScheduler` tick (not only `deliverDueCapsule`) with
 * a seeded shared ledger: budget, back-off, silence stop and repeat rules all
 * say "no" to an ordinary line while the capsule is still delivered.
 */

import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'

import React from 'react'

import { routeDelivery } from '../shared/proactiveDelivery.js'
import type { DeliveryContext, ProactiveMessage } from '../shared/proactiveDelivery.js'
import {
  admitProactiveMessage,
  emptyProactiveEtiquetteState,
  evaluateProactiveMessage,
  isTooSimilar,
  loadProactiveEtiquetteState,
  saveProactiveEtiquetteState,
} from '../src/features/autonomy/proactiveEtiquette.ts'
import type {
  ProactiveEtiquetteRequest,
  ProactiveEtiquetteState,
} from '../src/features/autonomy/proactiveEtiquette.ts'
import {
  DEFAULT_PROACTIVE_QUIET_END,
  DEFAULT_PROACTIVE_QUIET_START,
  PROACTIVE_MIN_GAP_MS,
} from '../src/features/autonomy/proactiveBudget.ts'
import {
  loadFutureCapsules,
} from '../src/features/futureCapsule/futureCapsuleStore.ts'
import type { FutureCapsuleRecord } from '../src/features/futureCapsule/futureCapsuleStore.ts'
import { useFutureCapsuleScheduler } from '../src/hooks/useFutureCapsuleScheduler.ts'
import { localDayKey } from '../src/lib/localDate.ts'
import {
  FUTURE_CAPSULE_STORE_STORAGE_KEY,
} from '../src/lib/storage/core.ts'
import type { AppSettings, FocusState } from '../src/types/index.ts'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// Fixed local clock keeps the tests independent of the machine's wall clock.
const NOW = new Date(2026, 4, 1, 12, 0, 0).getTime()
const QUIET_NOW = new Date(2026, 4, 1, 2, 0, 0).getTime()

type HookProps = Parameters<typeof useFutureCapsuleScheduler>[0]

type DeliveryCall = {
  message: ProactiveMessage
  context: DeliveryContext
}

type NotificationCall = {
  title: string
  body: string
}

type LocalStorageMock = ReturnType<typeof createLocalStorageMock>

type Environment = {
  deliveries: DeliveryCall[]
  notifications: NotificationCall[]
  clock: { now: number }
  localStorage: LocalStorageMock
  settings: AppSettings
}

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = {
  deps?: readonly unknown[]
  callback?: () => void | (() => void)
  cleanup?: () => void
  run?: boolean
}

function depsChanged(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
  if (!previous || !next) return true
  return previous.length !== next.length || next.some((dep, index) => !Object.is(dep, previous[index]))
}

/** Minimal hook table: the scheduler only uses refs and effects. */
function createHookRenderer<P>(hookFn: (props: P) => void) {
  const slots: unknown[] = []
  const effects: EffectSlot[] = []
  let cursor = 0

  const dispatcher = {
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++
      const previous = effects[index]
      if (depsChanged(previous?.deps, deps)) {
        effects[index] = { deps, callback, run: true }
      }
    },
  }

  function render(props: P): void {
    cursor = 0
    reactInternals.H = dispatcher
    try {
      hookFn(props)
    } finally {
      reactInternals.H = null
    }
    for (const slot of effects) {
      if (!slot?.run) continue
      slot.run = false
      slot.cleanup?.()
      const cleanup = slot.callback?.()
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
  }

  function unmount(): void {
    for (const slot of effects) slot?.cleanup?.()
  }

  return { render, unmount }
}

function createLocalStorageMock(): {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
} {
  const store = new Map<string, string>()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
  }
}

function makeSettings(patch: Partial<AppSettings> = {}): AppSettings {
  return {
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    proactiveFrequency: 'normal',
    proactiveQuietHoursStart: DEFAULT_PROACTIVE_QUIET_START,
    proactiveQuietHoursEnd: DEFAULT_PROACTIVE_QUIET_END,
    proactiveAwayNotificationsEnabled: true,
    contextAwarenessEnabled: false,
    activeWindowContextEnabled: false,
    companionAwarenessPaused: false,
    ...patch,
  } as unknown as AppSettings
}

function makeCapsule(id: string, message: string): FutureCapsuleRecord {
  // A fixed past date keeps `findDueCapsule` independent of the wall clock.
  return {
    id,
    message,
    createdAt: '2019-01-01T08:00:00.000Z',
    scheduledFor: '2020-01-01',
    status: 'pending',
  }
}

function seedCapsules(localStorage: LocalStorageMock, capsules: FutureCapsuleRecord[]): void {
  localStorage.setItem(FUTURE_CAPSULE_STORE_STORAGE_KEY, JSON.stringify(capsules))
}

function seedEtiquette(state: ProactiveEtiquetteState): void {
  saveProactiveEtiquetteState(state)
}

function etiquetteState(patch: Partial<ProactiveEtiquetteState> = {}): ProactiveEtiquetteState {
  return { ...emptyProactiveEtiquetteState(NOW), ...patch }
}

function normalRequest(nowMs = NOW, text = 'send the quarterly report'): ProactiveEtiquetteRequest {
  return {
    nowMs,
    kind: 'open_loop',
    text,
    preset: 'normal',
    enabled: true,
    quietStart: DEFAULT_PROACTIVE_QUIET_START,
    quietEnd: DEFAULT_PROACTIVE_QUIET_END,
    focusState: 'active',
    channel: 'next_turn',
  }
}

function normalAdmissionReason(nowMs = NOW, text?: string): string {
  return evaluateProactiveMessage(
    normalRequest(nowMs, text),
    loadProactiveEtiquetteState(nowMs),
  ).reason
}

function installEnvironment(
  t: TestContext,
  options: {
    now: number
    settings?: Partial<AppSettings>
    desktopContext?: Record<string, unknown> | null
  },
): Environment {
  const clock = { now: options.now }
  const originalNow = Date.now
  Date.now = () => clock.now
  t.after(() => { Date.now = originalNow })

  const localStorage = createLocalStorageMock()
  const deliveries: DeliveryCall[] = []
  const notifications: NotificationCall[] = []
  const desktopPet = {
    showProactiveNotification: async (payload: NotificationCall) => {
      notifications.push(payload)
    },
    deliverProactiveMessage: async (payload: DeliveryCall) => {
      deliveries.push(payload)
      return routeDelivery(payload.message, payload.context)
    },
    getDesktopContext: async () => options.desktopContext ?? null,
  }

  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      setInterval: () => 0,
      clearInterval: () => undefined,
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      desktopPet,
    },
    configurable: true,
    writable: true,
  })
  t.after(() => { Reflect.deleteProperty(globalThis, 'window') })

  return {
    deliveries,
    notifications,
    clock,
    localStorage,
    settings: makeSettings(options.settings),
  }
}

async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

async function runCapsuleTick(
  env: Environment,
  overrides: Partial<Omit<HookProps, 'settings'>> = {},
): Promise<void> {
  const renderer = createHookRenderer<HookProps>(useFutureCapsuleScheduler)
  renderer.render({
    settings: env.settings,
    enabled: true,
    focusState: 'active',
    ...overrides,
  })
  await flushAsync()
  renderer.unmount()
}

function deliveredIds(env: Environment): string[] {
  return env.deliveries.map((delivery) => delivery.message.id)
}

test('an exhausted shared daily budget does not hold a due capsule back', async (t) => {
  const env = installEnvironment(t, { now: NOW })
  seedEtiquette(etiquetteState({
    lastUserMessageAt: NOW - HOUR,
    budgetDay: localDayKey(NOW),
    budgetEntries: [
      { kind: 'open_loop', priority: 'normal', at: NOW - 3 * HOUR },
      { kind: 'bracket', priority: 'normal', at: NOW - 2 * HOUR },
      { kind: 'letter', priority: 'high', at: NOW - HOUR },
    ],
  }))
  seedCapsules(env.localStorage, [makeCapsule('capsule-budget', 'Remember to breathe')])

  assert.equal(normalAdmissionReason(), 'daily-budget')

  await runCapsuleTick(env)

  assert.deepEqual(deliveredIds(env), ['capsule:capsule-budget'])
  assert.equal(loadFutureCapsules()[0]?.status, 'delivered')
})

test('the 90-minute back-off does not hold a due capsule back', async (t) => {
  const env = installEnvironment(t, { now: NOW })
  seedEtiquette(etiquetteState({
    lastUserMessageAt: NOW - 2 * DAY,
    lastProactiveAt: NOW - 60_000,
    ignoredStreak: 2,
  }))
  seedCapsules(env.localStorage, [makeCapsule('capsule-backoff', 'Remember to breathe')])

  assert.equal(normalAdmissionReason(), 'backoff')
  assert.ok(PROACTIVE_MIN_GAP_MS > 60_000)

  await runCapsuleTick(env)

  assert.deepEqual(deliveredIds(env), ['capsule:capsule-backoff'])
  assert.equal(loadFutureCapsules()[0]?.status, 'delivered')
})

test('the 7-day silence stop does not hold a due capsule back', async (t) => {
  const env = installEnvironment(t, { now: NOW })
  seedEtiquette(etiquetteState({
    lastUserMessageAt: NOW - 8 * DAY,
    lastProactiveAt: NOW - HOUR,
    ignoredStreak: 2,
  }))
  seedCapsules(env.localStorage, [makeCapsule('capsule-silence', 'Remember to breathe')])

  assert.equal(normalAdmissionReason(), 'long-silence')

  await runCapsuleTick(env)

  assert.deepEqual(deliveredIds(env), ['capsule:capsule-silence'])
  assert.equal(loadFutureCapsules()[0]?.status, 'delivered')
})

test('near-identical capsules both arrive even though the repeat check would object', async (t) => {
  const env = installEnvironment(t, { now: NOW })
  seedCapsules(env.localStorage, [
    makeCapsule('capsule-repeat-a', 'Remember to breathe'),
    makeCapsule('capsule-repeat-b', 'Remember to breathe.'),
  ])

  await runCapsuleTick(env)
  await runCapsuleTick(env)

  assert.deepEqual(deliveredIds(env), [
    'capsule:capsule-repeat-a',
    'capsule:capsule-repeat-b',
  ])
  const first = env.deliveries[0]?.message
  const second = env.deliveries[1]?.message
  assert.ok(first && second)
  assert.equal(first.title, second.title)
  assert.equal(
    isTooSimilar(`${second.title} ${second.body}`, [`${first.title} ${first.body}`]),
    true,
    'the second copy is similar enough that the shared repeat check would refuse it',
  )
  assert.deepEqual(
    loadFutureCapsules().map((capsule) => capsule.status),
    ['delivered', 'delivered'],
  )
})

test('the same capsule id is delivered once across consecutive ticks', async (t) => {
  const env = installEnvironment(t, { now: NOW })
  seedCapsules(env.localStorage, [makeCapsule('capsule-once', 'Remember to breathe')])

  await runCapsuleTick(env)
  await runCapsuleTick(env)

  assert.deepEqual(deliveredIds(env), ['capsule:capsule-once'])
  assert.equal(loadFutureCapsules()[0]?.status, 'delivered')
})

test('a capsule delivery leaves the shared ledger untouched', async (t) => {
  const env = installEnvironment(t, { now: NOW })
  const seeded = etiquetteState({
    lastUserMessageAt: NOW - HOUR,
    lastProactiveAt: NOW - 3 * HOUR,
    ignoredStreak: 1,
    budgetDay: localDayKey(NOW),
    budgetEntries: [
      { kind: 'bracket', priority: 'normal', at: NOW - 3 * HOUR },
    ],
    recentProactive: [{ text: 'the morning bracket line', at: NOW - 3 * HOUR }],
  })
  seedEtiquette(seeded)
  seedCapsules(env.localStorage, [makeCapsule('capsule-ledger', 'Remember to breathe')])

  const before = loadProactiveEtiquetteState(NOW)

  await runCapsuleTick(env)

  const after = loadProactiveEtiquetteState(NOW)
  assert.deepEqual(after.budgetEntries, before.budgetEntries)
  assert.deepEqual(after.recentProactive, before.recentProactive)
  assert.equal(after.lastProactiveAt, before.lastProactiveAt)
  assert.equal(after.ignoredStreak, before.ignoredStreak)

  const normal = admitProactiveMessage(normalRequest())
  assert.equal(normal.allow, true, 'the next ordinary line still has its slot')
})

test('quiet hours still route a capsule to the inbox and badge, not a popup', async (t) => {
  const env = installEnvironment(t, { now: QUIET_NOW })
  seedCapsules(env.localStorage, [makeCapsule('capsule-quiet', 'Remember to breathe')])

  await runCapsuleTick(env)

  const delivery = env.deliveries[0]
  assert.ok(delivery)
  assert.equal(delivery.context.inQuietHours, true)
  assert.equal(delivery.context.fullscreen, false)
  assert.deepEqual(routeDelivery(delivery.message, delivery.context), {
    rule: 1,
    outlets: ['inbox', 'badge'],
  })
  assert.deepEqual(env.notifications, [])
})

test('fullscreen still routes a capsule to the inbox and badge, not a popup', async (t) => {
  const env = installEnvironment(t, {
    now: NOW,
    settings: {
      contextAwarenessEnabled: true,
      activeWindowContextEnabled: true,
    },
    desktopContext: {
      activeWindowTitle: 'Fullscreen video',
      activeWindowAppName: 'Safari',
    },
  })
  seedCapsules(env.localStorage, [makeCapsule('capsule-fullscreen', 'Remember to breathe')])

  await runCapsuleTick(env)

  const delivery = env.deliveries[0]
  assert.ok(delivery)
  assert.equal(delivery.context.fullscreen, true)
  assert.deepEqual(routeDelivery(delivery.message, delivery.context), {
    rule: 1,
    outlets: ['inbox', 'badge'],
  })
  assert.deepEqual(env.notifications, [])
})

test('locked focus still routes a capsule to the inbox and badge', async (t) => {
  const env = installEnvironment(t, { now: NOW })
  seedCapsules(env.localStorage, [makeCapsule('capsule-locked', 'Remember to breathe')])

  await runCapsuleTick(env, { focusState: 'locked' satisfies FocusState })

  const delivery = env.deliveries[0]
  assert.ok(delivery)
  assert.equal(delivery.context.focusState, 'locked')
  assert.deepEqual(routeDelivery(delivery.message, delivery.context), {
    rule: 1,
    outlets: ['inbox', 'badge'],
  })
})
