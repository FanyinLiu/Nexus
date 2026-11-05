import assert from 'node:assert/strict'
import test from 'node:test'

import { createProactiveIpc } from '../electron/ipc/proactiveIpc.js'
import type { Logger } from '../electron/logger.js'
import type {
  DeliveryContext,
  ProactiveMessage,
} from '../shared/proactiveDelivery.js'

const NOW = 1_700_000_000_000

function makeMessage(id: string, title = 'Check in'): ProactiveMessage {
  return {
    id,
    source: 'reminder',
    kind: 'reminder_follow_up',
    priority: 'normal',
    title,
    body: 'A body that must never reach a log line.',
    actions: [],
    createdAt: NOW,
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

type Handler = (event: unknown, payload?: unknown) => unknown

type HarnessOptions = {
  typing?: boolean
  actions?: string[]
  showStrip?: () => Promise<unknown> | unknown
}

function createHarness(options: HarnessOptions = {}) {
  let typing = options.typing === true
  const typingListeners = new Set<(typing: boolean) => void>()
  const handlers = new Map<string, Handler>()
  const presentations: Array<{ outlet: string; message: ProactiveMessage }> = []
  const upserts: ProactiveMessage[] = []
  const shown: string[] = []
  const logs: string[][] = []
  const logger: Logger = {
    debug: (...args: unknown[]) => { logs.push(args.map(String)) },
    info: (...args: unknown[]) => { logs.push(args.map(String)) },
    warn: (...args: unknown[]) => { logs.push(args.map(String)) },
    error: (...args: unknown[]) => { logs.push(args.map(String)) },
    child: () => logger,
  }
  const webContents = {
    isDestroyed: () => false,
    id: 7,
    send: (channel: string, payload: unknown) => {
      if (channel === 'proactive:present') {
        presentations.push(payload as { outlet: string; message: ProactiveMessage })
      }
    },
  }
  const window = { isDestroyed: () => false, webContents }
  const inbox = {
    list: () => ({ entries: [], unreadCount: upserts.length, removedIds: [] }),
    upsert: (message: ProactiveMessage) => {
      upserts.push(message)
      return {
        changed: true,
        entries: [],
        removedIds: [],
        unreadCount: upserts.length,
      }
    },
    setStatus: () => ({ changed: false, entries: [], removedIds: [], unreadCount: 0 }),
    prune: () => ({ changed: false, entries: [], removedIds: [], unreadCount: 0 }),
    flush: async () => true,
    clear: async () => true,
  }
  const strip = {
    show: async (payload: { id: string }) => {
      shown.push(payload.id)
      return options.showStrip ? options.showStrip() : true
    },
    withdraw: () => true,
    withdrawAll: () => undefined,
    configure: () => undefined,
  }

  const ipc = createProactiveIpc({
    ipcMain: {
      handle: (channel: string, listener: Handler) => {
        handlers.set(channel, listener)
      },
    },
    getAllWindows: () => [window],
    getWindowCapability: () => 'pet',
    requireTrustedSender: () => undefined,
    inbox,
    logger,
    setInterval: () => ({ unref: () => undefined }),
    clearInterval: () => undefined,
    strip,
    getStripLabels: () => ({ done: 'Done', snooze: 'Snooze', open: 'Open' }),
    showOsNotification: () => undefined,
    isPanelFocused: () => false,
    getTypingQuiet: () => typing,
    subscribeTypingQuiet: (listener) => {
      typingListeners.add(listener)
      return () => typingListeners.delete(listener)
    },
  })

  const invoke = async (channel: string, payload: unknown) => {
    const handler = handlers.get(channel)
    assert.ok(handler, `missing handler for ${channel}`)
    return await handler({ trusted: true }, payload)
  }

  return {
    ipc,
    invoke,
    upserts,
    presentations,
    shown,
    logs,
    isTyping: () => typing,
    setTyping: (next: boolean) => {
      typing = next
      for (const listener of [...typingListeners]) listener(next)
    },
    actions: options.actions ?? [],
    makePayload: (id: string, context = makeContext()) => ({
      message: { ...makeMessage(id), actions: [...(options.actions ?? [])] },
      context,
    }),
  }
}

test('messages wait out typing quiet and then land once in arrival order', async () => {
  const harness = createHarness({ typing: true, actions: [] })

  const first = harness.invoke('proactive:deliver', harness.makePayload('msg-1'))
  const second = harness.invoke('proactive:deliver', harness.makePayload('msg-2'))
  await Promise.resolve()
  assert.deepEqual(harness.upserts, [], 'nothing is written while typing is active')
  assert.deepEqual(harness.presentations, [], 'no bubble while typing is active')

  harness.setTyping(false)
  await Promise.all([first, second])

  assert.deepEqual(harness.upserts.map((message) => message.id), ['msg-1', 'msg-2'])
  assert.deepEqual(
    harness.presentations.map((presentation) => presentation.message.id),
    ['msg-1', 'msg-2'],
  )
  assert.equal(harness.shown.length, 0)
})

test('a mode with actions waits on the strip outlet and is delivered once', async () => {
  const harness = createHarness({ typing: true, actions: ['done'] })

  const first = harness.invoke('proactive:deliver', harness.makePayload('msg-1', makeContext()))
  await Promise.resolve()
  assert.deepEqual(harness.upserts, [])
  assert.deepEqual(harness.shown, [])

  harness.setTyping(false)
  await first
  assert.deepEqual(harness.upserts.map((message) => message.id), ['msg-1'])
  assert.deepEqual(harness.shown, ['msg-1'])
})

test('a flag that flips back holds only the next waiting message', async () => {
  let releaseStrip!: () => void
  const stripGate = new Promise<void>((resolve) => { releaseStrip = resolve })
  const harness = createHarness({
    typing: true,
    actions: ['done'],
    showStrip: () => stripGate,
  })

  const first = harness.invoke('proactive:deliver', harness.makePayload('msg-1', makeContext()))
  const second = harness.invoke('proactive:deliver', harness.makePayload('msg-2', makeContext()))
  await Promise.resolve()

  harness.setTyping(false)
  // Let the first delivery reach the strip outlet while it is on the wire.
  for (let turn = 0; turn < 50 && harness.shown.length === 0; turn += 1) {
    await Promise.resolve()
  }
  assert.deepEqual(harness.shown, ['msg-1'])
  harness.setTyping(true)
  releaseStrip()
  await first
  assert.deepEqual(harness.upserts.map((message) => message.id), ['msg-1'])
  assert.deepEqual(harness.shown, ['msg-1'])

  // The next message re-checked the flag and is still waiting.
  harness.setTyping(false)
  await second
  assert.deepEqual(harness.upserts.map((message) => message.id), ['msg-1', 'msg-2'])
  assert.deepEqual(harness.shown, ['msg-1', 'msg-2'])
})

test('a stopped signal delivers immediately and writes no log line', async () => {
  const harness = createHarness({ typing: false, actions: [] })
  const decision = await harness.invoke('proactive:deliver', harness.makePayload('msg-1')) as {
    rule: number
    outlets: string[]
  }
  assert.equal(decision.rule, 4)
  assert.deepEqual(decision.outlets, ['inbox', 'bubble'])
  assert.deepEqual(harness.upserts.map((message) => message.id), ['msg-1'])
  assert.deepEqual(harness.logs, [])
})

test('hold and release logs never carry the message text', async () => {
  const harness = createHarness({ typing: true, actions: [] })
  const pending = harness.invoke('proactive:deliver', harness.makePayload('msg-1'))
  await Promise.resolve()
  harness.setTyping(false)
  await pending

  for (const args of harness.logs) {
    const text = args.join(' ')
    assert.equal(text.includes('A body that must never reach a log line.'), false)
    assert.equal(text.includes('Check in'), false)
  }
})
