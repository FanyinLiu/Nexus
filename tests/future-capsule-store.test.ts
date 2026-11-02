import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  DeliveryContext,
  DeliveryDecision,
  ProactiveDeliveryPreferences,
} from '../shared/proactiveDelivery.js'
import {
  deliverDueCapsule,
} from '../src/features/futureCapsule/capsuleProactiveMessage.ts'
import type { CapsuleDeliverBridge } from '../src/features/futureCapsule/capsuleProactiveMessage.ts'
import { buildFutureCapsuleDelivery } from '../src/features/futureCapsule/futureCapsuleDelivery.ts'
import {
  findDueCapsule,
  loadFutureCapsules,
  markDelivered,
} from '../src/features/futureCapsule/futureCapsuleStore.ts'
import type { FutureCapsuleRecord } from '../src/features/futureCapsule/futureCapsuleStore.ts'
import { localDayKey } from '../src/lib/localDate.ts'
import { FUTURE_CAPSULE_STORE_STORAGE_KEY } from '../src/lib/storage/core.ts'

const NOW = new Date(2026, 3, 30, 12, 0, 0)
const NOW_MS = NOW.getTime()

const PREFERENCES: ProactiveDeliveryPreferences = {
  quietStart: 22,
  quietEnd: 8,
  desktopAwarenessAllowed: true,
  awayNotificationsEnabled: true,
}

function localDay(offsetDays: number): string {
  const date = new Date(NOW)
  date.setDate(date.getDate() + offsetDays)
  return localDayKey(date.getTime())
}

function createLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

function installStorage(): void {
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: createLocalStorageMock() },
    configurable: true,
    writable: true,
  })
}

function seed(capsules: FutureCapsuleRecord[]): void {
  window.localStorage.setItem(FUTURE_CAPSULE_STORE_STORAGE_KEY, JSON.stringify(capsules))
}

function persisted(): FutureCapsuleRecord[] {
  return JSON.parse(window.localStorage.getItem(FUTURE_CAPSULE_STORE_STORAGE_KEY) ?? '[]')
}

function makeCapsule(overrides: Partial<FutureCapsuleRecord> = {}): FutureCapsuleRecord {
  return {
    id: 'capsule-due',
    message: 'Remember to breathe',
    createdAt: '2026-01-01T08:00:00.000Z',
    scheduledFor: localDay(-1),
    status: 'pending',
    ...overrides,
  }
}

function makeContext(): DeliveryContext {
  return {
    panelFocused: false,
    fullscreen: false,
    focusState: 'active',
    inQuietHours: false,
    systemDnd: null,
    awayNotificationsEnabled: false,
    stripEnabled: true,
  }
}

const RULE_ONE: DeliveryDecision = { rule: 1, outlets: ['inbox', 'badge'] }

// ── findDueCapsule ──────────────────────────────────────────────────────────

test('findDueCapsule: a pending capsule scheduled today or earlier is due', () => {
  installStorage()
  seed([makeCapsule({ id: 'due-today', scheduledFor: localDay(0) })])

  assert.equal(findDueCapsule(NOW)?.id, 'due-today')
})

test('findDueCapsule: a future capsule is not due', () => {
  installStorage()
  seed([makeCapsule({ id: 'future', scheduledFor: localDay(1) })])

  assert.equal(findDueCapsule(NOW), null)
})

test('findDueCapsule: a delivered capsule is not due even when its date passed', () => {
  installStorage()
  seed([makeCapsule({ id: 'delivered', status: 'delivered', deliveredAt: '2026-04-29T08:00:00.000Z' })])

  assert.equal(findDueCapsule(NOW), null)
})

test('findDueCapsule: returns the first due capsule in stored order', () => {
  installStorage()
  seed([
    makeCapsule({ id: 'future', scheduledFor: localDay(3) }),
    makeCapsule({ id: 'older', scheduledFor: localDay(-5) }),
    makeCapsule({ id: 'newer', scheduledFor: localDay(-1) }),
    makeCapsule({ id: 'delivered', status: 'delivered', deliveredAt: '2026-04-29T08:00:00.000Z' }),
  ])

  // loadFutureCapsules sorts pending entries by scheduledFor ascending.
  assert.equal(findDueCapsule(NOW)?.id, 'older')
})

// ── markDelivered ───────────────────────────────────────────────────────────

test('markDelivered: sets status and deliveredAt and persists the record', () => {
  installStorage()
  seed([makeCapsule({ id: 'capsule-due' })])

  const updated = markDelivered('capsule-due', NOW)

  assert.equal(updated?.status, 'delivered')
  assert.equal(updated?.deliveredAt, NOW.toISOString())
  const stored = persisted().find((capsule) => capsule.id === 'capsule-due')
  assert.equal(stored?.status, 'delivered')
  assert.equal(stored?.deliveredAt, NOW.toISOString())
  assert.equal(loadFutureCapsules()[0]?.status, 'delivered')
})

test('markDelivered: an unknown id returns null and changes nothing', () => {
  installStorage()
  seed([makeCapsule({ id: 'capsule-due' })])
  const before = window.localStorage.getItem(FUTURE_CAPSULE_STORE_STORAGE_KEY)

  assert.equal(markDelivered('missing', NOW), null)
  assert.equal(window.localStorage.getItem(FUTURE_CAPSULE_STORE_STORAGE_KEY), before)
})

// ── Scheduler dedupe and restart ────────────────────────────────────────────

async function runTick(options: {
  deliver: CapsuleDeliverBridge
  pushChatLine?: (text: string) => Promise<void>
  onMark?: () => void
}): Promise<boolean> {
  const due = findDueCapsule(NOW)
  if (!due) return false

  const delivery = buildFutureCapsuleDelivery({
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    capsule: due,
    now: NOW,
  })

  await deliverDueCapsule({
    capsule: due,
    delivery,
    now: NOW_MS,
    useLegacyPath: false,
    deliver: options.deliver,
    buildContext: () => makeContext(),
    preferences: PREFERENCES,
    ...(options.pushChatLine ? { pushChatLine: options.pushChatLine } : {}),
    markDelivered: (id) => {
      options.onMark?.()
      markDelivered(id, NOW)
    },
    isStopped: () => false,
  })
  return true
}

test('the same due capsule is delivered once across consecutive scheduler ticks', async () => {
  installStorage()
  seed([makeCapsule({ id: 'capsule-due' })])
  let deliveryCalls = 0
  let marks = 0

  const first = await runTick({
    deliver: async () => { deliveryCalls += 1; return RULE_ONE },
    onMark: () => { marks += 1 },
  })
  const second = await runTick({
    deliver: async () => { deliveryCalls += 1; return RULE_ONE },
    onMark: () => { marks += 1 },
  })

  assert.equal(first, true)
  assert.equal(second, false)
  assert.equal(deliveryCalls, 1)
  assert.equal(marks, 1)
  assert.equal(loadFutureCapsules()[0]?.status, 'delivered')
})

test('a restarted store reading the same persisted state finds nothing due', async () => {
  installStorage()
  seed([makeCapsule({ id: 'capsule-due' })])
  let deliveryCalls = 0

  await runTick({ deliver: async () => { deliveryCalls += 1; return RULE_ONE } })

  const restarted = await import(
    '../src/features/futureCapsule/futureCapsuleStore.ts?restart=1'
  )

  assert.equal(restarted.findDueCapsule(NOW), null)
  const replayed = await runTick({ deliver: async () => { deliveryCalls += 1; return RULE_ONE } })
  assert.equal(replayed, false)
  assert.equal(deliveryCalls, 1)
})

test('a throwing chat push after router success marks delivered once and never re-delivers', async () => {
  installStorage()
  seed([makeCapsule({ id: 'capsule-due' })])
  let deliveryCalls = 0
  let marks = 0

  await assert.rejects(() => runTick({
    deliver: async () => { deliveryCalls += 1; return { rule: 2, outlets: ['inbox', 'panel'] } },
    pushChatLine: async () => { throw new Error('chat push failed') },
    onMark: () => { marks += 1 },
  }), /chat push failed/)

  assert.equal(deliveryCalls, 1)
  assert.equal(marks, 1)
  assert.equal(findDueCapsule(NOW), null)

  const replay = await runTick({
    deliver: async () => { deliveryCalls += 1; return RULE_ONE },
    onMark: () => { marks += 1 },
  })
  assert.equal(replay, false)
  assert.equal(deliveryCalls, 1)
  assert.equal(marks, 1)
})

test('the router receives a message whose body is clipped and fullBody is not', async () => {
  installStorage()
  const longMessage = `line one\n\n${'y'.repeat(300)} end`
  seed([makeCapsule({ id: 'capsule-due', message: longMessage })])
  const seen: Array<{ body: string; fullBody?: string }> = []

  await runTick({
    deliver: async ({ message }) => {
      seen.push({ body: message.body, ...(message.fullBody ? { fullBody: message.fullBody } : {}) })
      return RULE_ONE
    },
  })

  const message = seen[0]
  assert.ok(message)
  assert.ok(message.body.length <= 160)
  assert.ok(message.fullBody?.includes(longMessage))
})
