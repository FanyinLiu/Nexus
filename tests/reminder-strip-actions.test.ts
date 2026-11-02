/**
 * The strip renders exactly the actions its item offers. This suite loads the
 * real `strip.js` into the same minimal DOM the collapse tests use, plus small
 * unit tests for the queue, the session guard and the router's strip outlet.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { createProactiveIpc } from '../electron/ipc/proactiveIpc.js'
import {
  REMINDER_STRIP_ACTIONS,
  normalizeReminderStripPayload,
} from '../electron/services/reminderStripQueue.js'
import { createReminderStripSession } from '../electron/services/reminderStripSession.js'
import type { Logger } from '../electron/logger.js'
import type { DeliveryContext, ProactiveMessage } from '../shared/proactiveDelivery.js'

const NOW = 1_700_000_000_000
const STRIP_PATH = new URL('../electron/reminderStrip/strip.js', import.meta.url)
const STRIP_SOURCE = readFileSync(STRIP_PATH, 'utf8')

const LABELS = { done: '完成', snooze: '稍后', open: '打开对话' }

type StripItem = {
  id: string
  title: string
  body: string
  labels: typeof LABELS
  actions: string[]
}

type Snapshot = { items: StripItem[] }

function item(actions: string[], id = 'arc-1'): StripItem {
  return { id, title: `Title ${id}`, body: `Body ${id}`, labels: LABELS, actions }
}

type FakeElement = {
  hidden: boolean
  disabled: boolean
  textContent: string
  title: string
  attrs: Record<string, string>
  listeners: Map<string, () => void>
  setAttribute: (name: string, value: string) => void
  addEventListener: (type: string, listener: () => void) => void
}

function createElement(): FakeElement {
  return {
    hidden: false,
    disabled: false,
    textContent: '',
    title: '',
    attrs: {},
    listeners: new Map(),
    setAttribute(name, value) {
      this.attrs[name] = value
    },
    addEventListener(type, listener) {
      this.listeners.set(type, listener)
    },
  }
}

function createStrip(initial: Snapshot) {
  const actions: string[] = []
  const elements: Record<string, FakeElement> = {
    strip: createElement(),
    'strip-text': createElement(),
    'strip-count': createElement(),
    'strip-done': createElement(),
    'strip-snooze': createElement(),
  }

  vm.runInNewContext(STRIP_SOURCE, {
    window: {
      reminderStrip: {
        ready: async () => initial,
        act: async (id: string, action: string) => {
          actions.push(`${id}:${action}`)
        },
        onItems: () => () => {},
      },
    },
    document: {
      getElementById: (id: string) => elements[id] ?? null,
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
  }, { filename: STRIP_PATH.pathname })

  function visibleInteractive(): string[] {
    const controls: Array<[string, FakeElement]> = [
      ['done', elements['strip-done']!],
      ['snooze', elements['strip-snooze']!],
      ['text', elements['strip-text']!],
    ]
    return controls
      .filter(([, element]) => !element.hidden && !element.disabled)
      .map(([name]) => name)
  }

  return {
    actions,
    elements,
    async ready() {
      await Promise.resolve()
      await Promise.resolve()
    },
    click(id: 'strip-text' | 'strip-done' | 'strip-snooze') {
      elements[id]!.listeners.get('click')?.()
    },
    visibleInteractive,
  }
}

// ── Rendering ───────────────────────────────────────────────────────────────

test('an item with only open shows the text control and hides the reminder buttons', async () => {
  const strip = createStrip({ items: [item(['open'])] })
  await strip.ready()

  assert.equal(strip.elements['strip-done']!.hidden, true)
  assert.equal(strip.elements['strip-snooze']!.hidden, true)
  assert.equal(strip.elements['strip-text']!.disabled, false)
  assert.deepEqual(strip.visibleInteractive(), ['text'])

  strip.click('strip-text')
  assert.deepEqual(strip.actions, ['arc-1:open'])
})

test('an item with done and open shows two interactive controls', async () => {
  const strip = createStrip({ items: [item(['done', 'open'])] })
  await strip.ready()

  assert.equal(strip.elements['strip-done']!.hidden, false)
  assert.equal(strip.elements['strip-snooze']!.hidden, true)
  assert.deepEqual(strip.visibleInteractive(), ['done', 'text'])
})

test('a reminder item keeps the full done, snooze and open layout', async () => {
  const strip = createStrip({ items: [item(['done', 'snooze', 'open'])] })
  await strip.ready()

  assert.deepEqual(strip.visibleInteractive(), ['done', 'snooze', 'text'])
})

test('an item with no panel action keeps the text readable but non-interactive', async () => {
  const strip = createStrip({ items: [item(['done'])] })
  await strip.ready()

  const text = strip.elements['strip-text']!
  assert.equal(text.hidden, false)
  assert.equal(text.disabled, true)
  assert.equal(text.attrs['aria-label']?.includes(LABELS.open), false)
  assert.deepEqual(strip.visibleInteractive(), ['done'])

  strip.click('strip-text')
  assert.deepEqual(strip.actions, [])
})

test('reply uses the open-chat label and clicking it sends reply', async () => {
  const strip = createStrip({ items: [item(['reply'])] })
  await strip.ready()

  const text = strip.elements['strip-text']!
  assert.equal(text.disabled, false)
  assert.match(text.attrs['aria-label'] ?? '', /打开对话/u)
  assert.deepEqual(strip.visibleInteractive(), ['text'])

  strip.click('strip-text')
  assert.deepEqual(strip.actions, ['arc-1:reply'])
})

// ── Queue ───────────────────────────────────────────────────────────────────

test('a payload without actions defaults to the reminder layout', () => {
  const normalized = normalizeReminderStripPayload({ id: 'task-1', title: 't', body: 'b', labels: LABELS })
  assert.deepEqual(normalized?.actions, ['done', 'snooze', 'open'])
})

test('unknown and duplicate actions are dropped in payload order', () => {
  const normalized = normalizeReminderStripPayload({
    id: 'arc-1',
    title: 't',
    body: 'b',
    labels: LABELS,
    actions: ['reply', 'delete', 'snooze', 'reply', 'expire'],
  })
  assert.deepEqual(normalized?.actions, ['reply', 'snooze'])

  const empty = normalizeReminderStripPayload({
    id: 'arc-2',
    title: 't',
    body: 'b',
    actions: [],
  })
  assert.deepEqual(empty?.actions, [])
})

test('reply is a known strip action and expire stays session-only', () => {
  assert.equal(REMINDER_STRIP_ACTIONS.has('reply'), true)
  assert.equal(REMINDER_STRIP_ACTIONS.has('expire'), true)
  assert.equal(REMINDER_STRIP_ACTIONS.size, 5)
})

// ── Session guard ───────────────────────────────────────────────────────────

test('the session rejects an action the item does not offer but always accepts expire', () => {
  const actions: string[] = []
  const session = createReminderStripSession({
    setTimer: () => 1,
    clearTimer: () => {},
    snoozeMs: 60_000,
    onQueueChange: () => {},
    onAction: (action) => actions.push(action),
    canReshow: () => true,
  })

  session.show({ id: 'arc-1', title: 't', body: 'b', labels: LABELS, actions: ['open'] })
  const before = session.snapshot()

  assert.deepEqual(session.handleAction({ id: 'arc-1', action: 'done' }), { ok: false })
  assert.deepEqual(session.snapshot(), before)
  assert.deepEqual(actions, [])

  assert.deepEqual(session.handleAction({ id: 'arc-1', action: 'expire' }), { ok: true })
  assert.deepEqual(actions, ['expire'])
  assert.deepEqual(session.snapshot().items, [])
})

// ── Strip outlet ────────────────────────────────────────────────────────────

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

test('the strip outlet forwards the message actions', async () => {
  type Handler = (event: unknown, payload?: unknown) => unknown
  const handlers = new Map<string, Handler>()
  const shown: Array<{ id: string; actions: string[] }> = []

  const ipc = createProactiveIpc({
    ipcMain: {
      handle(channel: string, listener: Handler) {
        handlers.set(channel, listener)
      },
    },
    getAllWindows: () => [],
    getWindowCapability: () => 'unknown',
    requireTrustedSender: () => {},
    inbox: {
      list: () => ({ entries: [], unreadCount: 0, removedIds: [] }),
      prune: () => ({ changed: false, entries: [], removedIds: [], unreadCount: 0 }),
      upsert: () => ({ changed: false, entries: [], removedIds: [], unreadCount: 0 }),
      setStatus: () => ({ changed: false, entries: [], removedIds: [], unreadCount: 0 }),
      flush: async () => true,
      clear: async () => true,
    },
    logger: createFakeLogger(),
    setInterval: () => ({ unref: () => {} }),
    clearInterval: () => {},
    strip: {
      show: (payload: { id: string; actions: string[] }) => {
        shown.push(payload)
        return true
      },
      withdraw: () => true,
      withdrawAll: () => {},
    },
    getStripLabels: () => LABELS,
    showOsNotification: () => {},
    isPanelFocused: () => false,
  })

  const message: ProactiveMessage = {
    id: 'open_arc:arc-1:3',
    source: 'open_arc',
    kind: 'open_arc',
    priority: 'normal',
    title: 'A thread you opened',
    body: 'Still on your mind?',
    actions: ['reply'],
    createdAt: NOW,
  }

  const handler = handlers.get('proactive:deliver')
  assert.ok(handler)
  const decision = await handler({ trusted: true }, { message, context: makeContext() })
  ipc.stopPrune()

  assert.deepEqual(decision, { rule: 3, outlets: ['inbox', 'strip'] })
  assert.equal(shown.length, 1)
  assert.deepEqual(shown[0]!.actions, ['reply'])
})
