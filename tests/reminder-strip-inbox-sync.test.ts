import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'

import { createProactiveIpc } from '../electron/ipc/proactiveIpc.js'
import { createProactiveInboxStore } from '../electron/services/proactiveInboxStore.js'
import type { Logger } from '../electron/logger.js'
import type { ProactiveMessage } from '../shared/proactiveDelivery.js'

const NOW = 1_700_000_000_000
const FILE_NAME = 'proactive-inbox.json'

type Inbox = ReturnType<typeof createProactiveInboxStore>

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

function createTempDir(t: TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-reminder-strip-sync-'))
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return directory
}

/** A non-empty directory at the store path makes `rm` refuse without recursive. */
function makeInboxUndeletable(directory: string): void {
  const target = path.join(directory, FILE_NAME)
  fs.rmSync(target, { force: true })
  fs.mkdirSync(target)
  fs.writeFileSync(path.join(target, 'keep.txt'), 'keep')
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
  isPending: (id: string) => boolean
}

function createFakeStrip() {
  const withdrawn: string[] = []
  let withdrawAllCount = 0
  let configured: StripDependencies | null = null
  return {
    strip: {
      show: () => true,
      withdraw: (id: string) => {
        withdrawn.push(id)
        return true
      },
      withdrawAll: () => {
        withdrawAllCount += 1
      },
      configure: (dependencies: StripDependencies) => {
        configured = dependencies
      },
    },
    withdrawn,
    withdrawAllCount: () => withdrawAllCount,
    configured: () => {
      assert.ok(configured)
      return configured
    },
  }
}

type Handler = (event: unknown, payload?: unknown) => unknown
type SentMessage = { channel: string; payload: unknown }
type WindowCapability = 'pet' | 'panel'

function createFakeWindow(capability: WindowCapability, sent: SentMessage[]) {
  return {
    capability,
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        sent.push({ channel, payload })
      },
    },
  }
}

function assertNoContentKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoContentKeys(item)
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value)) {
    assert.ok(!['title', 'body', 'speech'].includes(key), `inbox:changed leaked ${key}`)
    assertNoContentKeys(nested)
  }
}

function createHarness(t: TestContext) {
  const directory = createTempDir(t)
  const store = createProactiveInboxStore({
    getStorePath: () => path.join(directory, FILE_NAME),
    now: () => NOW,
  })
  const handlers = new Map<string, Handler>()
  const sent: SentMessage[] = []
  const panelSent: SentMessage[] = []
  const fakeStrip = createFakeStrip()
  const windows = [
    createFakeWindow('pet', sent),
    createFakeWindow('panel', panelSent),
  ]

  const ipc = createProactiveIpc({
    ipcMain: {
      handle(channel: string, listener: Handler) {
        handlers.set(channel, listener)
      },
    },
    getAllWindows: () => windows,
    getWindowCapability: (webContents) => windows.find((win) => win.webContents === webContents)?.capability ?? 'unknown',
    requireTrustedSender: () => {},
    inbox: store,
    logger: createFakeLogger(),
    setInterval: () => ({ unref: () => {} }),
    clearInterval: () => {},
    strip: fakeStrip.strip,
    getStripLabels: () => ({ done: 'Done', snooze: 'Snooze 10 min', open: 'Open chat' }),
    showOsNotification: () => {},
    isPanelFocused: () => false,
  })
  t.after(() => ipc.stopPrune())

  return {
    directory,
    store,
    sent,
    fakeStrip,
    ipc,
    invoke: async (channel: string, payload?: unknown) => {
      const handler = handlers.get(channel)
      assert.ok(handler, `missing handler for ${channel}`)
      return await handler({ trusted: true }, payload)
    },
    changes: () => sent.filter((item) => item.channel === 'inbox:changed').map((item) => item.payload),
    panelChanges: () => panelSent.filter((item) => item.channel === 'inbox:changed').map((item) => item.payload),
  }
}

function inboxStatus(store: Inbox, id: string) {
  return store.list().entries.find((entry) => entry.id === id)?.status
}

test('strip Done marks the inbox entry done and publishes the lower unread count', (t) => {
  const harness = createHarness(t)
  const message = makeMessage()
  harness.store.upsert(message)
  assert.equal(harness.store.list().unreadCount, 1)

  harness.fakeStrip.configured().onAction('done', message.id)

  assert.equal(inboxStatus(harness.store, message.id), 'done')
  assert.equal(harness.store.list().unreadCount, 0)
  const payloads = harness.changes()
  assert.deepEqual(payloads.at(-1), {
    unreadCount: 0,
    changes: [{ id: message.id, status: 'done' }],
    removedIds: [],
  })
  assert.deepEqual(harness.panelChanges(), [])
})

test('inbox:update to dismissed publishes ids and status only, to the pet window only', async (t) => {
  const harness = createHarness(t)
  const message = makeMessage({ id: 'dismissed-id', speech: 'Stand up and stretch' })
  harness.store.upsert(message)
  assert.equal(harness.store.list().unreadCount, 1)

  await harness.invoke('inbox:update', { id: 'dismissed-id', status: 'dismissed' })

  assert.deepEqual(harness.changes().at(-1), {
    unreadCount: 0,
    changes: [{ id: 'dismissed-id', status: 'dismissed' }],
    removedIds: [],
  })
  assert.deepEqual(harness.panelChanges(), [])

  const serialized = JSON.stringify(harness.changes())
  assert.equal(serialized.includes('Stand up'), false)
  assert.equal(serialized.includes('Time to move'), false)
  assert.equal(serialized.includes(message.speech ?? ''), false)
  for (const payload of harness.changes()) assertNoContentKeys(payload)

  assert.ok(harness.fakeStrip.withdrawn.includes('dismissed-id'))
})

test('inbox:update to done or dismissed withdraws the id from the strip', async (t) => {
  const harness = createHarness(t)
  harness.store.upsert(makeMessage({ id: 'done-id' }))
  harness.store.upsert(makeMessage({ id: 'dismissed-id' }))

  await harness.invoke('inbox:update', { id: 'done-id', status: 'done' })
  await harness.invoke('inbox:update', { id: 'dismissed-id', status: 'dismissed' })

  assert.deepEqual(harness.fakeStrip.withdrawn, ['done-id', 'dismissed-id'])
  assert.equal(inboxStatus(harness.store, 'done-id'), 'done')
  assert.equal(inboxStatus(harness.store, 'dismissed-id'), 'dismissed')
  assert.equal(harness.store.list().unreadCount, 0)
})

test('strip open and expire leave the inbox entry unread and the count unchanged', (t) => {
  const harness = createHarness(t)
  const message = makeMessage()
  harness.store.upsert(message)

  harness.fakeStrip.configured().onAction('open', message.id)
  harness.fakeStrip.configured().onAction('expire', message.id)

  assert.equal(inboxStatus(harness.store, message.id), 'unread')
  assert.equal(harness.store.list().unreadCount, 1)
  assert.deepEqual(harness.changes(), [])
})

test('clear-all withdraws every strip item and publishes a zero count', async (t) => {
  const harness = createHarness(t)
  harness.store.upsert(makeMessage())
  assert.equal(harness.store.list().unreadCount, 1)

  await harness.ipc.clearInbox()

  assert.equal(harness.fakeStrip.withdrawAllCount(), 1)
  assert.deepEqual(harness.store.list().entries, [])
  assert.deepEqual(harness.changes().at(-1), {
    unreadCount: 0,
    changes: [],
    removedIds: [],
  })
})

test('a failed inbox delete keeps the strip and publishes no zero count', async (t) => {
  const harness = createHarness(t)
  harness.store.upsert(makeMessage())
  await harness.store.flush()
  makeInboxUndeletable(harness.directory)

  await assert.rejects(
    () => harness.ipc.clearInbox(),
    /NEXUS_ERR_PROACTIVE_INBOX_CLEAR_FAILED/,
  )

  // The file still holds the reminder, so the strip and the badge must stay
  // consistent with disk instead of showing an empty inbox.
  assert.equal(harness.fakeStrip.withdrawAllCount(), 0)
  assert.deepEqual(harness.fakeStrip.withdrawn, [])
  assert.deepEqual(harness.changes(), [])
  assert.equal(harness.store.list().unreadCount, 1)
  assert.equal(fs.existsSync(path.join(harness.directory, FILE_NAME)), true)
})
