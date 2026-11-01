import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import {
  createProactiveIpc,
} from '../electron/ipc/proactiveIpc.js'
import type { Logger } from '../electron/logger.js'
import type {
  DeliveryContext,
  ProactiveInboxEntry,
  ProactiveInboxSnapshot,
  ProactiveMessage,
} from '../shared/proactiveDelivery.js'

const NOW = 1_700_000_000_000
const PRUNE_INTERVAL_MS = 60 * 60 * 1000

type InboxMutation = {
  changed: boolean
  entries: ProactiveInboxEntry[]
  removedIds: string[]
  unreadCount: number
}

function makeMessage(overrides: Partial<ProactiveMessage> = {}): ProactiveMessage {
  return {
    id: 'msg-1',
    source: 'reminder',
    kind: 'reminder_follow_up',
    priority: 'normal',
    title: 'Stand up',
    body: 'You asked me to remind you.',
    actions: [],
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

function createFakeIpcMain() {
  const handlers = new Map<string, Handler>()
  return {
    ipcMain: {
      handle(channel: string, listener: Handler) {
        handlers.set(channel, listener)
      },
    },
    async invoke(channel: string, event: unknown, payload?: unknown) {
      const handler = handlers.get(channel)
      assert.ok(handler, `missing handler for ${channel}`)
      return await handler(event, payload)
    },
  }
}

function createFakeInbox() {
  const calls = { list: 0, prune: 0, upsert: 0, setStatus: 0, flush: 0, clear: 0 }
  let pruneResult: InboxMutation = {
    changed: false,
    entries: [],
    removedIds: [],
    unreadCount: 0,
  }
  let upsertResult: InboxMutation = {
    changed: false,
    entries: [],
    removedIds: [],
    unreadCount: 0,
  }
  const snapshot: ProactiveInboxSnapshot = { entries: [], unreadCount: 0, removedIds: [] }

  const inbox = {
    list() {
      calls.list += 1
      return snapshot
    },
    prune() {
      calls.prune += 1
      return pruneResult
    },
    upsert() {
      calls.upsert += 1
      return upsertResult
    },
    setStatus() {
      calls.setStatus += 1
      return upsertResult
    },
    async flush() {
      calls.flush += 1
      return true
    },
    async clear() {
      calls.clear += 1
      return true
    },
  }

  return {
    inbox,
    calls,
    setPruneResult(result: InboxMutation) {
      pruneResult = result
    },
    setUpsertResult(result: InboxMutation) {
      upsertResult = result
    },
  }
}

type Capability = 'panel' | 'pet' | 'unknown'

function createWindows(capabilities: Capability[]) {
  const sentByWindow: Array<Array<{ channel: string; payload: unknown }>> = []
  const capabilitiesByWebContents = new Map<object, Capability>()
  const windows = capabilities.map((capability) => {
    const sent: Array<{ channel: string; payload: unknown }> = []
    sentByWindow.push(sent)
    const webContents = {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        sent.push({ channel, payload })
      },
    }
    capabilitiesByWebContents.set(webContents, capability)
    return {
      isDestroyed: () => false,
      webContents,
    }
  })

  return {
    windows,
    sentByWindow,
    getAllWindows: () => windows,
    getWindowCapability: (webContents: unknown) =>
      capabilitiesByWebContents.get(webContents as object) ?? 'unknown',
  }
}

type IntervalClock = {
  setInterval: (callback: () => void, ms: number) => { unref?: () => void }
  clearInterval: (handle: { unref?: () => void }) => void
  clearCount: () => number
}

function createFakeClock() {
  let callback: (() => void) | null = null
  let clearCount = 0
  return {
    setInterval: (next: () => void) => {
      callback = next
      return { unref: () => {} }
    },
    clearInterval: () => {
      clearCount += 1
      callback = null
    },
    tick: () => {
      callback?.()
    },
    clearCount: () => clearCount,
  }
}

function createMockTimerClock(): IntervalClock {
  let clearCount = 0
  return {
    setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
    clearInterval: (handle) => {
      clearCount += 1
      globalThis.clearInterval(handle as unknown as Parameters<typeof globalThis.clearInterval>[0])
    },
    clearCount: () => clearCount,
  }
}

function createHarness(options: {
  trusted: (event: unknown) => boolean
  capabilities?: Capability[]
  clock?: IntervalClock
}) {
  const fakeIpc = createFakeIpcMain()
  const fakeInbox = createFakeInbox()
  const windows = createWindows(options.capabilities ?? ['pet'])
  const clock = options.clock ?? createFakeClock()
  const ipc = createProactiveIpc({
    ipcMain: fakeIpc.ipcMain,
    getAllWindows: windows.getAllWindows,
    getWindowCapability: windows.getWindowCapability,
    requireTrustedSender: (event) => {
      if (!options.trusted(event)) throw new Error('untrusted sender')
    },
    inbox: fakeInbox.inbox,
    logger: createFakeLogger(),
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  })
  return { ...fakeIpc, ...fakeInbox, ...windows, clock, ipc }
}

test('untrusted senders are rejected before any inbox write', async () => {
  const harness = createHarness({
    trusted: () => false,
    capabilities: ['pet', 'panel'],
  })
  const untrusted = { trusted: false }

  await assert.rejects(() => harness.invoke('proactive:deliver', untrusted, {
    message: makeMessage(),
    context: makeContext(),
  }))
  await assert.rejects(() => harness.invoke('inbox:list', untrusted))
  await assert.rejects(() => harness.invoke('inbox:update', untrusted, {
    id: 'msg-1',
    status: 'done',
  }))

  assert.deepEqual(harness.calls, {
    list: 0,
    prune: 0,
    upsert: 0,
    setStatus: 0,
    flush: 0,
    clear: 0,
  })
  assert.deepEqual(harness.sentByWindow, [[], []])
})

test('presentation events go only to the pet window', async () => {
  const harness = createHarness({
    trusted: (event) => (event as { trusted?: boolean }).trusted === true,
    capabilities: ['pet', 'panel', 'unknown'],
  })

  await harness.invoke('proactive:deliver', { trusted: true }, {
    message: makeMessage({ body: 'Bubble body' }),
    context: makeContext(),
  })

  const presentations = harness.sentByWindow.map((sent) =>
    sent.filter((item) => item.channel === 'proactive:present'))
  assert.equal(presentations[0]?.length, 1)
  const first = presentations[0]?.[0]
  assert.ok(first)
  assert.equal((first.payload as { outlet: string }).outlet, 'bubble')
  assert.deepEqual(presentations[1], [])
  assert.deepEqual(presentations[2], [])
})

test('the prune sweep publishes inbox:changed only when entries were removed', (t: TestContext) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const harness = createHarness({
    trusted: () => true,
    capabilities: ['pet', 'panel'],
    clock: createMockTimerClock(),
  })
  t.after(() => harness.ipc.stopPrune())

  harness.setPruneResult({
    changed: true,
    entries: [],
    removedIds: ['old'],
    unreadCount: 2,
  })
  t.mock.timers.tick(PRUNE_INTERVAL_MS)

  const firstChanges = harness.sentByWindow[0]?.filter((item) => item.channel === 'inbox:changed') ?? []
  assert.equal(firstChanges.length, 1)
  assert.deepEqual(firstChanges[0]?.payload, {
    unreadCount: 2,
    entries: [],
    removedIds: ['old'],
  })
  assert.equal((harness.sentByWindow[1] ?? []).filter((item) => item.channel === 'inbox:changed').length, 1)

  harness.setPruneResult({
    changed: false,
    entries: [],
    removedIds: [],
    unreadCount: 2,
  })
  t.mock.timers.tick(PRUNE_INTERVAL_MS)

  const changesAfter = harness.sentByWindow[0]?.filter((item) => item.channel === 'inbox:changed') ?? []
  assert.equal(changesAfter.length, 1)
  assert.equal(harness.calls.prune, 2)
})

test('stopping the prune sweep clears the interval', (t: TestContext) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const harness = createHarness({
    trusted: () => true,
    capabilities: ['pet'],
    clock: createMockTimerClock(),
  })

  harness.ipc.stopPrune()
  const pruneCallsAfterStop = harness.calls.prune
  t.mock.timers.tick(PRUNE_INTERVAL_MS)

  assert.equal(harness.clock.clearCount(), 1)
  assert.equal(harness.calls.prune, pruneCallsAfterStop)
})
