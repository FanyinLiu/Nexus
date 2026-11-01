import assert from 'node:assert/strict'
import fs from 'node:fs'
import { register } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'

import { createProactiveIpc } from '../electron/ipc/proactiveIpc.js'
import { createProactiveInboxStore } from '../electron/services/proactiveInboxStore.js'
import type { Logger } from '../electron/logger.js'
import type { ProactiveMessage } from '../shared/proactiveDelivery.js'

register(new URL('./helpers/memory-vector-electron-hooks.mjs', import.meta.url))

const NOW = 1_700_000_000_000
const FILE_NAME = 'proactive-inbox.json'

function makeMessage(overrides: Partial<ProactiveMessage> = {}): ProactiveMessage {
  return {
    id: 'msg-1',
    source: 'reminder',
    kind: 'reminder_follow_up',
    priority: 'normal',
    title: 'Stand up',
    body: 'You asked me to remind you.',
    actions: ['done'],
    createdAt: NOW,
    ...overrides,
  }
}

function createTempDir(t: TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-proactive-clear-'))
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return directory
}

function storeAt(directory: string) {
  return createProactiveInboxStore({
    getStorePath: () => path.join(directory, FILE_NAME),
    now: () => NOW,
  })
}

function inboxPath(directory: string): string {
  return path.join(directory, FILE_NAME)
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

function createFakeIpc(inbox: ReturnType<typeof createProactiveInboxStore>) {
  const sent: Array<{ channel: string; payload: unknown }> = []
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
    ipcMain: { handle: () => {} },
    getAllWindows: () => windows,
    getWindowCapability: () => 'pet',
    requireTrustedSender: () => {},
    inbox,
    logger: createFakeLogger(),
    setInterval: () => ({ unref: () => {} }),
    clearInterval: () => {},
  })

  return { ipc, sent }
}

test('clear removes the inbox file and a restarted store reads nothing back', async (t) => {
  const directory = createTempDir(t)
  const store = storeAt(directory)

  store.upsert(makeMessage())
  await store.flush()
  assert.equal(fs.existsSync(inboxPath(directory)), true)

  await store.clear()

  assert.equal(fs.existsSync(inboxPath(directory)), false)
  assert.deepEqual(store.list().entries, [])
  assert.equal(store.list().unreadCount, 0)

  const restarted = storeAt(directory)
  assert.deepEqual(restarted.list().entries, [])
  assert.equal(restarted.list().unreadCount, 0)
})

test('clearing the inbox publishes inbox:changed with a zero unread count', async (t) => {
  const directory = createTempDir(t)
  const store = storeAt(directory)
  store.upsert(makeMessage())
  await store.flush()

  const { ipc, sent } = createFakeIpc(store)
  t.after(() => ipc.stopPrune())
  await ipc.clearInbox()

  const changes = sent.filter((item) => item.channel === 'inbox:changed')
  assert.equal(changes.length, 1)
  assert.deepEqual(changes[0]?.payload, {
    unreadCount: 0,
    entries: [],
    removedIds: [],
  })
  assert.equal(fs.existsSync(inboxPath(directory)), false)
  assert.deepEqual(store.list().entries, [])
})

test('a debounced write scheduled before clear cannot recreate the file', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const directory = createTempDir(t)
  const store = storeAt(directory)

  store.upsert(makeMessage())
  assert.equal(fs.existsSync(inboxPath(directory)), false)

  await store.clear()
  t.mock.timers.tick(1_000)

  assert.equal(fs.existsSync(inboxPath(directory)), false)
})

test('clear-all runs the injected inbox clear through the real flow', async (t) => {
  const directory = createTempDir(t)
  ;(globalThis as { __nexusMemoryVectorUserData?: string }).__nexusMemoryVectorUserData = directory
  t.after(() => {
    delete (globalThis as { __nexusMemoryVectorUserData?: string }).__nexusMemoryVectorUserData
  })

  const store = storeAt(directory)
  store.upsert(makeMessage())
  await store.flush()
  assert.equal(fs.existsSync(inboxPath(directory)), true)

  const { clearMemoryUserData } = await import('../electron/services/memoryUserDataClear.js')
  let calls = 0
  const result = await clearMemoryUserData({
    userDataPath: directory,
    needles: [],
    flushStorage: () => {},
    clearProactiveInbox: async () => {
      calls += 1
      await store.clear()
    },
  })

  assert.equal(calls, 1)
  assert.equal(result.proactiveInboxCleared, true)
  assert.equal(fs.existsSync(inboxPath(directory)), false)
  assert.deepEqual(store.list().entries, [])
})
