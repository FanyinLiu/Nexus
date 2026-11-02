import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'

import { createProactiveIpc } from '../electron/ipc/proactiveIpc.js'
import { createProactiveInboxStore } from '../electron/services/proactiveInboxStore.js'
import type { Logger } from '../electron/logger.js'
import type { DeliveryContext, ProactiveMessage } from '../shared/proactiveDelivery.js'

const NOW = 1_700_000_000_000
const FILE_NAME = 'proactive-inbox.json'

function makeMessage(): ProactiveMessage {
  return {
    id: 'reminder:task-1:1700000000000',
    source: 'reminder',
    kind: 'reminder_follow_up',
    priority: 'high',
    title: 'Stand up',
    body: 'Time to move',
    speech: 'Stand up now',
    actions: ['done'],
    createdAt: NOW,
  }
}

function makeContext(): DeliveryContext {
  return {
    panelFocused: false,
    fullscreen: false,
    focusState: 'active',
    inQuietHours: false,
    systemDnd: null,
    awayNotificationsEnabled: false,
    stripEnabled: true,
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

function createHarness(t: TestContext, capabilities: Array<'pet' | 'panel' | 'unknown'>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-inbox-targeting-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = createProactiveInboxStore({
    getStorePath: () => path.join(directory, FILE_NAME),
    now: () => NOW,
  })
  const handlers = new Map<string, Handler>()
  const sentByWindow: Array<Array<{ channel: string; payload: unknown }>> = []
  const capabilitiesByContents = new Map<object, string>()
  const windows = capabilities.map((capability) => {
    const sent: Array<{ channel: string; payload: unknown }> = []
    sentByWindow.push(sent)
    const webContents = {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
    }
    capabilitiesByContents.set(webContents, capability)
    return { isDestroyed: () => false, webContents }
  })

  const ipc = createProactiveIpc({
    ipcMain: {
      handle(channel: string, listener: Handler) {
        handlers.set(channel, listener)
      },
    },
    getAllWindows: () => windows,
    getWindowCapability: (webContents) => (
      capabilitiesByContents.get(webContents as object) ?? 'unknown'
    ) as 'pet' | 'panel' | 'unknown',
    requireTrustedSender: () => {},
    inbox: store,
    logger: createFakeLogger(),
    setInterval: () => ({ unref: () => {} }),
    clearInterval: () => {},
    strip: { show: () => true, withdraw: () => true, withdrawAll: () => {} },
    getStripLabels: () => ({ done: 'Done', snooze: 'Snooze 10 min', open: 'Open chat' }),
    showOsNotification: () => {},
    isPanelFocused: () => false,
  })
  t.after(() => ipc.stopPrune())

  return {
    sentByWindow,
    async deliver(message: ProactiveMessage, context: DeliveryContext) {
      const handler = handlers.get('proactive:deliver')
      assert.ok(handler)
      return await handler({ trusted: true }, { message, context })
    },
  }
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (!value || typeof value !== 'object') return keys
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, keys)
    return keys
  }
  for (const [key, entry] of Object.entries(value)) {
    keys.push(key)
    collectKeys(entry, keys)
  }
  return keys
}

test('inbox:changed goes only to the pet window', async (t) => {
  const harness = createHarness(t, ['pet', 'panel', 'unknown'])

  await harness.deliver(makeMessage(), makeContext())

  const petChanges = harness.sentByWindow[0]?.filter((item) => item.channel === 'inbox:changed') ?? []
  assert.equal(petChanges.length, 1)
  assert.deepEqual(harness.sentByWindow[1]?.filter((item) => item.channel === 'inbox:changed'), [])
  assert.deepEqual(harness.sentByWindow[2]?.filter((item) => item.channel === 'inbox:changed'), [])
})

test('the inbox:changed payload carries ids and statuses but no content', async (t) => {
  const harness = createHarness(t, ['pet'])
  const message = makeMessage()

  await harness.deliver(message, makeContext())

  const changes = harness.sentByWindow[0]?.filter((item) => item.channel === 'inbox:changed') ?? []
  const payload = changes[0]?.payload as {
    unreadCount: number
    changes: Array<{ id: string; status: string }>
    removedIds: string[]
  }

  assert.deepEqual(Object.keys(payload).sort(), ['changes', 'removedIds', 'unreadCount'])
  assert.equal(payload.unreadCount, 1)
  assert.deepEqual(payload.changes, [{ id: message.id, status: 'unread' }])
  assert.deepEqual(payload.removedIds, [])

  const keys = collectKeys(payload)
  assert.ok(!keys.includes('title'))
  assert.ok(!keys.includes('body'))
  assert.ok(!keys.includes('speech'))
})
