import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  routeDelivery,
  type DeliveryContext,
  type DeliveryState,
  type ProactiveMessage,
} from '../shared/proactiveDelivery.js'
import {
  createProactiveInboxStore,
} from '../electron/services/proactiveInboxStore.js'
import {
  createProactiveOutletRegistry,
  createProactiveRouter,
} from '../electron/services/proactiveRouter.js'
import type { Logger } from '../electron/logger.js'
import {
  validateInboxUpdatePayload,
  validateProactiveDeliveryPayload,
} from '../electron/ipc/proactivePayloadSchemas.js'
import { formatProactiveUnreadBadge } from '../src/features/proactive/proactiveUnreadBadge.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const START = 1_700_000_000_000

function makeMessage(overrides: Partial<ProactiveMessage> = {}): ProactiveMessage {
  return {
    id: 'msg-1',
    source: 'reminder',
    kind: 'reminder_follow_up',
    priority: 'normal',
    title: 'Stand up',
    body: 'You asked me to remind you.',
    actions: ['done'],
    createdAt: START,
    ...overrides,
  }
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

function route(message: Partial<ProactiveMessage>, context: Partial<DeliveryContext>) {
  return routeDelivery(makeMessage(message), makeContext(context))
}

// ── Router rules ────────────────────────────────────────────────────────────

test('rule 1 sends actionable messages quietly to the inbox and badge', () => {
  assert.deepEqual(route({}, { fullscreen: true }), { rule: 1, outlets: ['inbox', 'badge'] })
  assert.deepEqual(route({}, { systemDnd: true }), { rule: 1, outlets: ['inbox', 'badge'] })
  assert.deepEqual(route({}, { focusState: 'locked' }), { rule: 1, outlets: ['inbox', 'badge'] })
  assert.deepEqual(route({}, { inQuietHours: true }), { rule: 1, outlets: ['inbox', 'badge'] })
})

test('rule 1 does not match when every quiet flag is off and DND is unknown', () => {
  const decision = route({ actions: [] }, { systemDnd: null })
  assert.equal(decision.rule, 4)
})

test('rule 1 treats a missing system DND reading as false', () => {
  assert.equal(route({ actions: [] }, { systemDnd: null }).rule, 4)
  assert.equal(route({ actions: [] }, { systemDnd: false }).rule, 4)
  assert.equal(route({}, { systemDnd: true }).rule, 1)
})

test('rule 2 hands the message to the panel', () => {
  assert.deepEqual(route({}, { panelFocused: true }), { rule: 2, outlets: ['inbox', 'panel'] })
  assert.deepEqual(
    route({}, { panelFocused: true, focusState: 'idle' }),
    { rule: 2, outlets: ['inbox', 'panel'] },
  )
})

test('rule 2 does not match while the panel is in the background', () => {
  assert.equal(route({ actions: [] }, { panelFocused: false }).rule, 4)
})

test('rule 3 uses the strip for actionable messages during active focus', () => {
  assert.deepEqual(route({}, {}), { rule: 3, outlets: ['inbox', 'strip'] })
  assert.deepEqual(
    route({ actions: ['open', 'snooze'] }, {}),
    { rule: 3, outlets: ['inbox', 'strip'] },
  )
})

test('rule 3 does not match without actions or without the strip enabled', () => {
  assert.equal(route({ actions: [] }, {}).rule, 4)
  assert.equal(route({}, { stripEnabled: false }).rule, 4)
})

test('rule 4 falls back to the pet bubble during active focus', () => {
  assert.deepEqual(route({ actions: [] }, {}), { rule: 4, outlets: ['inbox', 'bubble'] })
  assert.deepEqual(
    route({ actions: ['done'] }, { stripEnabled: false }),
    { rule: 4, outlets: ['inbox', 'bubble'] },
  )
})

test('rule 4 does not match outside active focus', () => {
  assert.equal(route({ actions: [] }, { focusState: 'idle', awayNotificationsEnabled: true }).rule, 5)
})

test('rule 5 raises an OS notification for idle and away focus', () => {
  assert.deepEqual(
    route({ actions: [] }, { focusState: 'idle', awayNotificationsEnabled: true }),
    { rule: 5, outlets: ['inbox', 'os_notification'] },
  )
  assert.deepEqual(
    route({ actions: [] }, { focusState: 'away', awayNotificationsEnabled: true }),
    { rule: 5, outlets: ['inbox', 'os_notification'] },
  )
})

test('rule 5 does not match when away notifications are off', () => {
  assert.equal(route({ actions: [] }, { focusState: 'idle', awayNotificationsEnabled: false }).rule, 6)
})

test('rule 6 keeps the message in the inbox with only the red dot', () => {
  assert.deepEqual(
    route({ actions: [] }, { focusState: 'idle' }),
    { rule: 6, outlets: ['inbox', 'badge'] },
  )
  assert.deepEqual(
    route({ actions: ['done'] }, { focusState: 'away' }),
    { rule: 6, outlets: ['inbox', 'badge'] },
  )
})

test('rule 6 does not match during active focus', () => {
  const decision = route({ actions: [] }, { focusState: 'active' })
  assert.equal(decision.rule, 4)
  assert.ok(!decision.outlets.includes('badge'))
})

test('rules are matched top to bottom and the first match wins', () => {
  assert.equal(route({}, { fullscreen: true, panelFocused: true }).rule, 1)
  assert.equal(route({}, { panelFocused: true, focusState: 'active' }).rule, 2)
  assert.equal(
    route({ actions: ['done'] }, { panelFocused: false, focusState: 'active' }).rule,
    3,
  )
})

// ── Harness ─────────────────────────────────────────────────────────────────

type FakeLogger = {
  logger: Logger
  errors: Array<{ message: string; meta?: Record<string, unknown> }>
}

function createFakeLogger(): FakeLogger {
  const errors: FakeLogger['errors'] = []
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message: string, meta?: Record<string, unknown>) => {
      errors.push({ message, meta })
    },
    child: () => logger,
  }
  return { logger, errors }
}

function createInbox(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-proactive-'))
  let current = START
  const store = createProactiveInboxStore({
    getStorePath: () => path.join(directory, 'proactive-inbox.json'),
    now: () => current,
  })
  t.after(async () => {
    await store.flush()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return {
    store,
    advance: (ms: number) => {
      current += ms
    },
  }
}

// ── Inbox retention and dedupe ──────────────────────────────────────────────

test('inbox keeps exactly 100 entries and drops the oldest on the 101st', async (t) => {
  const { store } = createInbox(t)

  for (let index = 0; index < 100; index += 1) {
    store.upsert(makeMessage({ id: `msg-${index}`, createdAt: START + index }))
  }
  let snapshot = store.list()
  assert.equal(snapshot.entries.length, 100)
  assert.equal(snapshot.entries[0]?.id, 'msg-99')

  store.upsert(makeMessage({ id: 'msg-100', createdAt: START + 1_000 }))
  snapshot = store.list()
  assert.equal(snapshot.entries.length, 100)
  assert.equal(snapshot.entries[0]?.id, 'msg-100')
  assert.ok(!snapshot.entries.some((entry) => entry.id === 'msg-0'))
})

test('inbox keeps an entry exactly 30 days old and prunes anything older', async (t) => {
  const { store } = createInbox(t)

  store.upsert(makeMessage({ id: 'exactly-30d', createdAt: START - 30 * DAY_MS }))
  store.upsert(makeMessage({ id: 'just-under', createdAt: START - 30 * DAY_MS + 1 }))
  store.upsert(makeMessage({ id: 'just-over', createdAt: START - 30 * DAY_MS - 1 }))

  const ids = store.list().entries.map((entry) => entry.id)
  assert.deepEqual(ids, ['just-under', 'exactly-30d'])
})

test('inbox prunes an entry once expiresAt is in the past', async (t) => {
  const { store } = createInbox(t)

  store.upsert(makeMessage({ id: 'expired', expiresAt: START - 1 }))
  store.upsert(makeMessage({ id: 'live', expiresAt: START + DAY_MS }))

  const ids = store.list().entries.map((entry) => entry.id)
  assert.deepEqual(ids, ['live'])
})

test('prune reports removed ids and the refreshed count for age-based retention', async (t) => {
  const { store, advance } = createInbox(t)

  store.upsert(makeMessage({ id: 'old', createdAt: START - 29 * DAY_MS }))
  store.upsert(makeMessage({ id: 'new', createdAt: START }))
  assert.equal(store.list().unreadCount, 2)

  advance(2 * DAY_MS)
  const mutation = store.prune()

  assert.equal(mutation.changed, true)
  assert.deepEqual(mutation.removedIds, ['old'])
  assert.equal(mutation.unreadCount, 1)
  assert.deepEqual(store.list().entries.map((entry) => entry.id), ['new'])
})

test('prune reports removed ids and the refreshed count for expiresAt', async (t) => {
  const { store, advance } = createInbox(t)

  store.upsert(makeMessage({ id: 'expired', expiresAt: START + 1_000 }))
  store.upsert(makeMessage({ id: 'live', expiresAt: START + DAY_MS }))
  assert.equal(store.list().unreadCount, 2)

  advance(2_000)
  const mutation = store.prune()

  assert.equal(mutation.changed, true)
  assert.deepEqual(mutation.removedIds, ['expired'])
  assert.equal(mutation.unreadCount, 1)
})

test('list reports the entries its read-time prune removed', async (t) => {
  const { store, advance } = createInbox(t)

  store.upsert(makeMessage({ id: 'old', createdAt: START - 29 * DAY_MS }))
  store.upsert(makeMessage({ id: 'new', createdAt: START }))
  advance(2 * DAY_MS)

  const snapshot = store.list()

  assert.deepEqual(snapshot.removedIds, ['old'])
  assert.equal(snapshot.unreadCount, 1)
  assert.deepEqual(snapshot.entries.map((entry) => entry.id), ['new'])
})

test('re-delivering the same id updates in place without growing the inbox', async (t) => {
  const { store } = createInbox(t)

  store.upsert(makeMessage({ title: 'first title' }))
  const mutation = store.upsert(makeMessage({ title: 'second title' }))

  const snapshot = store.list()
  assert.equal(snapshot.entries.length, 1)
  assert.equal(snapshot.entries[0]?.title, 'second title')
  assert.equal(snapshot.unreadCount, 1)
  assert.equal(mutation.entries.length, 1)
})

test('re-delivering a done entry keeps it done and leaves the unread count alone', async (t) => {
  const { store } = createInbox(t)

  store.upsert(makeMessage())
  assert.equal(store.setStatus('msg-1', 'done').unreadCount, 0)

  const mutation = store.upsert(makeMessage({ title: 're-delivered' }))

  assert.equal(mutation.entries[0]?.status, 'done')
  assert.equal(mutation.entries[0]?.title, 're-delivered')
  assert.equal(mutation.unreadCount, 0)
  assert.equal(store.list().entries[0]?.status, 'done')
})

test('re-delivering a dismissed entry keeps it dismissed and leaves the unread count alone', async (t) => {
  const { store } = createInbox(t)

  store.upsert(makeMessage())
  assert.equal(store.setStatus('msg-1', 'dismissed').unreadCount, 0)

  const mutation = store.upsert(makeMessage({ title: 're-delivered' }))

  assert.equal(mutation.entries[0]?.status, 'dismissed')
  assert.equal(mutation.entries[0]?.title, 're-delivered')
  assert.equal(mutation.unreadCount, 0)
  assert.equal(store.list().entries[0]?.status, 'dismissed')
})

// ── Badge count ─────────────────────────────────────────────────────────────

test('badge counts actionable unread messages and ignores companionship lines', async (t) => {
  const { store } = createInbox(t)

  store.upsert(makeMessage({ id: 'actionable', actions: ['done'] }))
  store.upsert(makeMessage({ id: 'companion', actions: [], priority: 'normal' }))
  store.upsert(makeMessage({ id: 'quiet-high', actions: [], priority: 'high' }))

  assert.equal(store.list().unreadCount, 2)
})

test('badge drops a message when its status becomes done or dismissed', async (t) => {
  const { store } = createInbox(t)

  store.upsert(makeMessage({ id: 'one' }))
  store.upsert(makeMessage({ id: 'two' }))
  assert.equal(store.list().unreadCount, 2)

  assert.equal(store.setStatus('one', 'done').unreadCount, 1)
  assert.equal(store.setStatus('two', 'dismissed').unreadCount, 0)
})

test('badge count drops when a prune removes an unread entry', async (t) => {
  const { store, advance } = createInbox(t)

  store.upsert(makeMessage({ id: 'old', createdAt: START - 29 * DAY_MS }))
  store.upsert(makeMessage({ id: 'new', createdAt: START }))
  assert.equal(store.list().unreadCount, 2)

  advance(2 * DAY_MS)
  const mutation = store.setStatus('new', 'unread')
  assert.deepEqual(mutation.removedIds, ['old'])
  assert.equal(mutation.unreadCount, 1)
})

// ── Outlets and router ──────────────────────────────────────────────────────

test('a throwing outlet does not stop the others and logs exactly once', async () => {
  const { logger, errors } = createFakeLogger()
  const outlets = createProactiveOutletRegistry({ logger })
  const delivered: string[] = []

  outlets.register('inbox', () => {
    throw new Error('inbox store unavailable')
  })
  outlets.register('badge', (_message, state: DeliveryState) => {
    delivered.push(`badge:${state.unreadCount}`)
  })

  const router = createProactiveRouter({ outlets })
  const decision = await router.deliver(makeMessage({ actions: [] }), makeContext({ fullscreen: true }))
  assert.equal(decision.rule, 1)

  assert.deepEqual(delivered, ['badge:0'])
  assert.equal(errors.length, 1)
  assert.match(errors[0]!.message, /outlet=inbox/)
  assert.match(errors[0]!.message, /NEXUS_ERR_PROACTIVE_OUTLET_FAILED/)
  assert.equal(errors[0]!.meta?.source, 'reminder')
})

test('routing to an unregistered outlet does not throw and still fills the inbox', async (t) => {
  const { store } = createInbox(t)
  const { logger } = createFakeLogger()
  const outlets = createProactiveOutletRegistry({ logger })
  outlets.register('inbox', (message) => {
    store.upsert(message)
  })
  const router = createProactiveRouter({ outlets })

  const panelDecision = await router.deliver(makeMessage({ id: 'panel' }), makeContext({ panelFocused: true }))
  const osDecision = await router.deliver(
    makeMessage({ id: 'os' }),
    makeContext({ focusState: 'idle', awayNotificationsEnabled: true }),
  )

  assert.deepEqual(panelDecision.outlets, ['inbox', 'panel'])
  assert.deepEqual(osDecision.outlets, ['inbox', 'os_notification'])
  assert.deepEqual(
    store.list().entries.map((entry) => entry.id).sort(),
    ['os', 'panel'],
  )
  assert.equal(await outlets.dispatch('made-up-outlet', makeMessage(), {
    unreadCount: 0,
    entries: [],
    removedIds: [],
    changed: false,
    published: false,
  }), false)
})

test('a reminder routed to the strip never produces a bubble', async (t) => {
  const { store } = createInbox(t)
  const { logger } = createFakeLogger()
  const outlets = createProactiveOutletRegistry({ logger })
  const presented: string[] = []
  outlets.register('inbox', (message) => {
    store.upsert(message)
  })
  outlets.register('bubble', () => {
    presented.push('bubble')
  })
  outlets.register('strip', () => {
    presented.push('strip')
  })
  const router = createProactiveRouter({ outlets })

  const decision = await router.deliver(makeMessage({ source: 'reminder' }), makeContext())

  assert.equal(decision.rule, 3)
  assert.deepEqual(presented, ['strip'])
  assert.equal(store.list().entries.length, 1)
})

test('a mirror outlet receives every delivery without a model or rule change', async (t) => {
  const { store } = createInbox(t)
  const { logger, errors } = createFakeLogger()
  const outlets = createProactiveOutletRegistry({ logger })
  outlets.register('inbox', (message) => {
    store.upsert(message)
  })
  const received: string[] = []
  outlets.register('bridge', (message) => {
    received.push(message.id)
  }, { mirror: () => true })
  const router = createProactiveRouter({ outlets })

  const message = makeMessage({ id: 'bridged', actions: [] })
  const decision = await router.deliver(message, makeContext())

  assert.equal(decision.rule, 4)
  assert.deepEqual(decision.outlets, ['inbox', 'bubble'])
  assert.deepEqual(received, ['bridged'])
  assert.equal(store.list().entries.length, 1)
  assert.equal(errors.length, 0)
})

test('a mirror predicate that does not accept the message keeps the outlet silent', async (t) => {
  const { store } = createInbox(t)
  const { logger } = createFakeLogger()
  const outlets = createProactiveOutletRegistry({ logger })
  outlets.register('inbox', (message) => {
    store.upsert(message)
  })
  const received: string[] = []
  outlets.register('bridge', (message) => {
    received.push(message.id)
  }, { mirror: (message) => message.source === 'letter' })
  const router = createProactiveRouter({ outlets })

  await router.deliver(makeMessage({ id: 'reminder' }), makeContext())
  await router.deliver(makeMessage({ id: 'letter', source: 'letter' }), makeContext())

  assert.deepEqual(received, ['letter'])
})

test('a mirror outlet that is also routed runs once', async (t) => {
  const { store } = createInbox(t)
  const { logger } = createFakeLogger()
  const outlets = createProactiveOutletRegistry({ logger })
  let calls = 0
  outlets.register('inbox', (message) => {
    calls += 1
    store.upsert(message)
  }, { mirror: () => true })
  const router = createProactiveRouter({ outlets })

  await router.deliver(makeMessage({ actions: [] }), makeContext())

  assert.equal(calls, 1)
})

test('a throwing mirror outlet is logged once and does not stop the others', async (t) => {
  const { store } = createInbox(t)
  const { logger, errors } = createFakeLogger()
  const outlets = createProactiveOutletRegistry({ logger })
  const delivered: string[] = []
  outlets.register('inbox', (message) => {
    store.upsert(message)
    delivered.push('inbox')
  })
  outlets.register('badge', () => {
    delivered.push('badge')
  })
  outlets.register('bridge', () => {
    throw new Error('bridge unavailable')
  }, { mirror: () => true })
  outlets.register('archive', () => {
    delivered.push('archive')
  }, { mirror: () => true })
  const router = createProactiveRouter({ outlets })

  await router.deliver(makeMessage({ actions: [] }), makeContext({ fullscreen: true }))

  assert.deepEqual(delivered, ['inbox', 'badge', 'archive'])
  assert.equal(errors.length, 1)
  assert.match(errors[0]!.message, /outlet=bridge/)
})

test('badge label hides zero, prints 1..99, and caps above 99', () => {
  assert.equal(formatProactiveUnreadBadge(0), null)
  assert.equal(formatProactiveUnreadBadge(1), '1')
  assert.equal(formatProactiveUnreadBadge(42), '42')
  assert.equal(formatProactiveUnreadBadge(99), '99')
  assert.equal(formatProactiveUnreadBadge(100), '99+')
  assert.equal(formatProactiveUnreadBadge(1_000), '99+')
  assert.equal(formatProactiveUnreadBadge(-3), null)
})

// ── Payload schema ──────────────────────────────────────────────────────────

test('delivery payload schema enforces the 80/160 character budgets', () => {
  const base = {
    message: { ...makeMessage(), title: 'a'.repeat(80), body: 'b'.repeat(160) },
    context: makeContext(),
  }
  assert.equal(validateProactiveDeliveryPayload(base).message.title.length, 80)

  assert.throws(() => validateProactiveDeliveryPayload({
    ...base,
    message: { ...base.message, title: 'a'.repeat(81) },
  }))
  assert.throws(() => validateProactiveDeliveryPayload({
    ...base,
    message: { ...base.message, body: 'b'.repeat(161) },
  }))
})

test('delivery payload schema keeps a null system DND reading null', () => {
  const payload = validateProactiveDeliveryPayload({
    message: makeMessage(),
    context: makeContext({ systemDnd: null }),
  })
  assert.equal(payload.context.systemDnd, null)
})

test('delivery payload schema rejects unknown fields and bad enums', () => {
  const base = { message: makeMessage(), context: makeContext() }
  assert.throws(() => validateProactiveDeliveryPayload({
    ...base,
    message: { ...makeMessage(), extra: true },
  }))
  assert.throws(() => validateProactiveDeliveryPayload({
    ...base,
    context: { ...makeContext(), extra: true },
  }))
  assert.throws(() => validateProactiveDeliveryPayload({
    ...base,
    context: { ...makeContext(), focusState: 'sleeping' },
  }))
  assert.throws(() => validateProactiveDeliveryPayload({
    ...base,
    message: { ...makeMessage(), actions: ['explode'] },
  }))
})

test('inbox update schema accepts only the three statuses', () => {
  assert.deepEqual(validateInboxUpdatePayload({ id: 'msg-1', status: 'done' }), {
    id: 'msg-1',
    status: 'done',
  })
  assert.equal(validateInboxUpdatePayload({ id: 'msg-1', status: 'dismissed' }).status, 'dismissed')
  assert.throws(() => validateInboxUpdatePayload({ id: 'msg-1', status: 'archived' }))
  assert.throws(() => validateInboxUpdatePayload({ id: '', status: 'done' }))
})
