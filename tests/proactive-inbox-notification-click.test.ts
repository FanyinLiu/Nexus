import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'

import { createProactiveIpc } from '../electron/ipc/proactiveIpc.js'
import { createProactiveInboxStore } from '../electron/services/proactiveInboxStore.js'
import type { Logger } from '../electron/logger.js'
import { inboxStatusAfterInteraction } from '../shared/proactiveInboxReadRule.js'
import type {
  DeliveryContext,
  ProactiveMessage,
} from '../shared/proactiveDelivery.js'

const NOW = 1_700_000_000_000
const FILE_NAME = 'proactive-inbox.json'

function makeMessage(overrides: Partial<ProactiveMessage> = {}): ProactiveMessage {
  return {
    id: 'reminder:task-1:1700000000000',
    source: 'reminder',
    kind: 'reminder_follow_up',
    priority: 'high',
    title: 'Stand up',
    body: 'Time to move',
    actions: ['done', 'snooze', 'open'],
    createdAt: NOW,
    ...overrides,
  }
}

function makeContext(overrides: Partial<DeliveryContext> = {}): DeliveryContext {
  return {
    panelFocused: false,
    fullscreen: false,
    focusState: 'idle',
    inQuietHours: false,
    systemDnd: null,
    awayNotificationsEnabled: true,
    stripEnabled: true,
    ...overrides,
  }
}

function createFakeLogger(): Logger {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  }
  return logger
}

type StripDependencies = {
  onAction: (action: string, id: string) => void
  canReshow: (id: string) => boolean | Promise<boolean>
}

type Handler = (event: unknown, payload?: unknown) => unknown
type SentMessage = { channel: string; payload: unknown }
type Notification = { title: string, body: string, onClick?: () => void }
type Inbox = ReturnType<typeof createProactiveInboxStore>

function createTempDir(t: TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-proactive-notification-click-'))
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  })
  return directory
}

function createHarness(t: TestContext) {
  const directory = createTempDir(t)
  const store = createProactiveInboxStore({
    getStorePath: () => path.join(directory, FILE_NAME),
    now: () => NOW,
  })
  const handlers = new Map<string, Handler>()
  const sent: SentMessage[] = []
  const withdrawn: string[] = []
  const notifications: Notification[] = []
  let configured: StripDependencies | null = null

  const ipc = createProactiveIpc({
    ipcMain: {
      handle(channel: string, listener: Handler) {
        handlers.set(channel, listener)
      },
    },
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: (channel: string, payload: unknown) => {
          sent.push({ channel, payload })
        },
      },
    }],
    getWindowCapability: () => 'pet',
    requireTrustedSender: () => {},
    inbox: store,
    logger: createFakeLogger(),
    setInterval: () => ({ unref: () => {} }),
    clearInterval: () => {},
    strip: {
      show: () => true,
      withdraw: (id: string) => {
        withdrawn.push(id)
        return true
      },
      withdrawAll: () => {},
      configure: (dependencies: StripDependencies) => {
        configured = dependencies
      },
    },
    getStripLabels: () => ({ done: 'Done', snooze: 'Snooze 10 min', open: 'Open chat' }),
    showOsNotification: (payload: Notification) => {
      notifications.push(payload)
      return true
    },
    isPanelFocused: () => false,
  })
  t.after(() => ipc.stopPrune())

  return {
    store,
    withdrawn,
    notifications,
    configured: () => {
      assert.ok(configured)
      return configured
    },
    async deliver(message: ProactiveMessage, context = makeContext()) {
      const handler = handlers.get('proactive:deliver')
      assert.ok(handler, 'missing proactive:deliver handler')
      return await handler({ trusted: true }, { message, context })
    },
    changes: () => sent
      .filter((item) => item.channel === 'inbox:changed')
      .map((item) => item.payload),
  }
}

function inboxStatus(store: Inbox, id: string) {
  return store.list().entries.find((entry) => entry.id === id)?.status
}

function lastNotification(harness: ReturnType<typeof createHarness>): Notification {
  const notification = harness.notifications.at(-1)
  assert.ok(notification, 'expected a notification')
  return notification
}

test('a no-button entry is done by strip open or reply and withdrawn', (t) => {
  for (const action of ['open', 'reply'] as const) {
    const harness = createHarness(t)
    const message = makeMessage({ id: `no-button-${action}`, actions: [] })
    harness.store.upsert(message)
    assert.equal(harness.store.list().unreadCount, 1)

    harness.configured().onAction(action, message.id)

    assert.equal(inboxStatus(harness.store, message.id), 'done')
    assert.equal(harness.store.list().unreadCount, 0)
    assert.deepEqual(harness.changes().at(-1), {
      unreadCount: 0,
      changes: [{ id: message.id, status: 'done' }],
      removedIds: [],
    })
    assert.deepEqual(harness.withdrawn, [message.id])
  }
})

test('strip open on an already-done entry still withdraws the row and publishes nothing', (t) => {
  const harness = createHarness(t)
  const message = makeMessage({ id: 'already-done-strip-open' })
  harness.store.upsert(message)
  harness.store.setStatus(message.id, 'done')

  harness.configured().onAction('open', message.id)

  assert.equal(inboxStatus(harness.store, message.id), 'done')
  assert.equal(harness.store.list().unreadCount, 0)
  assert.deepEqual(harness.changes(), [])
  assert.deepEqual(harness.withdrawn, [message.id])
})

test('strip done on an id missing from the inbox still withdraws the row', (t) => {
  const harness = createHarness(t)
  harness.configured().onAction('done', 'missing-id')

  assert.deepEqual(harness.store.list().entries, [])
  assert.deepEqual(harness.changes(), [])
  assert.deepEqual(harness.withdrawn, ['missing-id'])
})

test('a notification click reads an actionable entry, then strip done/open completes it', async (t) => {
  for (const action of ['done', 'open'] as const) {
    const harness = createHarness(t)
    const message = makeMessage({ id: `actionable-${action}` })
    await harness.deliver(message)
    assert.equal(harness.store.list().unreadCount, 1)

    lastNotification(harness).onClick?.()

    assert.equal(inboxStatus(harness.store, message.id), 'read')
    assert.equal(harness.store.list().unreadCount, 0)
    assert.deepEqual(harness.changes().at(-1), {
      unreadCount: 0,
      changes: [{ id: message.id, status: 'read' }],
      removedIds: [],
    })
    assert.deepEqual(harness.withdrawn, [])

    // A second click is a read -> read no-op: no mutation and no push.
    const changesAfterFirstClick = harness.changes().length
    lastNotification(harness).onClick?.()
    assert.equal(inboxStatus(harness.store, message.id), 'read')
    assert.equal(harness.changes().length, changesAfterFirstClick)
    assert.deepEqual(harness.withdrawn, [])

    harness.configured().onAction(action, message.id)

    assert.equal(inboxStatus(harness.store, message.id), 'done')
    assert.deepEqual(harness.changes().at(-1), {
      unreadCount: 0,
      changes: [{ id: message.id, status: 'done' }],
      removedIds: [],
    })
    assert.deepEqual(harness.withdrawn, [message.id])
  }
})

test('a notification click on a no-button entry marks it done and withdraws it', async (t) => {
  const harness = createHarness(t)
  const message = makeMessage({ id: 'no-button-notification', actions: [] })
  await harness.deliver(message)
  assert.equal(harness.store.list().unreadCount, 1)

  lastNotification(harness).onClick?.()

  assert.equal(inboxStatus(harness.store, message.id), 'done')
  assert.equal(harness.store.list().unreadCount, 0)
  assert.deepEqual(harness.changes().at(-1), {
    unreadCount: 0,
    changes: [{ id: message.id, status: 'done' }],
    removedIds: [],
  })
  assert.deepEqual(harness.withdrawn, [message.id])
})

test('a notification click that only reads or touches a capsule keeps the strip row', async (t) => {
  const readHarness = createHarness(t)
  const actionable = makeMessage({ id: 'notification-read' })
  await readHarness.deliver(actionable)

  lastNotification(readHarness).onClick?.()

  assert.equal(inboxStatus(readHarness.store, actionable.id), 'read')
  assert.deepEqual(readHarness.withdrawn, [])

  const capsuleHarness = createHarness(t)
  const capsule = makeMessage({
    id: 'notification-capsule',
    source: 'capsule',
    kind: 'capsule',
    actions: ['done', 'open'],
  })
  await capsuleHarness.deliver(capsule)
  const changesAfterDelivery = capsuleHarness.changes().length

  lastNotification(capsuleHarness).onClick?.()

  assert.equal(inboxStatus(capsuleHarness.store, capsule.id), 'unread')
  assert.equal(capsuleHarness.changes().length, changesAfterDelivery)
  assert.deepEqual(capsuleHarness.withdrawn, [])
})

test('a notification click on a capsule changes nothing', async (t) => {
  const harness = createHarness(t)
  const message = makeMessage({
    id: 'capsule-notification',
    source: 'capsule',
    kind: 'capsule',
    actions: ['done', 'open'],
  })
  await harness.deliver(message)
  const changesAfterDelivery = harness.changes().length

  lastNotification(harness).onClick?.()

  assert.equal(inboxStatus(harness.store, message.id), 'unread')
  assert.equal(harness.store.list().unreadCount, 1)
  assert.equal(harness.changes().length, changesAfterDelivery)
  assert.deepEqual(harness.withdrawn, [])
})

test('a notification carries only the public copy, never the private body or letter text', async (t) => {
  const cases: ProactiveMessage[] = [
    makeMessage({
      id: 'public-actionable',
      title: 'Private title actionable',
      body: 'PRIVATE BODY actionable',
      fullBody: 'PRIVATE FULL LETTER actionable',
      publicCopy: { title: 'Capsule ready', body: 'Open the letter' },
    }),
    makeMessage({
      id: 'public-no-button',
      actions: [],
      title: 'Private title no-button',
      body: 'PRIVATE BODY no-button',
      fullBody: 'PRIVATE FULL LETTER no-button',
      publicCopy: { title: 'Capsule ready', body: 'Open the letter' },
    }),
    makeMessage({
      id: 'public-capsule',
      source: 'capsule',
      kind: 'capsule',
      actions: [],
      title: 'Private title capsule',
      body: 'PRIVATE BODY capsule',
      fullBody: 'PRIVATE FULL LETTER capsule',
      publicCopy: { title: 'Capsule ready', body: 'Open the letter' },
    }),
  ]

  for (const message of cases) {
    const harness = createHarness(t)
    await harness.deliver(message)
    const notification = lastNotification(harness)

    assert.equal(notification.title, message.publicCopy?.title)
    assert.equal(notification.body, message.publicCopy?.body)
    const serialized = JSON.stringify(notification)
    assert.equal(serialized.includes(message.body), false)
    assert.equal(serialized.includes(message.fullBody ?? ''), false)
    assert.equal(serialized.includes(message.title), false)
  }
})

test('a done entry is never downgraded by a later notification click', async (t) => {
  const harness = createHarness(t)
  const message = makeMessage({ id: 'already-done-notification' })
  harness.store.upsert(message)
  harness.store.setStatus(message.id, 'done')

  await harness.deliver(message)
  const changesAfterDelivery = harness.changes().length

  lastNotification(harness).onClick?.()

  assert.equal(inboxStatus(harness.store, message.id), 'done')
  assert.equal(harness.store.list().unreadCount, 0)
  assert.equal(harness.changes().length, changesAfterDelivery)
  assert.deepEqual(harness.withdrawn, [])
})

for (const status of ['done', 'dismissed'] as const) {
  test(`a ${status} entry is terminal for every strip action and a notification click`, async (t) => {
    const stripActions = ['done', 'open', 'reply', 'snooze'] as const
    for (const action of stripActions) {
      const harness = createHarness(t)
      const message = makeMessage({ id: `${status}-strip-${action}` })
      harness.store.upsert(message)
      harness.store.setStatus(message.id, status)
      const changesAfterStatus = harness.changes().length

      harness.configured().onAction(action, message.id)

      assert.equal(inboxStatus(harness.store, message.id), status, `${action} downgraded ${status}`)
      assert.equal(harness.store.list().unreadCount, 0)
      assert.equal(harness.changes().length, changesAfterStatus, `${action} published a mutation`)
      const expectedWithdrawn = action === 'snooze' ? [] : [message.id]
      assert.deepEqual(harness.withdrawn, expectedWithdrawn, `${action} withdraw mismatch`)
    }

    const harness = createHarness(t)
    const message = makeMessage({ id: `${status}-notification-click` })
    await harness.deliver(message)
    harness.store.setStatus(message.id, status)
    const changesAfterStatus = harness.changes().length

    lastNotification(harness).onClick?.()

    assert.equal(inboxStatus(harness.store, message.id), status, 'the click downgraded a final entry')
    assert.equal(harness.store.list().unreadCount, 0)
    assert.equal(harness.changes().length, changesAfterStatus, 'the click published a mutation')
    assert.deepEqual(harness.withdrawn, [])
  })
}

test('the notification click applies the shared read rule for every entry shape', async (t) => {
  const cases: Array<{ id: string, overrides: Partial<ProactiveMessage> }> = [
    { id: 'rule-actionable', overrides: {} },
    { id: 'rule-no-button', overrides: { actions: [] } },
    {
      id: 'rule-capsule',
      overrides: { source: 'capsule', kind: 'capsule', actions: ['done', 'open'] },
    },
  ]

  for (const { id, overrides } of cases) {
    const harness = createHarness(t)
    const message = makeMessage({ id, ...overrides })
    await harness.deliver(message)

    const expected = inboxStatusAfterInteraction(message, 'notification_click') ?? 'unread'
    lastNotification(harness).onClick?.()

    assert.equal(inboxStatus(harness.store, message.id), expected, id)
  }
})
