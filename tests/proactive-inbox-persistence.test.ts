import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'

import { createProactiveInboxStore } from '../electron/services/proactiveInboxStore.js'
import type {
  ProactiveInboxEntry,
  ProactiveMessage,
} from '../shared/proactiveDelivery.js'

const NOW = 1_700_000_000_000
const DAY_MS = 24 * 60 * 60 * 1000
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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-proactive-persist-'))
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

function writeInbox(directory: string, value: unknown): void {
  fs.writeFileSync(path.join(directory, FILE_NAME), JSON.stringify(value))
}

function makeStoredEntry(overrides: Partial<ProactiveInboxEntry> = {}): ProactiveInboxEntry {
  return {
    ...makeMessage(),
    status: 'unread',
    updatedAt: NOW,
    ...overrides,
  }
}

test('a restarted store reads the persisted entries and statuses back', async (t) => {
  const directory = createTempDir(t)
  const first = storeAt(directory)

  first.upsert(makeMessage({ id: 'todo', title: 'Still unread' }))
  first.upsert(makeMessage({ id: 'done', title: 'Already done', createdAt: NOW + 1 }))
  first.setStatus('done', 'done')
  await first.flush()

  const restarted = storeAt(directory)
  const snapshot = restarted.list()

  assert.deepEqual(snapshot.entries.map((entry) => entry.id), ['done', 'todo'])
  assert.equal(snapshot.entries.find((entry) => entry.id === 'done')?.status, 'done')
  assert.equal(snapshot.entries.find((entry) => entry.id === 'todo')?.status, 'unread')
  assert.equal(snapshot.unreadCount, 1)
})

test('entries past 30 days or past expiresAt are pruned on load', (t) => {
  const directory = createTempDir(t)
  writeInbox(directory, {
    entries: [
      makeStoredEntry({ id: 'keep', createdAt: NOW - DAY_MS }),
      makeStoredEntry({ id: 'too-old', createdAt: NOW - 30 * DAY_MS - 1 }),
      makeStoredEntry({ id: 'expired', createdAt: NOW - DAY_MS, expiresAt: NOW }),
    ],
  })

  const snapshot = storeAt(directory).list()

  assert.deepEqual(snapshot.entries.map((entry) => entry.id), ['keep'])
  assert.ok(!snapshot.entries.some((entry) => entry.id === 'too-old' || entry.id === 'expired'))
})

test('a corrupt JSON file loads as an empty inbox without throwing', (t) => {
  const directory = createTempDir(t)
  fs.writeFileSync(path.join(directory, FILE_NAME), '{not valid json')

  const snapshot = storeAt(directory).list()

  assert.deepEqual(snapshot.entries, [])
  assert.equal(snapshot.unreadCount, 0)
})

test('a file whose root is the wrong shape loads as an empty inbox', (t) => {
  const directory = createTempDir(t)

  writeInbox(directory, [makeStoredEntry()])
  assert.deepEqual(storeAt(directory).list().entries, [])

  writeInbox(directory, { entries: 'not-an-array' })
  assert.deepEqual(storeAt(directory).list().entries, [])
})

test('invalid records are dropped on load and valid records survive', (t) => {
  const directory = createTempDir(t)
  writeInbox(directory, {
    entries: [
      makeStoredEntry({ id: 'valid-one' }),
      makeStoredEntry({ id: 'valid-two', createdAt: NOW + 1 }),
      makeStoredEntry({ id: '' }),
      makeStoredEntry({ id: 'bad-status', status: 'archived' as ProactiveInboxEntry['status'] }),
      makeStoredEntry({ id: 'bad-source', source: 'telegram' as ProactiveInboxEntry['source'] }),
      { ...makeStoredEntry({ id: 'bad-created-at' }), createdAt: 'yesterday' },
      makeStoredEntry({ id: 'oversized-title', title: 'x'.repeat(81) }),
    ],
  })

  const snapshot = storeAt(directory).list()

  assert.deepEqual(snapshot.entries.map((entry) => entry.id), ['valid-two', 'valid-one'])
})
