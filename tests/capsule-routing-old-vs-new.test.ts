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

// ── Old vs new table ────────────────────────────────────────────────────────

const OLD_CAPSULE_PATH = Object.freeze({ surface: 'os_notification', chatLine: false })

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
    name: 'rule 3 is unreachable: no actions keeps active focus on the bubble',
    context: makeContext(),
    rule: 4,
    outlets: ['inbox', 'bubble'],
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
  test(`old vs new capsule delivery — ${testCase.name}`, () => {
    const decision = routeDelivery(buildCapsuleProactiveMessage(CAPSULE, DELIVERY, NOW), testCase.context)

    assert.equal(decision.rule, testCase.rule)
    assert.deepEqual(decision.outlets, testCase.outlets)
    // The pre-M1.1 path always raised an OS notification, whatever the focus.
    assert.deepEqual(OLD_CAPSULE_PATH, { surface: 'os_notification', chatLine: false })
    // The new plan adds a chat line only for rule 2: main has no panel outlet,
    // so the panel-focused case needs a renderer-side surface.
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
  const delivered: string[] = []

  const result = await deliverDueCapsule(makeDeps({
    deliver: async () => { throw new Error('bridge down') },
    showNotification: async (payload) => { notifications.push(payload) },
    markDelivered: (id) => { delivered.push(id) },
  }))

  assert.deepEqual(result, { path: 'fallback' })
  assert.deepEqual(notifications, [DELIVERY])
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

test('router success on an inbox-only rule stays quiet and marks delivered', async () => {
  const notifications: CapsuleDeliveryText[] = []
  const chatLines: string[] = []
  const delivered: string[] = []

  const result = await deliverDueCapsule(makeDeps({
    deliver: async () => ({ rule: 1, outlets: ['inbox', 'badge'] }),
    showNotification: async (payload) => { notifications.push(payload) },
    pushChatLine: async (text) => { chatLines.push(text) },
    markDelivered: (id) => { delivered.push(id) },
  }))

  assert.deepEqual(result, { path: 'router', rule: 1 })
  assert.deepEqual(notifications, [])
  assert.deepEqual(chatLines, [])
  assert.deepEqual(delivered, [CAPSULE.id])
})

test('a stopped scheduler tick never marks the capsule delivered', async () => {
  const notifications: CapsuleDeliveryText[] = []
  const delivered: string[] = []

  const result = await deliverDueCapsule(makeDeps({
    deliver: async () => ({ rule: 4, outlets: ['inbox', 'bubble'] }),
    showNotification: async (payload) => { notifications.push(payload) },
    markDelivered: (id) => { delivered.push(id) },
    isStopped: () => true,
  }))

  assert.deepEqual(result, { path: 'router', rule: 4 })
  assert.deepEqual(notifications, [])
  assert.deepEqual(delivered, [])
})
