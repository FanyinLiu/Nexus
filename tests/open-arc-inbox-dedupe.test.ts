import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import { createProactiveIpc } from '../electron/ipc/proactiveIpc.js'
import { createProactiveInboxStore } from '../electron/services/proactiveInboxStore.js'
import type { Logger } from '../electron/logger.js'
import type {
  DeliveryContext,
  DeliveryDecision,
  ProactiveDeliveryPreferences,
  ProactiveInboxSnapshot,
} from '../shared/proactiveDelivery.js'
import {
  deliverDueOpenArc,
  openArcMessageId,
} from '../src/features/arc/openArcProactiveMessage.ts'
import type {
  DeliverDueOpenArcResult,
  OpenArcDeliveryText,
  OpenArcDeliverBridge,
} from '../src/features/arc/openArcProactiveMessage.ts'
import type { OpenArcRecord } from '../src/features/arc/openArcStore.ts'

const NOW = 1_700_000_000_000
const NEXT_TICK = NOW + 60_000
const AFTER_RESTART = NOW + 10 * 60_000
const FILE_NAME = 'proactive-inbox.json'

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

const PREFERENCES: ProactiveDeliveryPreferences = {
  quietStart: 22,
  quietEnd: 8,
  desktopAwarenessAllowed: true,
  awayNotificationsEnabled: true,
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

type Handler = (event: unknown, payload?: unknown) => unknown

/**
 * One main-process lifetime: a real inbox store over `directory`, the real
 * proactive IPC wiring, and a `deliver` bridge shaped exactly like the preload
 * bridge that `useOpenArcScheduler` passes to `deliverDueOpenArc`.
 */
function createHarness(t: TestContext, directory?: string) {
  const inboxDirectory = directory
    ?? fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-open-arc-dedupe-'))
  if (!directory) {
    t.after(() => {
      fs.rmSync(inboxDirectory, { recursive: true, force: true })
    })
  }

  const store = createProactiveInboxStore({
    getStorePath: () => path.join(inboxDirectory, FILE_NAME),
    now: () => NOW,
  })
  const handlers = new Map<string, Handler>()
  const shown: string[] = []

  const ipc = createProactiveIpc({
    ipcMain: {
      handle(channel: string, listener: Handler) {
        handlers.set(channel, listener)
      },
    },
    getAllWindows: () => [],
    getWindowCapability: () => 'pet',
    // A trusted sender is the only caller the real handlers accept; the fake
    // event mirrors the `{ trusted: true }` event used by the other IPC tests.
    requireTrustedSender: (event) => {
      if ((event as { trusted?: boolean }).trusted !== true) {
        throw new Error('untrusted sender')
      }
    },
    inbox: store,
    logger: createFakeLogger(),
    setInterval: () => ({ unref: () => {} }),
    clearInterval: () => {},
    strip: {
      show: (payload: { id: string }) => {
        shown.push(payload.id)
        return true
      },
      withdraw: () => true,
      withdrawAll: () => {},
    },
    getStripLabels: () => ({ done: 'Done', snooze: 'Snooze 10 min', open: 'Open chat' }),
    showOsNotification: () => {},
    isPanelFocused: () => false,
  })

  let disposed = false
  async function dispose() {
    if (disposed) return
    disposed = true
    ipc.stopPrune()
    // Land the debounced write so a restarted store reads the same file.
    await store.flush()
  }
  t.after(() => dispose())

  async function invoke(channel: string, payload?: unknown): Promise<unknown> {
    const handler = handlers.get(channel)
    assert.ok(handler, `missing handler for ${channel}`)
    return await handler({ trusted: true }, payload)
  }

  return {
    directory: inboxDirectory,
    dispose,
    shown,
    list: async () => await invoke('inbox:list') as ProactiveInboxSnapshot,
    // The renderer bridge calls the REAL `proactive:deliver` handler, which
    // validates the payload, adds main's panel signal, routes with the real
    // router and writes the real inbox store.
    deliver: async (payload: Parameters<OpenArcDeliverBridge>[0]) => (
      await invoke('proactive:deliver', payload) as DeliveryDecision
    ),
  }
}

type Harness = ReturnType<typeof createHarness>

async function deliverMilestone(
  harness: Harness,
  milestoneDay: number,
  now: number,
): Promise<{ result: DeliverDueOpenArcResult; fired: string[] }> {
  const fired: string[] = []
  const result = await deliverDueOpenArc({
    arc: ARC,
    delivery: DELIVERY,
    milestoneDay,
    now,
    useLegacyPath: false,
    deliver: harness.deliver,
    // The legacy path must never run here: the router bridge is available.
    showNotification: async () => {
      assert.fail('legacy notification path ran during a router delivery')
    },
    buildContext: () => makeContext(),
    preferences: PREFERENCES,
    recordCheckInFired: (id) => { fired.push(id) },
    isStopped: () => false,
  })
  return { result, fired }
}

function entryIds(snapshot: ProactiveInboxSnapshot): string[] {
  return snapshot.entries.map((entry) => entry.id)
}

// The id contract is per milestone, not per arc: `openArcMessageId` keys on the
// arc id plus the milestone day, so day 3 and day 5 have distinct ids while a
// repeated day-3 delivery reuses one id. That is what makes the second
// delivery an update instead of a second entry.
test('delivering the same open-arc milestone twice keeps exactly one unread inbox entry', async (t) => {
  const harness = createHarness(t)

  const first = await deliverMilestone(harness, 3, NOW)
  const second = await deliverMilestone(harness, 3, NEXT_TICK)

  assert.deepEqual(first.result, { path: 'router', rule: 3 })
  assert.deepEqual(second.result, { path: 'router', rule: 3 })
  assert.deepEqual(first.fired, [ARC.id])
  assert.deepEqual(second.fired, [ARC.id])
  // Two ticks still point at the same strip item id; main replaces it.
  assert.deepEqual(harness.shown, [openArcMessageId(ARC.id, 3), openArcMessageId(ARC.id, 3)])

  const snapshot = await harness.list()
  assert.equal(snapshot.entries.length, 1)
  assert.deepEqual(entryIds(snapshot), ['open_arc:arc-1:3'])
  assert.equal(snapshot.entries[0]?.status, 'unread')
  assert.equal(snapshot.entries[0]?.origin?.arcId, ARC.id)
  // The red dot counts messages, not deliveries: a re-fire must not double it.
  assert.equal(snapshot.unreadCount, 1)
})

test('a second milestone day of the same arc adds its own distinct inbox entry', async (t) => {
  const harness = createHarness(t)

  await deliverMilestone(harness, 3, NOW)
  await deliverMilestone(harness, 3, NEXT_TICK)
  const third = await deliverMilestone(harness, 5, NEXT_TICK + 60_000)
  assert.deepEqual(third.result, { path: 'router', rule: 3 })

  const snapshot = await harness.list()
  assert.equal(snapshot.entries.length, 2)
  // Per-milestone ids: day 5 is a new entry even though the arc is unchanged.
  assert.deepEqual(entryIds(snapshot).sort(), ['open_arc:arc-1:3', 'open_arc:arc-1:5'])
  for (const entry of snapshot.entries) assert.equal(entry.status, 'unread')
  assert.equal(snapshot.unreadCount, 2)
})

test('a repeated open-arc milestone after an inbox restart still has one entry', async (t) => {
  const beforeRestart = createHarness(t)

  await deliverMilestone(beforeRestart, 3, NOW)
  const before = await beforeRestart.list()
  assert.equal(before.entries.length, 1)
  assert.equal(before.unreadCount, 1)

  // Quit: land the debounced write, stop the sweep, drop this process's store.
  await beforeRestart.dispose()

  // Restart: a brand new store and IPC wiring over the same userData file.
  const afterRestart = createHarness(t, beforeRestart.directory)
  // Reading the inbox first proves the entry survived on disk; otherwise the
  // post-restart count below would be one simply because the file started empty.
  const restored = await afterRestart.list()
  assert.deepEqual(entryIds(restored), ['open_arc:arc-1:3'])
  assert.equal(restored.unreadCount, 1)

  // The second delivery is the re-fire the scheduler would issue after a
  // restart; it must dedupe against the restored entry, not add a second one.
  const replayed = await deliverMilestone(afterRestart, 3, AFTER_RESTART)
  assert.deepEqual(replayed.result, { path: 'router', rule: 3 })

  const snapshot = await afterRestart.list()
  assert.equal(snapshot.entries.length, 1)
  assert.deepEqual(entryIds(snapshot), ['open_arc:arc-1:3'])
  assert.equal(snapshot.entries[0]?.status, 'unread')
  assert.equal(snapshot.unreadCount, 1)
})
