import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createProactiveIpc } from '../electron/ipc/proactiveIpc.js'
import { buildReminderStripLabels } from '../electron/reminderStripLabels.js'
import type { Logger } from '../electron/logger.js'
import type { DeliveryContext, ProactiveMessage } from '../shared/proactiveDelivery.js'
import { buildReminderProactiveMessage } from '../src/features/reminders/proactiveMessage.ts'

const NOW = 1_700_000_000_000

const EXPECTED_LABELS: Record<string, { done: string; snooze: string; open: string }> = {
  'zh-CN': { done: '完成', snooze: '稍后 10 分钟', open: '打开对话' },
  'zh-TW': { done: '完成', snooze: '稍後 10 分鐘', open: '打開對話' },
  'en-US': { done: 'Done', snooze: 'Snooze 10 min', open: 'Open chat' },
  ja: { done: '完了', snooze: '10分後に', open: '会話を開く' },
  ko: { done: '완료', snooze: '10분 후에', open: '대화 열기' },
}

type StripPayload = {
  id: string
  title: string
  body: string
  labels: { done: string; snooze: string; open: string }
  actions: string[]
}

function makeMessage(overrides: Partial<ProactiveMessage> = {}): ProactiveMessage {
  return {
    ...buildReminderProactiveMessage(
      { id: 'task-1', title: 'Stand up' },
      { displayText: 'Time to move', speech: 'Stand up now', now: NOW },
    ),
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

function createHarness(options: {
  labels?: StripPayload['labels']
  isPanelFocused?: boolean
}) {
  const shown: StripPayload[] = []
  const notifications: Array<{ title: string; body: string }> = []
  type Handler = (event: unknown, payload?: unknown) => unknown
  const handlers = new Map<string, Handler>()
  const inbox = {
    list: () => ({ entries: [], unreadCount: 0, removedIds: [] }),
    prune: () => ({ changed: false, entries: [], removedIds: [], unreadCount: 0 }),
    upsert: () => ({ changed: false, entries: [], removedIds: [], unreadCount: 0 }),
    setStatus: () => ({ changed: false, entries: [], removedIds: [], unreadCount: 0 }),
    flush: async () => true,
    clear: async () => true,
  }

  const ipc = createProactiveIpc({
    ipcMain: {
      handle(channel: string, listener: Handler) {
        handlers.set(channel, listener)
      },
    },
    getAllWindows: () => [],
    getWindowCapability: () => 'unknown',
    requireTrustedSender: () => {},
    inbox,
    logger: createFakeLogger(),
    setInterval: () => ({ unref: () => {} }),
    clearInterval: () => {},
    strip: {
      show: (payload: StripPayload) => {
        shown.push(payload)
        return true
      },
      withdraw: () => true,
      withdrawAll: () => {},
    },
    getStripLabels: () => options.labels ?? EXPECTED_LABELS['en-US']!,
    showOsNotification: (payload: { title: string; body: string }) => {
      notifications.push(payload)
    },
    isPanelFocused: () => options.isPanelFocused === true,
  })

  return {
    shown,
    notifications,
    async deliver(message: ProactiveMessage, context: DeliveryContext) {
      const handler = handlers.get('proactive:deliver')
      assert.ok(handler)
      return await handler({ trusted: true }, { message, context })
    },
    stop: () => ipc.stopPrune(),
  }
}

for (const locale of Object.keys(EXPECTED_LABELS)) {
  test(`the strip outlet passes id, title, body and ${locale} labels`, async () => {
    const harness = createHarness({ labels: buildReminderStripLabels(locale) })
    const message = makeMessage()

    await harness.deliver(message, makeContext())
    harness.stop()

    assert.equal(harness.shown.length, 1)
    assert.deepEqual(harness.shown[0], {
      id: message.id,
      title: message.title,
      body: message.body,
      labels: EXPECTED_LABELS[locale],
      actions: message.actions,
    })
    assert.match(harness.shown[0]!.labels.snooze, /10/u)
  })
}

test('the os_notification outlet calls the notifier with title and body', async () => {
  const harness = createHarness({})
  const message = makeMessage()

  const decision = await harness.deliver(
    message,
    makeContext({ focusState: 'idle', awayNotificationsEnabled: true }),
  )
  harness.stop()

  assert.deepEqual(decision, { rule: 5, outlets: ['inbox', 'os_notification'] })
  assert.deepEqual(harness.notifications, [{ title: message.title, body: message.body }])
  assert.deepEqual(harness.shown, [])
})

test('main overrides panelFocused when the focused BrowserWindow is the panel', async () => {
  const harness = createHarness({ isPanelFocused: true })

  const decision = await harness.deliver(makeMessage(), makeContext({ panelFocused: false }))
  harness.stop()

  assert.deepEqual(decision, { rule: 2, outlets: ['inbox', 'panel'] })
  assert.deepEqual(harness.shown, [])
  assert.deepEqual(harness.notifications, [])
})
