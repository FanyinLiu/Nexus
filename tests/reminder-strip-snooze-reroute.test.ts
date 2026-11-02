import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'

import { createProactiveIpc } from '../electron/ipc/proactiveIpc.js'
import { createProactiveInboxStore } from '../electron/services/proactiveInboxStore.js'
import { createReminderStripSession } from '../electron/services/reminderStripSession.js'
import { REMINDER_STRIP_SNOOZE_MS } from '../electron/services/reminderStripQueue.js'
import type { Logger } from '../electron/logger.js'
import type { DeliveryContext, ProactiveMessage } from '../shared/proactiveDelivery.js'

const NOW = 1_700_000_000_000
const FILE_NAME = 'proactive-inbox.json'
const LABELS = { done: 'Done', snooze: 'Snooze 10 min', open: 'Open chat' }

type StripPayload = {
  id: string
  title: string
  body: string
  labels: typeof LABELS
}

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
    focusState: 'active',
    inQuietHours: false,
    systemDnd: null,
    awayNotificationsEnabled: false,
    stripEnabled: true,
    ...overrides,
  }
}

function createTempDir(t: TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-reminder-strip-reroute-'))
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return directory
}

type Warning = { message: string; meta?: Record<string, unknown> }

function createFakeLogger(warnings: Warning[]): Logger {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (message, meta) => {
      warnings.push({ message, meta })
    },
    error: () => {},
    child: () => logger,
  }
  return logger
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

type Handler = (event: unknown, payload?: unknown) => unknown
type SentMessage = { channel: string; payload: unknown }

function createHarness(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const directory = createTempDir(t)
  const store = createProactiveInboxStore({
    getStorePath: () => path.join(directory, FILE_NAME),
    now: () => NOW,
  })
  const handlers = new Map<string, Handler>()
  const sent: SentMessage[] = []
  const shown: StripPayload[] = []
  const withdrawn: string[] = []
  const notifications: Array<{ title: string; body: string }> = []
  const warnings: Warning[] = []
  const queueSnapshots: Array<{ items: Array<{ id: string }> }> = []

  let context: DeliveryContext = makeContext()
  let contextShouldThrow = false
  let configured: {
    onAction: (action: string, id: string) => void
    canReshow: (id: string) => boolean | Promise<boolean>
  } | null = null
  let session: ReturnType<typeof createReminderStripSession> | null = null

  const strip = {
    show: (payload: StripPayload) => {
      shown.push(payload)
      session?.show(payload)
      return true
    },
    withdraw: (id: string) => {
      withdrawn.push(id)
      return session?.withdraw(id) ?? false
    },
    withdrawAll: () => {
      session?.withdrawAll()
    },
    configure: (dependencies: NonNullable<typeof configured>) => {
      configured = dependencies
    },
  }

  const windows = [{
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        sent.push({ channel, payload })
      },
    },
  }]

  const ipc = createProactiveIpc({
    ipcMain: {
      handle(channel: string, listener: Handler) {
        handlers.set(channel, listener)
      },
    },
    getAllWindows: () => windows,
    getWindowCapability: () => 'pet',
    requireTrustedSender: () => {},
    inbox: store,
    logger: createFakeLogger(warnings),
    setInterval: () => ({ unref: () => {} }),
    clearInterval: () => {},
    strip,
    getStripLabels: () => LABELS,
    showOsNotification: (payload) => {
      notifications.push(payload)
    },
    isPanelFocused: () => false,
    getDeliveryContext: async () => {
      if (contextShouldThrow) throw new Error('context unavailable')
      return context
    },
  })
  t.after(() => ipc.stopPrune())

  assert.ok(configured)
  const dependencies = configured
  session = createReminderStripSession({
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    snoozeMs: REMINDER_STRIP_SNOOZE_MS,
    onQueueChange: (snapshot) => queueSnapshots.push(snapshot),
    onAction: (action, item) => dependencies.onAction(action, item.id),
    canReshow: (id) => dependencies.canReshow(id),
  })
  const activeSession = session

  return {
    store,
    sent,
    shown,
    withdrawn,
    notifications,
    warnings,
    queueSnapshots,
    session: activeSession,
    async deliver(message: ProactiveMessage) {
      const handler = handlers.get('proactive:deliver')
      assert.ok(handler, 'missing proactive:deliver handler')
      return await handler({ trusted: true }, { message, context: makeContext() })
    },
    setContext(next: Partial<DeliveryContext>) {
      context = { ...context, ...next }
    },
    failContextRead() {
      contextShouldThrow = true
    },
    changes: () => sent.filter((item) => item.channel === 'inbox:changed').map((item) => item.payload),
    presentations: () => sent.filter((item) => item.channel === 'proactive:present').map((item) => item.payload),
  }
}

function inboxStatus(store: ReturnType<typeof createProactiveInboxStore>, id: string) {
  return store.list().entries.find((entry) => entry.id === id)?.status
}

function snooze(harness: ReturnType<typeof createHarness>, id: string) {
  assert.deepEqual(harness.session.handleAction({ id, action: 'snooze' }), { ok: true })
}

test('a fullscreen re-route drops the strip item and leaves the inbox untouched', async (t) => {
  const harness = createHarness(t)
  const message = makeMessage()
  await harness.deliver(message)
  assert.equal(harness.shown.length, 1)
  assert.equal(harness.store.list().unreadCount, 1)

  snooze(harness, message.id)
  assert.deepEqual(harness.session.snapshot().items, [])
  harness.sent.length = 0
  harness.notifications.length = 0

  harness.setContext({ fullscreen: true })
  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS)
  await flushAsyncWork()

  assert.deepEqual(harness.session.snapshot().items, [])
  assert.equal(harness.shown.length, 1)
  assert.equal(inboxStatus(harness.store, message.id), 'unread')
  assert.equal(harness.store.list().unreadCount, 1)
  assert.deepEqual(harness.changes(), [])
  assert.deepEqual(harness.presentations(), [])
  assert.deepEqual(harness.notifications, [])
})

test('an active re-route puts the item back on the strip exactly once', async (t) => {
  const harness = createHarness(t)
  const message = makeMessage()
  await harness.deliver(message)
  snooze(harness, message.id)

  harness.setContext({ fullscreen: false, focusState: 'active', inQuietHours: false })
  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS)
  await flushAsyncWork()

  const items = harness.session.snapshot().items
  assert.equal(items.length, 1)
  assert.equal(items[0]?.id, message.id)
  const snapshotsAfterFirstReturn = harness.queueSnapshots.length

  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS)
  await flushAsyncWork()

  assert.equal(harness.session.snapshot().items.length, 1)
  assert.equal(harness.queueSnapshots.length, snapshotsAfterFirstReturn)
  assert.equal(harness.shown.length, 1)
})

test('a quiet-hours re-route drops the strip item and leaves the inbox untouched', async (t) => {
  const harness = createHarness(t)
  const message = makeMessage()
  await harness.deliver(message)
  snooze(harness, message.id)
  harness.sent.length = 0

  harness.setContext({ fullscreen: false, inQuietHours: true })
  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS)
  await flushAsyncWork()

  assert.deepEqual(harness.session.snapshot().items, [])
  assert.equal(harness.shown.length, 1)
  assert.equal(inboxStatus(harness.store, message.id), 'unread')
  assert.equal(harness.store.list().unreadCount, 1)
  assert.deepEqual(harness.changes(), [])
})

test('a failed context read drops the strip item and keeps the inbox entry', async (t) => {
  const harness = createHarness(t)
  const message = makeMessage()
  await harness.deliver(message)
  snooze(harness, message.id)
  harness.sent.length = 0

  harness.failContextRead()
  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS)
  await flushAsyncWork()

  assert.deepEqual(harness.session.snapshot().items, [])
  assert.equal(harness.shown.length, 1)
  assert.equal(inboxStatus(harness.store, message.id), 'unread')
  assert.equal(harness.store.list().unreadCount, 1)
  assert.deepEqual(harness.changes(), [])
  assert.ok(harness.warnings.some((warning) => warning.meta?.status === 'context-failed'))
})
