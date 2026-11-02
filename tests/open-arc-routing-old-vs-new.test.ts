import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import { routeDelivery } from '../shared/proactiveDelivery.js'
import type { DeliveryContext, ProactiveMessage } from '../shared/proactiveDelivery.js'
import { createProactiveInboxStore } from '../electron/services/proactiveInboxStore.js'
import {
  OPEN_ARC_ACTIONS,
  buildOpenArcProactiveMessage,
  deliverDueOpenArc,
  planOpenArcPresentation,
} from '../src/features/arc/openArcProactiveMessage.ts'
import type {
  DeliverDueOpenArcDeps,
  OpenArcDeliveryText,
} from '../src/features/arc/openArcProactiveMessage.ts'
import { decideNextCheckIn } from '../src/features/arc/openArcPolicy.ts'
import type { OpenArcRecord } from '../src/features/arc/openArcStore.ts'
import { PROACTIVE_LEGACY_PATH } from '../src/features/proactive/legacyPaths.ts'

const NOW = 1_700_000_000_000
const DAY_MS = 24 * 60 * 60 * 1000

const ARC: OpenArcRecord = {
  id: 'arc-1',
  theme: 'manager 1:1 friday',
  startedAt: '2026-01-01T08:00:00.000Z',
  checkInDays: [3, 5],
  status: 'open',
  checkInsFired: [],
}

const DELIVERY: OpenArcDeliveryText = {
  title: 'A thread you opened',
  body: 'Nexus held this for you: "manager 1:1 friday". Three days in — is it still sitting with you?',
}

function makeContext(overrides: Partial<DeliveryContext> = {}): DeliveryContext {
  return {
    panelFocused: false,
    fullscreen: false,
    focusState: 'active',
    inQuietHours: false,
    systemDnd: null,
    awayNotificationsEnabled: false,
    stripEnabled: true,
    ...overrides,
  }
}

function makeDeps(overrides: Partial<DeliverDueOpenArcDeps> = {}): DeliverDueOpenArcDeps {
  return {
    arc: ARC,
    delivery: DELIVERY,
    milestoneDay: 3,
    now: NOW,
    useLegacyPath: false,
    deliver: async () => ({ rule: 4, outlets: ['inbox', 'bubble'] }),
    showNotification: async () => undefined,
    buildContext: () => makeContext(),
    preferences: {
      quietStart: 22,
      quietEnd: 8,
      desktopAwarenessAllowed: true,
      awayNotificationsEnabled: true,
    },
    pushChatLine: async () => undefined,
    recordCheckInFired: () => undefined,
    isStopped: () => false,
    ...overrides,
  }
}

function createInbox(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-open-arc-inbox-'))
  const store = createProactiveInboxStore({
    getStorePath: () => path.join(directory, 'proactive-inbox.json'),
    now: () => NOW,
  })
  t.after(async () => {
    await store.flush()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return store
}

// ── Message shape ───────────────────────────────────────────────────────────

test('an arc message is deduped per arc milestone, normal priority and offers open', () => {
  const first = buildOpenArcProactiveMessage(ARC, DELIVERY, 3, NOW)
  const repeat = buildOpenArcProactiveMessage(ARC, DELIVERY, 3, NOW + 60_000)
  const nextMilestone = buildOpenArcProactiveMessage(ARC, DELIVERY, 5, NOW)
  const otherArc = buildOpenArcProactiveMessage({ ...ARC, id: 'arc-2' }, DELIVERY, 3, NOW)

  assert.equal(first.id, 'open_arc:arc-1:3')
  assert.equal(repeat.id, first.id)
  assert.notEqual(nextMilestone.id, first.id)
  assert.notEqual(otherArc.id, first.id)

  assert.equal(first.source, 'open_arc')
  assert.equal(first.kind, 'open_arc')
  assert.equal(first.priority, 'normal')
  assert.deepEqual(first.actions, ['open'])
  assert.deepEqual(OPEN_ARC_ACTIONS, ['open'])
  assert.equal(Object.isFrozen(OPEN_ARC_ACTIONS), true)
  assert.deepEqual(first.origin, { arcId: 'arc-1' })
  assert.equal(first.createdAt, NOW)
  assert.equal('speech' in first, false)
})

test('title and body are clipped to the 80/160 character contract', () => {
  const message = buildOpenArcProactiveMessage(
    ARC,
    { title: 't'.repeat(200), body: 'b'.repeat(400) },
    3,
    NOW,
  )

  assert.equal(message.title.length, 80)
  assert.ok(message.title.endsWith('…'))
  assert.equal(message.body.length, 160)
  assert.ok(message.body.endsWith('…'))
  assert.equal(message.fullBody, 'b'.repeat(400))
})

test('an unclipped body carries no duplicate fullBody', () => {
  const message = buildOpenArcProactiveMessage(ARC, DELIVERY, 3, NOW)

  assert.equal(message.body, DELIVERY.body)
  assert.equal('fullBody' in message, false)
})

// ── Old vs new table ────────────────────────────────────────────────────────

const OLD_ARC_PATH = Object.freeze({ surface: 'os_notification', chatLine: false })

const CASES = [
  {
    name: 'rule 1: quiet conditions',
    context: makeContext({ fullscreen: true }),
    rule: 1,
    outlets: ['inbox', 'badge'],
    chatLine: false,
  },
  {
    name: 'rule 2: panel focused',
    context: makeContext({ panelFocused: true }),
    rule: 2,
    outlets: ['inbox', 'panel'],
    chatLine: true,
  },
  {
    name: 'rule 3: active focus uses the strip',
    context: makeContext(),
    rule: 3,
    outlets: ['inbox', 'strip'],
    chatLine: false,
  },
  {
    name: 'rule 4: active focus without the strip',
    context: makeContext({ stripEnabled: false }),
    rule: 4,
    outlets: ['inbox', 'bubble'],
    chatLine: false,
  },
  {
    name: 'rule 5: idle with away notifications',
    context: makeContext({ focusState: 'idle', awayNotificationsEnabled: true }),
    rule: 5,
    outlets: ['inbox', 'os_notification'],
    chatLine: false,
  },
  {
    name: 'rule 6: idle without away notifications',
    context: makeContext({ focusState: 'idle' }),
    rule: 6,
    outlets: ['inbox', 'badge'],
    chatLine: false,
  },
] as const

for (const testCase of CASES) {
  test(`old vs new arc delivery — ${testCase.name}`, () => {
    const decision = routeDelivery(
      buildOpenArcProactiveMessage(ARC, DELIVERY, 3, NOW),
      testCase.context,
    )

    assert.equal(decision.rule, testCase.rule)
    assert.deepEqual(decision.outlets, testCase.outlets)
    // The pre-M1.1 path always raised an OS notification, whatever the focus.
    assert.deepEqual(OLD_ARC_PATH, { surface: 'os_notification', chatLine: false })
    // Only rule 2 adds a renderer chat line. Rule 3 belongs to the strip
    // outlet in main, exactly as the router decides; it is not special-cased.
    assert.deepEqual(planOpenArcPresentation(decision), { chatLine: testCase.chatLine })
  })
}

test('the badge counts the arc because it offers an action', async (t) => {
  const store = createInbox(t)
  const message: ProactiveMessage = buildOpenArcProactiveMessage(ARC, DELIVERY, 3, NOW)

  const mutation = store.upsert(message)

  assert.equal(mutation.unreadCount, 1)
})

// ── Delivery orchestration ──────────────────────────────────────────────────

test('the open-arc rollback switch defaults off and is frozen', () => {
  assert.equal(PROACTIVE_LEGACY_PATH.open_arc, false)
  assert.equal(Object.isFrozen(PROACTIVE_LEGACY_PATH), true)
})

test('legacy toggle: one notification, no router call, check-in recorded', async () => {
  const notifications: OpenArcDeliveryText[] = []
  const deliveries: unknown[] = []
  const fired: string[] = []

  const result = await deliverDueOpenArc(makeDeps({
    useLegacyPath: true,
    deliver: async (payload) => {
      deliveries.push(payload)
      return { rule: 6, outlets: ['inbox', 'badge'] }
    },
    showNotification: async (payload) => { notifications.push(payload) },
    recordCheckInFired: (id) => { fired.push(id) },
  }))

  assert.deepEqual(result, { path: 'legacy' })
  assert.deepEqual(notifications, [DELIVERY])
  assert.deepEqual(deliveries, [])
  assert.deepEqual(fired, [ARC.id])
})

test('a missing router bridge falls back to the legacy notification', async () => {
  const notifications: OpenArcDeliveryText[] = []
  const fired: string[] = []

  const result = await deliverDueOpenArc(makeDeps({
    deliver: undefined,
    showNotification: async (payload) => { notifications.push(payload) },
    recordCheckInFired: (id) => { fired.push(id) },
  }))

  assert.deepEqual(result, { path: 'legacy' })
  assert.deepEqual(notifications, [DELIVERY])
  assert.deepEqual(fired, [ARC.id])
})

test('a throwing router call falls back to exactly one notification and still records the check-in', async () => {
  const notifications: OpenArcDeliveryText[] = []
  const fired: string[] = []

  const result = await deliverDueOpenArc(makeDeps({
    deliver: async () => { throw new Error('bridge down') },
    showNotification: async (payload) => { notifications.push(payload) },
    recordCheckInFired: (id) => { fired.push(id) },
  }))

  assert.deepEqual(result, { path: 'fallback' })
  assert.deepEqual(notifications, [DELIVERY])
  assert.deepEqual(fired, [ARC.id])
})

test('router and notification failures together leave the check-in unrecorded', async () => {
  const fired: string[] = []

  await assert.rejects(() => deliverDueOpenArc(makeDeps({
    deliver: async () => { throw new Error('bridge down') },
    showNotification: async () => { throw new Error('notification down') },
    recordCheckInFired: (id) => { fired.push(id) },
  })), /notification down/)

  assert.deepEqual(fired, [])
})

test('router success on rule 2 pushes one chat line with the delivery body', async () => {
  const notifications: OpenArcDeliveryText[] = []
  const chatLines: string[] = []
  const fired: string[] = []
  const deliveredMessages: ProactiveMessage[] = []

  const result = await deliverDueOpenArc(makeDeps({
    deliver: async (payload) => {
      deliveredMessages.push(payload.message)
      return { rule: 2, outlets: ['inbox', 'panel'] }
    },
    showNotification: async (payload) => { notifications.push(payload) },
    pushChatLine: async (text) => { chatLines.push(text) },
    recordCheckInFired: (id) => { fired.push(id) },
  }))

  assert.deepEqual(result, { path: 'router', rule: 2 })
  assert.deepEqual(notifications, [])
  assert.deepEqual(chatLines, [DELIVERY.body])
  assert.deepEqual(fired, [ARC.id])
  assert.equal(deliveredMessages[0]?.id, 'open_arc:arc-1:3')
})

test('the rule-2 chat line carries the untruncated full body', async () => {
  const chatLines: string[] = []
  const longBody = `start\n\n${'x'.repeat(400)} the end`

  await deliverDueOpenArc(makeDeps({
    delivery: { ...DELIVERY, body: longBody },
    deliver: async () => ({ rule: 2, outlets: ['inbox', 'panel'] }),
    pushChatLine: async (text) => { chatLines.push(text) },
  }))

  assert.deepEqual(chatLines, [longBody])
})

test('router success on rule 3 leaves the strip to main and records no chat line', async () => {
  const chatLines: string[] = []
  const fired: string[] = []

  const result = await deliverDueOpenArc(makeDeps({
    deliver: async () => ({ rule: 3, outlets: ['inbox', 'strip'] }),
    pushChatLine: async (text) => { chatLines.push(text) },
    recordCheckInFired: (id) => { fired.push(id) },
  }))

  assert.deepEqual(result, { path: 'router', rule: 3 })
  assert.deepEqual(chatLines, [])
  assert.deepEqual(fired, [ARC.id])
})

test('a chat push failure records the check-in once and the next tick does not re-fire', async () => {
  const fired: string[] = []
  const dueArc: OpenArcRecord = {
    ...ARC,
    startedAt: new Date(NOW - 3 * DAY_MS).toISOString(),
  }

  await assert.rejects(() => deliverDueOpenArc(makeDeps({
    arc: dueArc,
    deliver: async () => ({ rule: 2, outlets: ['inbox', 'panel'] }),
    pushChatLine: async () => { throw new Error('chat push down') },
    recordCheckInFired: (id) => { fired.push(id) },
  })), /chat push down/)

  assert.deepEqual(fired, [dueArc.id])

  // The record landed before the chat push, so the scheduler's next tick sees
  // the day-3 milestone as already fired.
  const next = decideNextCheckIn(
    [{ ...dueArc, checkInsFired: [new Date(NOW).toISOString()] }],
    new Date(NOW),
    { quietHoursStart: 0, quietHoursEnd: 0 },
  )
  assert.equal(next.shouldFire, false)
})

test('a stopped router tick still records the check-in but sends no chat line', async () => {
  const notifications: OpenArcDeliveryText[] = []
  const chatLines: string[] = []
  const fired: string[] = []

  const result = await deliverDueOpenArc(makeDeps({
    deliver: async () => ({ rule: 2, outlets: ['inbox', 'panel'] }),
    showNotification: async (payload) => { notifications.push(payload) },
    pushChatLine: async (text) => { chatLines.push(text) },
    recordCheckInFired: (id) => { fired.push(id) },
    isStopped: () => true,
  }))

  assert.deepEqual(result, { path: 'router', rule: 2 })
  assert.deepEqual(notifications, [])
  assert.deepEqual(chatLines, [])
  assert.deepEqual(fired, [ARC.id])
})

test('a stopped fallback tick records the check-in once', async () => {
  const notifications: OpenArcDeliveryText[] = []
  const fired: string[] = []

  const result = await deliverDueOpenArc(makeDeps({
    deliver: async () => { throw new Error('bridge down') },
    showNotification: async (payload) => { notifications.push(payload) },
    recordCheckInFired: (id) => { fired.push(id) },
    isStopped: () => true,
  }))

  assert.deepEqual(result, { path: 'fallback' })
  assert.deepEqual(notifications, [DELIVERY])
  assert.deepEqual(fired, [ARC.id])
})

test('a stopped legacy tick records the check-in once', async () => {
  const notifications: OpenArcDeliveryText[] = []
  const fired: string[] = []

  const result = await deliverDueOpenArc(makeDeps({
    useLegacyPath: true,
    showNotification: async (payload) => { notifications.push(payload) },
    recordCheckInFired: (id) => { fired.push(id) },
    isStopped: () => true,
  }))

  assert.deepEqual(result, { path: 'legacy' })
  assert.deepEqual(notifications, [DELIVERY])
  assert.deepEqual(fired, [ARC.id])
})
