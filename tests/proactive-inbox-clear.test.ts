import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { register } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  clearProactiveInbox,
  createProactiveIpc,
  register as registerProactiveIpc,
  stopProactiveInboxPrune,
} from '../electron/ipc/proactiveIpc.js'
import { clearLogs, getLogEntries, setConsolePassthrough, type Logger } from '../electron/logger.js'
import { createProactiveInboxStore } from '../electron/services/proactiveInboxStore.js'
import type { ProactiveMessage } from '../shared/proactiveDelivery.js'

setConsolePassthrough(false)

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

/** A non-empty directory at the store path makes `rm` refuse without recursive. */
function makeInboxUndeletable(directory: string): void {
  const target = inboxPath(directory)
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

function createFakeIpc(inbox: ReturnType<typeof createProactiveInboxStore>) {
  const sent: Array<{ channel: string; payload: unknown }> = []
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()
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
      handle: (channel, listener) => {
        handlers.set(channel, listener)
      },
    },
    getAllWindows: () => windows,
    getWindowCapability: () => 'pet',
    requireTrustedSender: () => {},
    inbox,
    logger: createFakeLogger(),
    setInterval: () => ({ unref: () => {} }),
    clearInterval: () => {},
    strip: {
      show: () => true,
      withdraw: () => true,
      withdrawAll: () => {},
    },
    getStripLabels: () => ({ done: 'Done', snooze: 'Snooze 10 min', open: 'Open chat' }),
    showOsNotification: () => {},
    isPanelFocused: () => false,
  })

  return { ipc, sent, handlers }
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

test('clear reports failure and keeps cached entries when the file cannot be deleted', async (t) => {
  const directory = createTempDir(t)
  const store = storeAt(directory)
  store.upsert(makeMessage())
  await store.flush()
  assert.equal(store.list().unreadCount, 1)

  makeInboxUndeletable(directory)

  assert.equal(await store.clear(), false)
  assert.equal(fs.existsSync(inboxPath(directory)), true)
  // The cache must still describe the file that survived the delete attempt.
  assert.deepEqual(store.list().entries.map((entry) => entry.id), ['msg-1'])
  assert.equal(store.list().unreadCount, 1)
})

test('clear treats a missing inbox file as success', async (t) => {
  const directory = createTempDir(t)
  const store = storeAt(directory)

  assert.equal(await store.clear(), true)
  assert.deepEqual(store.list().entries, [])
})

test('clear treats an ENOENT delete error as success', async (t) => {
  const directory = createTempDir(t)
  const store = storeAt(directory)
  t.mock.method(fsp, 'rm', async () => {
    throw Object.assign(new Error('missing inbox file'), { code: 'ENOENT' })
  })

  assert.equal(await store.clear(), true)
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
    changes: [],
    removedIds: [],
  })
  assert.equal(fs.existsSync(inboxPath(directory)), false)
  assert.deepEqual(store.list().entries, [])
})

test('a failed inbox delete throws and never publishes a zero unread count', async (t) => {
  const directory = createTempDir(t)
  const store = storeAt(directory)
  store.upsert(makeMessage())
  await store.flush()
  const before = store.list()
  makeInboxUndeletable(directory)

  const { ipc, sent, handlers } = createFakeIpc(store)
  t.after(() => ipc.stopPrune())

  await assert.rejects(
    () => ipc.clearInbox(),
    /NEXUS_ERR_PROACTIVE_INBOX_CLEAR_FAILED/,
  )
  assert.equal(sent.filter((item) => item.channel === 'inbox:changed').length, 0)

  const listInbox = handlers.get('inbox:list')
  assert.ok(listInbox, 'expected inbox:list to be registered')
  const snapshot = await listInbox(null) as {
    entries: Array<{ id: string }>
    unreadCount: number
  }
  assert.deepEqual(snapshot.entries.map((entry) => entry.id), ['msg-1'])
  assert.equal(snapshot.unreadCount, before.unreadCount)
})

test('the exported clearProactiveInbox wrapper propagates the delete failure', async (t) => {
  const directory = createTempDir(t)
  const seed = storeAt(directory)
  seed.upsert(makeMessage())
  await seed.flush()
  makeInboxUndeletable(directory)

  registerProactiveIpc({
    app: { getPath: () => directory },
    ipcMain: { handle: () => {} },
    getAllWindows: () => [],
    requireTrustedSender: () => {},
    isPanelFocused: () => false,
    getDeliveryContext: async () => ({
      panelFocused: false,
      fullscreen: false,
      focusState: 'active',
      inQuietHours: false,
      systemDnd: null,
      awayNotificationsEnabled: false,
      stripEnabled: true,
    }),
    setDeliveryPreferences: () => {},
    strip: {
      show: () => true,
      withdraw: () => true,
      withdrawAll: () => {},
    },
    showOsNotification: () => {},
  })
  t.after(() => stopProactiveInboxPrune())

  await assert.rejects(
    () => clearProactiveInbox(),
    /NEXUS_ERR_PROACTIVE_INBOX_CLEAR_FAILED/,
  )
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

test('a clear during an in-flight persist leaves no file and a restarted store empty', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const directory = createTempDir(t)
  const store = storeAt(directory)

  store.upsert(makeMessage())
  // Start the debounced persist, then clear while the atomic write is in
  // flight. The store must wait for it and delete the file afterwards.
  t.mock.timers.tick(400)
  const clearing = store.clear()
  await clearing
  await store.flush()
  t.mock.timers.tick(1_000)

  assert.equal(fs.existsSync(inboxPath(directory)), false)
  assert.deepEqual(store.list().entries, [])

  const restarted = storeAt(directory)
  assert.deepEqual(restarted.list().entries, [])
  assert.equal(restarted.list().unreadCount, 0)
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

test('a vector clear failure still clears the inbox and rethrows the original error', async (t) => {
  const directory = createTempDir(t)
  // A directory where the snapshot temp file must be written makes the vector
  // snapshot compaction fail, which is the throw the inbox clear must survive.
  fs.mkdirSync(path.join(directory, 'memory-vectors.json.tmp'))
  ;(globalThis as { __nexusMemoryVectorUserData?: string }).__nexusMemoryVectorUserData = directory
  t.after(() => {
    delete (globalThis as { __nexusMemoryVectorUserData?: string }).__nexusMemoryVectorUserData
  })

  const { clearMemoryUserData } = await import('../electron/services/memoryUserDataClear.js')
  let inboxClears = 0
  let caught: unknown
  try {
    await clearMemoryUserData({
      clearProactiveInbox: async () => {
        inboxClears += 1
        throw new Error('secondary inbox failure')
      },
    })
  } catch (error) {
    caught = error
  }

  assert.equal(inboxClears, 1)
  assert.ok(caught instanceof Error)
  const message = caught instanceof Error ? caught.message : ''
  assert.notEqual(message, 'secondary inbox failure')
})

test('an inbox failure after a successful clear propagates', async (t) => {
  const directory = createTempDir(t)
  ;(globalThis as { __nexusMemoryVectorUserData?: string }).__nexusMemoryVectorUserData = directory
  t.after(() => {
    delete (globalThis as { __nexusMemoryVectorUserData?: string }).__nexusMemoryVectorUserData
  })

  const { clearMemoryUserData } = await import('../electron/services/memoryUserDataClear.js')
  let inboxClears = 0
  await assert.rejects(
    () => clearMemoryUserData({
      clearProactiveInbox: async () => {
        inboxClears += 1
        throw new Error('inbox clear failed')
      },
    }),
    /inbox clear failed/,
  )
  assert.equal(inboxClears, 1)
})

test('an inbox-only clear failure logs once without the raw path', async (t) => {
  const directory = createTempDir(t)
  ;(globalThis as { __nexusMemoryVectorUserData?: string }).__nexusMemoryVectorUserData = directory
  t.after(() => {
    delete (globalThis as { __nexusMemoryVectorUserData?: string }).__nexusMemoryVectorUserData
  })

  const { clearMemoryUserData } = await import('../electron/services/memoryUserDataClear.js')
  clearLogs()
  await assert.rejects(
    () => clearMemoryUserData({
      clearProactiveInbox: async () => {
        throw new Error('EACCES: permission denied, unlink /Users/x/proactive-inbox.json')
      },
    }),
    /EACCES/,
  )

  const entries = getLogEntries({ module: 'memory.userDataClear' })
  assert.equal(entries.length, 1)
  const serialized = JSON.stringify(entries)
  assert.equal(serialized.includes('EACCES'), false)
  assert.equal(serialized.includes('/Users/x'), false)
  assert.equal(serialized.includes('proactive inbox clear failed'), true)
})
