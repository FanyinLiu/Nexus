import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  createProactiveInboxStore,
  PROACTIVE_INBOX_MAX_ENTRIES,
} from '../electron/services/proactiveInboxStore.js'
import type { ProactiveInboxEntry, ProactiveInboxStatus } from '../shared/proactiveDelivery.js'

const NOW = 1_700_000_000_000
const DAY_MS = 24 * 60 * 60 * 1000
const FILE_NAME = 'proactive-inbox.json'

function createTempDir(t: TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-proactive-retention-'))
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

function makeStoredEntry(
  id: string,
  createdAt: number,
  status: ProactiveInboxStatus = 'unread',
): ProactiveInboxEntry {
  return {
    id,
    source: 'reminder',
    kind: 'reminder_follow_up',
    priority: 'normal',
    title: `Title ${id}`,
    body: `Body ${id}`,
    actions: ['done'],
    createdAt,
    status,
    updatedAt: createdAt,
  }
}

function writeInbox(directory: string, entries: ProactiveInboxEntry[]): void {
  fs.writeFileSync(path.join(directory, FILE_NAME), JSON.stringify({ entries }))
}

function readPersistedIds(directory: string): string[] {
  const persisted = JSON.parse(fs.readFileSync(path.join(directory, FILE_NAME), 'utf8')) as {
    entries: Array<{ id: string }>
  }
  return persisted.entries.map((entry) => entry.id)
}

test('the retention window is exactly 15 days, keeping the boundary', (t) => {
  const directory = createTempDir(t)
  writeInbox(directory, [
    makeStoredEntry('boundary', NOW - 15 * DAY_MS),
    makeStoredEntry('just-over', NOW - 15 * DAY_MS - 1),
  ])

  assert.deepEqual(
    storeAt(directory).list().entries.map((entry) => entry.id),
    ['boundary'],
  )
})

test('20-day and 29-day old entries are removed regardless of status', (t) => {
  const directory = createTempDir(t)
  writeInbox(directory, [
    makeStoredEntry('day-20', NOW - 20 * DAY_MS, 'done'),
    makeStoredEntry('day-29', NOW - 29 * DAY_MS, 'read'),
    makeStoredEntry('day-14', NOW - 14 * DAY_MS, 'unread'),
  ])

  assert.deepEqual(
    storeAt(directory).list().entries.map((entry) => entry.id),
    ['day-14'],
  )
})

test('the 100-entry cap still drops the oldest entries first', (t) => {
  const directory = createTempDir(t)
  const entries = Array.from(
    { length: PROACTIVE_INBOX_MAX_ENTRIES + 3 },
    (_, index) => makeStoredEntry(`entry-${index}`, NOW - index * 1000),
  )
  writeInbox(directory, entries)

  const ids = storeAt(directory).list().entries.map((entry) => entry.id)
  assert.equal(ids.length, PROACTIVE_INBOX_MAX_ENTRIES)
  assert.equal(ids[0], 'entry-0')
  assert.equal(ids.at(-1), `entry-${PROACTIVE_INBOX_MAX_ENTRIES - 1}`)
})

test('the first load after the retention change persists the pruned file immediately', async (t) => {
  const directory = createTempDir(t)
  writeInbox(directory, [
    makeStoredEntry('day-1', NOW - DAY_MS, 'unread'),
    makeStoredEntry('day-14', NOW - 14 * DAY_MS, 'read'),
    makeStoredEntry('day-16', NOW - 16 * DAY_MS, 'done'),
    makeStoredEntry('day-29', NOW - 29 * DAY_MS, 'unread'),
  ])

  const store = storeAt(directory)
  const snapshot = store.list()

  assert.deepEqual(
    snapshot.entries.map((entry) => entry.id),
    ['day-1', 'day-14'],
  )
  assert.equal(await store.flush(), true)
  assert.deepEqual(readPersistedIds(directory), ['day-1', 'day-14'])
})
