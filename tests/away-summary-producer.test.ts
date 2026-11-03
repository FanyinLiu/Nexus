/**
 * Away-summary producer tests.
 *
 * The helper counts only aggregate inbox state, the scheduler drives the real
 * poll body, and the final case runs the produced message through the real
 * main-process delivery pieces to prove the toast shows a count while the
 * inbox never stores `summaryCount`.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import { createProactiveIpc } from '../electron/ipc/proactiveIpc.js'
import { createProactiveInboxStore, PROACTIVE_INBOX_FILE_NAME } from '../electron/services/proactiveInboxStore.js'
import type { Logger } from '../electron/logger.js'
import type { DeliveryContext, DeliveryDecision, ProactiveMessage } from '../shared/proactiveDelivery.js'
import {
  buildAwaySummaryMessage,
  countAwaySummaryItems,
} from '../src/features/proactive/awaySummary.ts'
import type { AwaySummaryEntry } from '../src/features/proactive/awaySummary.ts'
import { runAwayNotificationTick } from '../src/hooks/useAwayNotificationScheduler.ts'
import type { AppSettings, ChatMessage } from '../src/types/index.ts'

const NOW = new Date(2026, 0, 2, 14, 0, 0).getTime()
const HOUR_MS = 60 * 60 * 1000
const LAST_USER_ACTIVITY = NOW - 3 * HOUR_MS

function entry(overrides: Partial<AwaySummaryEntry> = {}): AwaySummaryEntry {
  return {
    status: 'unread',
    source: 'reminder',
    createdAt: LAST_USER_ACTIVITY + 1000,
    ...overrides,
  }
}

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    companionRelationshipType: 'open_ended',
    proactiveAwayNotificationsEnabled: true,
    proactiveAwayNotificationThresholdMinutes: 120,
    proactiveQuietHoursStart: 2,
    proactiveQuietHoursEnd: 3,
    proactiveFrequency: 'normal',
    proactiveReminderStripEnabled: true,
    contextAwarenessEnabled: false,
    activeWindowContextEnabled: false,
    companionAwarenessPaused: false,
    ...overrides,
  } as AppSettings
}

function makeMessages(lastUserAt = LAST_USER_ACTIVITY): ChatMessage[] {
  return [
    {
      id: 'm1',
      role: 'user',
      content: 'hello',
      createdAt: new Date(lastUserAt).toISOString(),
    } as ChatMessage,
  ]
}

// ── Counting rules ──────────────────────────────────────────────────────────

test('only unread, non-away entries at or after the activity instant are counted', () => {
  const entries = [
    entry({ createdAt: LAST_USER_ACTIVITY }),
    entry({ createdAt: LAST_USER_ACTIVITY + 5, source: 'open_arc' }),
    entry({ status: 'read' }),
    entry({ status: 'done' }),
    entry({ status: 'dismissed' }),
    entry({ source: 'away' }),
    entry({ createdAt: LAST_USER_ACTIVITY - 1 }),
  ]

  assert.equal(countAwaySummaryItems(entries, LAST_USER_ACTIVITY), 2)
})

test('a missing or non-finite since instant counts nothing', () => {
  const entries = [entry(), entry()]

  for (const since of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined as unknown as number]) {
    assert.equal(countAwaySummaryItems(entries, since), 0, String(since))
  }
  assert.equal(countAwaySummaryItems(entries, 0), 2)
  assert.equal(countAwaySummaryItems(null, LAST_USER_ACTIVITY), 0)
})

test('the count is capped at 999', () => {
  const entries = Array.from({ length: 1200 }, () => entry())
  assert.equal(countAwaySummaryItems(entries, LAST_USER_ACTIVITY), 999)
})

test('entries with a bad timestamp never count', () => {
  assert.equal(countAwaySummaryItems([
    entry({ createdAt: Number.NaN }),
    entry({ createdAt: Number.POSITIVE_INFINITY }),
  ], LAST_USER_ACTIVITY), 0)
})

// ── Message shape ───────────────────────────────────────────────────────────

test('the away summary is count-only and carries the existing away copy', () => {
  const message = buildAwaySummaryMessage({
    title: 'Nexus is thinking of you',
    body: 'Stop by when you have a moment.',
    summaryCount: 3,
    firedAtMs: NOW,
  })

  assert.equal(message.id, `away:summary:${NOW}`)
  assert.equal(message.source, 'away')
  assert.equal(message.kind, 'away')
  assert.equal(message.priority, 'normal')
  assert.equal(message.title, 'Nexus is thinking of you')
  assert.equal(message.body, 'Stop by when you have a moment.')
  assert.deepEqual(message.actions, [])
  assert.equal(message.summaryCount, 3)
  assert.equal(message.createdAt, NOW)
  assert.equal('fullBody' in message, false)
})

test('the summary count is bounded and integer-normalized in the message', () => {
  const build = (summaryCount: number) => buildAwaySummaryMessage({
    title: 't',
    body: 'b',
    summaryCount,
    firedAtMs: NOW,
  }).summaryCount

  assert.equal(build(1000), 999)
  assert.equal(build(-4), 0)
  assert.equal(build(3.9), 3)
  assert.equal(build(Number.NaN), 0)
})

test('item text can never enter the message because the builder only accepts a count', () => {
  const secret = 'the parcel is at the door'
  const entries = [entry({ source: 'reminder' }), entry({ source: 'open_arc' })]
  const count = countAwaySummaryItems(entries, LAST_USER_ACTIVITY)
  const message = buildAwaySummaryMessage({
    title: 'Nexus is thinking of you',
    body: 'Stop by when you have a moment.',
    summaryCount: count,
    firedAtMs: NOW,
  })

  assert.equal(message.summaryCount, 2)
  assert.equal(`${message.title} ${message.body}`.includes(secret), false)
  assert.equal(JSON.stringify(message).includes(secret), false)
})

// ── Scheduler flow ──────────────────────────────────────────────────────────

type DeliveryCall = {
  message: ProactiveMessage
  context: DeliveryContext
  preferences: { stripEnabled?: boolean }
}

function makeTickBridge(options: {
  entries?: readonly AwaySummaryEntry[] | null
  listError?: Error
  deliver?: (call: DeliveryCall) => Promise<DeliveryDecision>
  notifications?: Array<{ title: string; body: string }>
}) {
  const notifications = options.notifications ?? []
  return {
    notifications,
    bridge: {
      listInbox: async () => {
        if (options.listError) throw options.listError
        return { entries: options.entries ?? [] }
      },
      ...(options.deliver ? { deliver: options.deliver } : {}),
      showNotification: async (payload: { title: string; body: string }) => {
        notifications.push(payload)
      },
    },
  }
}

test('count > 0 delivers exactly one routed summary and skips the old ping', async () => {
  const deliveries: DeliveryCall[] = []
  const saved: number[] = []
  const { notifications, bridge } = makeTickBridge({
    entries: [entry(), entry({ source: 'open_arc' }), entry({ source: 'capsule' })],
    deliver: async (call) => {
      deliveries.push(call)
      return { rule: 5, outlets: ['inbox', 'os_notification'] }
    },
  })

  await runAwayNotificationTick({
    settings: makeSettings(),
    messages: makeMessages(),
    panelOpen: false,
    focusState: 'idle',
    now: NOW,
    loadLastFiredMs: () => null,
    saveLastFiredMs: (ms) => { saved.push(ms) },
    bridge,
  })

  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0]?.message.source, 'away')
  assert.equal(deliveries[0]?.message.summaryCount, 3)
  assert.equal(deliveries[0]?.context.stripEnabled, true)
  assert.equal(deliveries[0]?.preferences.stripEnabled, true)
  assert.equal(notifications.length, 0, 'the old ping must not run as well')
  assert.equal(saved.length, 1)
})

test('count 0 keeps the old ping and never delivers a summary', async () => {
  const deliveries: DeliveryCall[] = []
  const saved: number[] = []
  const { notifications, bridge } = makeTickBridge({
    entries: [entry({ status: 'read' })],
    deliver: async (call) => {
      deliveries.push(call)
      return { rule: 4, outlets: ['inbox', 'bubble'] }
    },
  })

  await runAwayNotificationTick({
    settings: makeSettings(),
    messages: makeMessages(),
    panelOpen: false,
    focusState: 'active',
    now: NOW,
    loadLastFiredMs: () => null,
    saveLastFiredMs: (ms) => { saved.push(ms) },
    bridge,
  })

  assert.equal(deliveries.length, 0)
  assert.equal(notifications.length, 1)
  assert.equal(saved.length, 1)
})

test('no user message sends nothing and never reads the inbox', async () => {
  const deliveries: DeliveryCall[] = []
  const notifications: Array<{ title: string; body: string }> = []
  let listCalls = 0
  const bridge = {
    listInbox: async () => {
      listCalls += 1
      return { entries: [entry(), entry(), entry()] }
    },
    deliver: async (call: DeliveryCall) => {
      deliveries.push(call)
      return { rule: 4, outlets: ['inbox', 'bubble'] }
    },
    showNotification: async (payload: { title: string; body: string }) => {
      notifications.push(payload)
    },
  }

  await runAwayNotificationTick({
    settings: makeSettings(),
    messages: [],
    panelOpen: false,
    focusState: 'active',
    now: NOW,
    loadLastFiredMs: () => null,
    saveLastFiredMs: () => {},
    bridge,
  })

  assert.equal(listCalls, 0, 'an unknown activity window must not read the inbox')
  assert.equal(deliveries.length, 0)
  assert.equal(notifications.length, 0, 'no activity window means the decision cannot fire')
})

test('an unreadable inbox keeps the old ping and never delivers', async () => {
  const deliveries: DeliveryCall[] = []
  const saved: number[] = []
  const { notifications, bridge } = makeTickBridge({
    listError: new Error('inbox down'),
    deliver: async (call) => {
      deliveries.push(call)
      return { rule: 4, outlets: ['inbox', 'bubble'] }
    },
  })

  await runAwayNotificationTick({
    settings: makeSettings(),
    messages: makeMessages(),
    panelOpen: false,
    focusState: 'active',
    now: NOW,
    loadLastFiredMs: () => null,
    saveLastFiredMs: (ms) => { saved.push(ms) },
    bridge,
  })

  assert.equal(deliveries.length, 0)
  assert.equal(notifications.length, 1)
  assert.equal(saved.length, 1)
})

test('a throwing router bridge falls back to one old ping', async () => {
  const saved: number[] = []
  const { notifications, bridge } = makeTickBridge({
    entries: [entry(), entry()],
    deliver: async () => { throw new Error('router down') },
  })

  await runAwayNotificationTick({
    settings: makeSettings(),
    messages: makeMessages(),
    panelOpen: false,
    focusState: 'active',
    now: NOW,
    loadLastFiredMs: () => null,
    saveLastFiredMs: (ms) => { saved.push(ms) },
    bridge,
  })

  assert.equal(notifications.length, 1)
  assert.equal(saved.length, 1)
})

test('a missing router bridge keeps the old ping', async () => {
  const saved: number[] = []
  const { notifications, bridge } = makeTickBridge({
    entries: [entry(), entry()],
  })

  await runAwayNotificationTick({
    settings: makeSettings(),
    messages: makeMessages(),
    panelOpen: false,
    focusState: 'active',
    now: NOW,
    loadLastFiredMs: () => null,
    saveLastFiredMs: (ms) => { saved.push(ms) },
    bridge,
  })

  assert.equal(notifications.length, 1)
  assert.equal(saved.length, 1)
})

// ── End to end through the real main pieces ─────────────────────────────────

type Notification = { title: string; body?: string; onClick?: () => void }

function createTempDir(t: TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-away-summary-'))
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return directory
}

function createCaptureLogger(): Logger {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  }
  return logger
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

test('the produced away summary reaches the OS toast as a count and is stored without it', async (t) => {
  const directory = createTempDir(t)
  const store = createProactiveInboxStore({
    getStorePath: () => path.join(directory, PROACTIVE_INBOX_FILE_NAME),
    now: () => NOW,
  })
  const notifications: Notification[] = []
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()

  createProactiveIpc({
    ipcMain: {
      handle(channel, listener) {
        handlers.set(channel, listener)
      },
    },
    getAllWindows: () => [],
    getWindowCapability: () => 'unknown',
    requireTrustedSender: () => {},
    inbox: store,
    logger: createCaptureLogger(),
    setInterval: () => ({ unref: () => {} }),
    clearInterval: () => {},
    strip: {
      show: () => true,
      withdraw: () => true,
      withdrawAll: () => {},
    },
    getStripLabels: () => ({ done: 'Done', snooze: 'Snooze', open: 'Open' }),
    showOsNotification: (payload: Notification) => {
      notifications.push(payload)
      return true
    },
    isPanelFocused: () => false,
  })

  const message = buildAwaySummaryMessage({
    title: 'Nexus is thinking of you',
    body: 'Stop by when you have a moment.',
    summaryCount: 3,
    firedAtMs: NOW,
  })

  const handler = handlers.get('proactive:deliver')
  assert.ok(handler, 'missing proactive:deliver handler')
  const decision = await handler({ trusted: true }, {
    message,
    context: makeContext(),
  })
  assert.deepEqual(decision, { rule: 5, outlets: ['inbox', 'os_notification'] })

  assert.equal(notifications.length, 1)
  assert.equal(notifications[0]?.title, message.title)
  assert.equal(notifications[0]?.body, 'While you were away, she noted 3 things.')

  const stored = store.list().entries
  assert.equal(stored.length, 1)
  assert.equal(stored[0]?.id, message.id)
  assert.equal(Object.hasOwn(stored[0]!, 'summaryCount'), false)

  assert.equal(await store.flush(), true)
  const persisted = fs.readFileSync(path.join(directory, PROACTIVE_INBOX_FILE_NAME), 'utf8')
  assert.equal(persisted.includes('summaryCount'), false)
  assert.equal(persisted.includes(message.id), true)
})
