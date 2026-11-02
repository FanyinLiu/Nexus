import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import { routeDelivery } from '../shared/proactiveDelivery.js'
import type { DeliveryContext, ProactiveMessage } from '../shared/proactiveDelivery.js'
import { createProactiveInboxStore } from '../electron/services/proactiveInboxStore.js'
import {
  buildCapsuleProactiveMessage,
  deliverDueCapsule,
  planCapsulePresentation,
} from '../src/features/futureCapsule/capsuleProactiveMessage.ts'
import { buildFutureCapsuleDelivery } from '../src/features/futureCapsule/futureCapsuleDelivery.ts'
import type {
  CapsuleDeliveryText,
  DeliverDueCapsuleDeps,
} from '../src/features/futureCapsule/capsuleProactiveMessage.ts'
import type { FutureCapsuleRecord } from '../src/features/futureCapsule/futureCapsuleStore.ts'
import { PROACTIVE_LEGACY_PATH } from '../src/features/proactive/legacyPaths.ts'

const NOW = 1_700_000_000_000

const CAPSULE: FutureCapsuleRecord = {
  id: 'capsule-1',
  message: 'Remember to breathe',
  createdAt: '2026-01-01T08:00:00.000Z',
  scheduledFor: '2026-02-01',
  status: 'pending',
}

const DELIVERY: CapsuleDeliveryText = {
  title: 'A note from your past self',
  body: 'Nexus: 31 days ago you wrote a note for today. Reading it back: "Remember to breathe"',
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

function makeDeps(overrides: Partial<DeliverDueCapsuleDeps> = {}): DeliverDueCapsuleDeps {
  return {
    capsule: CAPSULE,
    delivery: DELIVERY,
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
    markDelivered: () => undefined,
    isStopped: () => false,
    ...overrides,
  }
}

function createInbox(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-capsule-inbox-'))
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

test('a capsule message is deduped by capsule id, high priority and actionless', () => {
  const first = buildCapsuleProactiveMessage(CAPSULE, DELIVERY, NOW)
  const repeat = buildCapsuleProactiveMessage(CAPSULE, DELIVERY, NOW + 60_000)
  const other = buildCapsuleProactiveMessage({ ...CAPSULE, id: 'capsule-2' }, DELIVERY, NOW)

  assert.equal(first.id, 'capsule:capsule-1')
  assert.equal(repeat.id, first.id)
  assert.notEqual(other.id, first.id)

  assert.equal(first.source, 'capsule')
  assert.equal(first.kind, 'capsule')
  assert.equal(first.priority, 'high')
  assert.deepEqual(first.actions, [])
  assert.deepEqual(first.origin, { capsuleId: 'capsule-1' })
  assert.equal(first.createdAt, NOW)
  assert.equal('speech' in first, false)
})

test('title and body are clipped to the 80/160 character contract', () => {
  const message = buildCapsuleProactiveMessage(
    CAPSULE,
    { title: 't'.repeat(200), body: 'b'.repeat(400) },
    NOW,
  )

  assert.equal(message.title.length, 80)
  assert.ok(message.title.endsWith('…'))
  assert.equal(message.body.length, 160)
  assert.ok(message.body.endsWith('…'))
})

test('a long capsule keeps a truncated body and the verbatim fullBody in the inbox', (t) => {
  const originalMessage = `first line\n\n${'x'.repeat(300)} the end`
  const capsule: FutureCapsuleRecord = { ...CAPSULE, message: originalMessage }
  const delivery = buildFutureCapsuleDelivery({
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    capsule,
    now: new Date('2026-02-01T12:00:00.000Z'),
  })
  const message = buildCapsuleProactiveMessage(capsule, delivery, NOW)

  assert.equal(message.body.length, 160)
  assert.ok(message.body.endsWith('…'))
  assert.equal(message.fullBody, delivery.fullBody)
  assert.ok(message.fullBody?.includes(originalMessage))

  const store = createInbox(t)
  store.upsert(message)
  const listed = store.list().entries.find((entry) => entry.id === message.id)

  assert.ok(listed)
  assert.ok(listed.body.length <= 160)
  assert.ok(listed.body.endsWith('…'))
  assert.equal(listed.fullBody, delivery.fullBody)
  assert.ok(listed.fullBody?.includes(originalMessage))
  assert.equal(listed.priority, 'high')
  assert.deepEqual(listed.actions, [])
  assert.equal(store.list().unreadCount, 1)
})

test('a short capsule omits the redundant fullBody', () => {
  const delivery = buildFutureCapsuleDelivery({
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    capsule: CAPSULE,
    now: new Date('2026-02-01T12:00:00.000Z'),
  })
  const message = buildCapsuleProactiveMessage(CAPSULE, delivery, NOW)

  assert.equal(delivery.fullBody, delivery.body)
  assert.equal('fullBody' in message, false)
})

// ── Old vs new table ────────────────────────────────────────────────────────

const OLD_CAPSULE_PATH = Object.freeze({ surface: 'os_notification', chatLine: false })

const CASES = [
  {
    name: 'rule 1: quiet conditions',
    context: makeContext({ fullscreen: true }),
    rule: 1,
    outlets: ['inbox', 'badge'],
    chatLine: true,
  },
  {
    name: 'rule 2: panel focused',
    context: makeContext({ panelFocused: true }),
    rule: 2,
    outlets: ['inbox', 'panel'],
    chatLine: true,
  },
  {
    name: 'rule 3 is unreachable: no actions keeps active focus on the bubble',
    context: makeContext(),
    rule: 4,
    outlets: ['inbox', 'bubble'],
    chatLine: true,
  },
  {
    name: 'rule 4: active focus without the strip',
    context: makeContext({ stripEnabled: false }),
    rule: 4,
    outlets: ['inbox', 'bubble'],
    chatLine: true,
  },
  {
    name: 'rule 5: idle with away notifications',
    context: makeContext({ focusState: 'idle', awayNotificationsEnabled: true }),
    rule: 5,
    outlets: ['inbox', 'os_notification'],
    chatLine: true,
  },
  {
    name: 'rule 6: idle without away notifications',
    context: makeContext({ focusState: 'idle' }),
    rule: 6,
    outlets: ['inbox', 'badge'],
    chatLine: true,
  },
] as const

for (const testCase of CASES) {
  test(`old vs new capsule delivery — ${testCase.name}`, () => {
    const decision = routeDelivery(buildCapsuleProactiveMessage(CAPSULE, DELIVERY, NOW), testCase.context)

    assert.equal(decision.rule, testCase.rule)
    assert.deepEqual(decision.outlets, testCase.outlets)
    // The pre-M1.1 path always raised an OS notification, whatever the focus.
    assert.deepEqual(OLD_CAPSULE_PATH, { surface: 'os_notification', chatLine: false })
    // The new plan adds the chat-only line for every routed rule: no routed
    // outlet shows the full text (inbox-only rules, clipped bubble/toast, and
    // rule 2 without a renderer panel).
    assert.deepEqual(planCapsulePresentation(decision), { chatLine: testCase.chatLine })
    assert.notEqual(decision.rule, 3, 'a capsule has no actions, so rule 3 never matches')
  })
}

test('the badge counts the capsule even though it has no actions', async (t) => {
  const store = createInbox(t)
  const message: ProactiveMessage = buildCapsuleProactiveMessage(CAPSULE, DELIVERY, NOW)

  const mutation = store.upsert(message)

  assert.equal(mutation.unreadCount, 1)
})

const QUIET_CONDITIONS: ReadonlyArray<{ name: string; context: DeliveryContext }> = [
  { name: 'fullscreen', context: makeContext({ fullscreen: true }) },
  { name: 'quiet hours', context: makeContext({ inQuietHours: true }) },
  { name: 'system DND', context: makeContext({ systemDnd: true }) },
]

for (const quiet of QUIET_CONDITIONS) {
  test(`quiet conditions (${quiet.name}) keep a high-priority capsule in the inbox and badge`, (t) => {
    const message = buildCapsuleProactiveMessage(CAPSULE, DELIVERY, NOW)
    const decision = routeDelivery(message, quiet.context)

    assert.equal(decision.rule, 1)
    assert.deepEqual(decision.outlets, ['inbox', 'badge'])

    const store = createInbox(t)
    const mutation = store.upsert(message)
    const snapshot = store.list()
    const stored = snapshot.entries.find((entry) => entry.id === message.id)

    assert.equal(mutation.unreadCount, 1)
    assert.equal(snapshot.unreadCount, 1, 'the badge count is the inbox unread count')
    assert.equal(stored?.priority, 'high')

    // The capsule has no actions, so only 'high' keeps the dot lit.
    const normalStore = createInbox(t)
    normalStore.upsert({ ...message, priority: 'normal' })
    assert.equal(normalStore.list().unreadCount, 0)
  })
}

// ── Delivery orchestration ──────────────────────────────────────────────────

test('the rollback switch defaults off and is frozen', () => {
  assert.equal(PROACTIVE_LEGACY_PATH.capsule, false)
  assert.equal(Object.isFrozen(PROACTIVE_LEGACY_PATH), true)
})

test('legacy toggle: one notification, no router call, capsule marked delivered', async () => {
  const notifications: CapsuleDeliveryText[] = []
  const deliveries: unknown[] = []
  const delivered: string[] = []

  const result = await deliverDueCapsule(makeDeps({
    useLegacyPath: true,
    deliver: async (payload) => {
      deliveries.push(payload)
      return { rule: 6, outlets: ['inbox', 'badge'] }
    },
    showNotification: async (payload) => { notifications.push(payload) },
    markDelivered: (id) => { delivered.push(id) },
  }))

  assert.deepEqual(result, { path: 'legacy' })
  assert.deepEqual(notifications, [DELIVERY])
  assert.deepEqual(deliveries, [])
  assert.deepEqual(delivered, [CAPSULE.id])
})

test('a missing router bridge falls back to the legacy notification', async () => {
  const notifications: CapsuleDeliveryText[] = []
  const delivered: string[] = []

  const result = await deliverDueCapsule(makeDeps({
    deliver: undefined,
    showNotification: async (payload) => { notifications.push(payload) },
    markDelivered: (id) => { delivered.push(id) },
  }))

  assert.deepEqual(result, { path: 'legacy' })
  assert.deepEqual(notifications, [DELIVERY])
  assert.deepEqual(delivered, [CAPSULE.id])
})

test('a throwing router call falls back to exactly one notification and still marks delivered', async () => {
  const notifications: CapsuleDeliveryText[] = []
  const chatLines: string[] = []
  const delivered: string[] = []

  const result = await deliverDueCapsule(makeDeps({
    deliver: async () => { throw new Error('bridge down') },
    showNotification: async (payload) => { notifications.push(payload) },
    pushChatLine: async (text) => { chatLines.push(text) },
    markDelivered: (id) => { delivered.push(id) },
  }))

  assert.deepEqual(result, { path: 'fallback' })
  assert.deepEqual(notifications, [DELIVERY])
  assert.deepEqual(chatLines, [], 'the fallback OS toast carries no chat line')
  assert.deepEqual(delivered, [CAPSULE.id])
})

test('router success on rule 2 pushes one chat line with the delivery body', async () => {
  const notifications: CapsuleDeliveryText[] = []
  const chatLines: string[] = []
  const delivered: string[] = []
  const deliveredMessages: ProactiveMessage[] = []

  const result = await deliverDueCapsule(makeDeps({
    deliver: async (payload) => {
      deliveredMessages.push(payload.message)
      return { rule: 2, outlets: ['inbox', 'panel'] }
    },
    showNotification: async (payload) => { notifications.push(payload) },
    pushChatLine: async (text) => { chatLines.push(text) },
    markDelivered: (id) => { delivered.push(id) },
  }))

  assert.deepEqual(result, { path: 'router', rule: 2 })
  assert.deepEqual(notifications, [])
  assert.deepEqual(chatLines, [DELIVERY.body])
  assert.deepEqual(delivered, [CAPSULE.id])
  assert.equal(deliveredMessages[0]?.id, 'capsule:capsule-1')
})

test('a fullscreen capsule writes one chat line with the full untruncated text', async () => {
  const originalMessage = `first line\n\n${'x'.repeat(300)} the end`
  const capsule: FutureCapsuleRecord = { ...CAPSULE, message: originalMessage }
  const delivery = buildFutureCapsuleDelivery({
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    capsule,
    now: new Date('2026-02-01T12:00:00.000Z'),
  })
  const notifications: CapsuleDeliveryText[] = []
  const chatLines: string[] = []
  const delivered: string[] = []
  const deliveredMessages: ProactiveMessage[] = []

  const result = await deliverDueCapsule(makeDeps({
    capsule,
    delivery,
    buildContext: () => makeContext({ fullscreen: true }),
    deliver: async ({ message, context }) => {
      deliveredMessages.push(message)
      return routeDelivery(message, context)
    },
    showNotification: async (payload) => { notifications.push(payload) },
    pushChatLine: async (text) => { chatLines.push(text) },
    markDelivered: (id) => { delivered.push(id) },
  }))

  assert.deepEqual(result, { path: 'router', rule: 1 })
  assert.deepEqual(notifications, [])
  assert.ok(delivery.fullBody && delivery.fullBody.length > 160)

  assert.equal(chatLines.length, 1)
  assert.equal(chatLines[0], delivery.fullBody)
  assert.ok(chatLines[0]?.includes(originalMessage), 'the line keeps the capsule message verbatim')

  // The inbox entry and the routed outlet keep the clipped body; only the chat
  // line carries the whole message.
  assert.equal(deliveredMessages[0]?.body.length, 160)
  assert.ok(deliveredMessages[0]?.body.endsWith('…'))
  assert.deepEqual(delivered, [CAPSULE.id])
})

// The hook wraps this push as a chat-only notice (`bubbleContent: ''`,
// `dedupeKey: capsule:<id>`), so the injected pushChatLine below is the same
// call deliverDueCapsule makes. That payload shape lives inside a React hook
// and is not reachable without rendering it.
const ONE_CHAT_LINE_CASES = [
  { name: 'quiet hours', rule: 1, context: makeContext({ inQuietHours: true }) },
  { name: 'system DND', rule: 1, context: makeContext({ systemDnd: true }) },
  { name: 'rule 4 bubble', rule: 4, context: makeContext({ stripEnabled: false }) },
  {
    name: 'rule 5 OS notification',
    rule: 5,
    context: makeContext({ focusState: 'idle', awayNotificationsEnabled: true }),
  },
  { name: 'rule 6 badge', rule: 6, context: makeContext({ focusState: 'idle' }) },
] as const

for (const testCase of ONE_CHAT_LINE_CASES) {
  test(`${testCase.name} still writes exactly one chat line and no notification`, async () => {
    const notifications: CapsuleDeliveryText[] = []
    const chatLines: string[] = []
    const delivered: string[] = []

    const result = await deliverDueCapsule(makeDeps({
      buildContext: () => testCase.context,
      deliver: async ({ message, context }) => routeDelivery(message, context),
      showNotification: async (payload) => { notifications.push(payload) },
      pushChatLine: async (text) => { chatLines.push(text) },
      markDelivered: (id) => { delivered.push(id) },
    }))

    assert.deepEqual(result, { path: 'router', rule: testCase.rule })
    assert.deepEqual(notifications, [])
    assert.deepEqual(chatLines, [DELIVERY.body])
    assert.deepEqual(delivered, [CAPSULE.id])
  })
}

test('rule 2 writes one line and a second tick for the same capsule writes nothing', async () => {
  const chatLines: string[] = []
  const delivered: string[] = []
  let deliveryCalls = 0
  // Stands in for `findDueCapsule`: the store stops reporting the capsule once
  // it is marked delivered, so the poller never calls the router again.
  let due = true

  const deps = makeDeps({
    deliver: async () => {
      deliveryCalls += 1
      return { rule: 2, outlets: ['inbox', 'panel'] }
    },
    pushChatLine: async (text) => { chatLines.push(text) },
    markDelivered: (id) => {
      delivered.push(id)
      due = false
    },
  })

  if (due) await deliverDueCapsule(deps)
  assert.deepEqual(chatLines, [DELIVERY.body], 'a rule-2 delivery gets one line, not two')

  if (due) await deliverDueCapsule(deps)
  assert.equal(deliveryCalls, 1)
  assert.equal(chatLines.length, 1)
  assert.deepEqual(delivered, [CAPSULE.id])
})

test('a throwing chat push on a rule-1 delivery marks once and never re-delivers', async () => {
  const chatLines: string[] = []
  const delivered: string[] = []
  let deliveryCalls = 0
  let due = true

  const deps = makeDeps({
    deliver: async () => {
      deliveryCalls += 1
      return { rule: 1, outlets: ['inbox', 'badge'] }
    },
    pushChatLine: async (text) => {
      chatLines.push(text)
      throw new Error('chat push failed')
    },
    markDelivered: (id) => {
      delivered.push(id)
      due = false
    },
  })

  await assert.rejects(() => deliverDueCapsule(deps), /chat push failed/)

  assert.deepEqual(delivered, [CAPSULE.id])
  assert.equal(deliveryCalls, 1)

  if (due) await deliverDueCapsule(deps)
  assert.equal(deliveryCalls, 1)
  assert.equal(chatLines.length, 1)
})

test('a stopped scheduler still marks the capsule delivered but sends no chat line', async () => {
  for (const rule of [1, 2] as const) {
    const notifications: CapsuleDeliveryText[] = []
    const chatLines: string[] = []
    const delivered: string[] = []

    const result = await deliverDueCapsule(makeDeps({
      deliver: async () => ({ rule, outlets: rule === 2 ? ['inbox', 'panel'] : ['inbox', 'badge'] }),
      showNotification: async (payload) => { notifications.push(payload) },
      pushChatLine: async (text) => { chatLines.push(text) },
      markDelivered: (id) => { delivered.push(id) },
      isStopped: () => true,
    }))

    assert.deepEqual(result, { path: 'router', rule })
    assert.deepEqual(notifications, [])
    assert.deepEqual(chatLines, [])
    assert.deepEqual(delivered, [CAPSULE.id])
  }
})

test('a stopped scheduler tick on the fallback path marks the capsule once', async () => {
  const notifications: CapsuleDeliveryText[] = []
  const delivered: string[] = []

  const result = await deliverDueCapsule(makeDeps({
    deliver: async () => { throw new Error('bridge down') },
    showNotification: async (payload) => { notifications.push(payload) },
    markDelivered: (id) => { delivered.push(id) },
    isStopped: () => true,
  }))

  assert.deepEqual(result, { path: 'fallback' })
  assert.deepEqual(notifications, [DELIVERY])
  assert.deepEqual(delivered, [CAPSULE.id])
})

test('a stopped scheduler tick on the legacy path marks the capsule once', async () => {
  const notifications: CapsuleDeliveryText[] = []
  const delivered: string[] = []

  const result = await deliverDueCapsule(makeDeps({
    useLegacyPath: true,
    showNotification: async (payload) => { notifications.push(payload) },
    markDelivered: (id) => { delivered.push(id) },
    isStopped: () => true,
  }))

  assert.deepEqual(result, { path: 'legacy' })
  assert.deepEqual(notifications, [DELIVERY])
  assert.deepEqual(delivered, [CAPSULE.id])
})

test('router and notification failures together leave the capsule undelivered', async () => {
  const delivered: string[] = []

  await assert.rejects(() => deliverDueCapsule(makeDeps({
    deliver: async () => { throw new Error('bridge down') },
    showNotification: async () => { throw new Error('notification down') },
    markDelivered: (id) => { delivered.push(id) },
  })), /notification down/)

  assert.deepEqual(delivered, [])
})

test('the chat line carries the untruncated full body for any routed rule', async () => {
  const chatLines: string[] = []
  const delivery: CapsuleDeliveryText = {
    ...DELIVERY,
    body: 'short body',
    fullBody: 'the complete original message that keeps going',
  }

  await deliverDueCapsule(makeDeps({
    delivery,
    buildContext: () => makeContext({ fullscreen: true }),
    deliver: async ({ message, context }) => routeDelivery(message, context),
    pushChatLine: async (text) => { chatLines.push(text) },
  }))

  assert.deepEqual(chatLines, [delivery.fullBody])
})
