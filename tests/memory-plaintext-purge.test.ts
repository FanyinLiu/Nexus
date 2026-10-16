import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { peekDeletedMemory, clearDeletedMemorySession } from '../src/features/memory/deletedMemorySession.ts'
import {
  MEMORY_DATA_FILES,
  REDACTED_MEMORY_NOTE,
  scrubMemoryDataFiles,
} from '../src/features/memory/purgeMemoryText.ts'
import {
  CHAT_STORAGE_KEY,
  DAILY_MEMORY_STORAGE_KEY,
  MEMORY_OP_LOG_STORAGE_KEY,
  MEMORY_RUN_SNAPSHOT_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
  MEMORY_V1_BACKUP_STORAGE_KEY,
  PROACTIVE_AGENDA_STORAGE_KEY,
  REMINDER_TASKS_STORAGE_KEY,
} from '../src/lib/storage/core.ts'
import { ARCHIVE_STORAGE_KEY } from '../src/features/memory/coldArchive.ts'
import {
  purgeClearedMemories,
  purgeDeletedMemory,
  readMemoryDataFiles,
} from '../src/lib/storage/purgeMemoryStores.ts'
import type { MemoryItem } from '../src/types/memory.ts'

const SECRET = 'SECRET-南山出入境大厅-TOKEN'
const PLACE = '南山出入境大厅'
const KEPT = '我喜欢喝茶'
const CHAT_USER = '你好'
const OTHER_REMINDER = '买牛奶'
const AT = '2026-10-16T03:00:00.000Z'

function memory(patch: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'content'>): MemoryItem {
  return {
    category: 'goal',
    source: 'chat',
    kind: 'open_loop',
    loopStatus: 'open',
    createdAt: AT,
    enabled: true,
    status: 'active',
    ...patch,
  }
}

function filesWithSecret(): Record<string, string> {
  const row = memory({
    id: 'mem-secret',
    content: SECRET,
    loopPlace: PLACE,
    loopReminderTaskId: 'reminder-secret',
    evidence: [{ day: '2026-10-16', quote: SECRET, at: AT }],
  })
  const kept = memory({ id: 'mem-kept', content: KEPT, kind: 'fact' })
  return {
    [MEMORY_DATA_FILES.longTerm]: JSON.stringify([row, kept]),
    [MEMORY_DATA_FILES.daily]: JSON.stringify({ '2026-10-16': [{ id: 'day-1', content: SECRET }] }),
    [MEMORY_DATA_FILES.snapshots]: JSON.stringify([
      { id: 'run-1', at: AT, memories: [row, kept] },
      { id: 'run-2', at: AT, memories: [row] },
    ]),
    [MEMORY_DATA_FILES.opLog]: JSON.stringify([{
      id: 'op-add',
      at: AT,
      actor: 'turn',
      op: 'ADD',
      targetIds: ['mem-secret'],
      evidenceQuote: SECRET,
      before: [row],
    }]),
    [MEMORY_DATA_FILES.v1Backup]: JSON.stringify([row]),
    [MEMORY_DATA_FILES.archive]: JSON.stringify([{ id: 'mem-secret', content: SECRET }]),
    [MEMORY_DATA_FILES.narrative]: JSON.stringify({
      threads: [{ id: 'thread-1', title: SECRET, summary: SECRET, memoryIds: ['mem-secret'] }],
    }),
    [MEMORY_DATA_FILES.agenda]: JSON.stringify({
      items: [
        { id: 'agenda-1', kind: 'open_loop', sourceId: 'mem-secret', summary: SECRET },
        { id: 'agenda-2', kind: 'message_follow_up', sourceId: 'other', summary: OTHER_REMINDER },
      ],
    }),
    [MEMORY_DATA_FILES.reminders]: JSON.stringify([
      { id: 'reminder-secret', title: SECRET, prompt: SECRET },
      { id: 'reminder-milk', title: OTHER_REMINDER, prompt: OTHER_REMINDER },
    ]),
    [MEMORY_DATA_FILES.chat]: JSON.stringify([
      { id: 'user-1', role: 'user', content: CHAT_USER },
      {
        id: 'bot-1',
        role: 'assistant',
        content: `提醒 ${SECRET}`,
        proactiveWhy: { summary: SECRET, quote: PLACE, at: AT, place: PLACE },
      },
    ]),
    [MEMORY_DATA_FILES.callbacks]: JSON.stringify([{ memoryId: 'mem-secret', queuedAt: AT, expiresAt: AT }]),
    'scratch.txt': `offline copy ${SECRET} at ${PLACE}`,
  }
}

function writeDir(dir: string, files: Record<string, string>): void {
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), text)
  }
}

function readDir(dir: string): Record<string, string> {
  const files: Record<string, string> = {}
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isFile()) files[name] = fs.readFileSync(full, 'utf8')
  }
  return files
}

function filesContaining(dir: string, needle: string): string[] {
  return Object.entries(readDir(dir))
    .filter(([, text]) => text.includes(needle))
    .map(([name]) => name)
}

function installStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      dispatchEvent: () => true,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
    configurable: true,
    writable: true,
  })
  return localStorage
}

test('delete removes the wording from every file in the memory data dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-memory-data-'))
  writeDir(dir, filesWithSecret())
  const next = scrubMemoryDataFiles(readDir(dir), {
    ids: ['mem-secret'],
    needles: [SECRET, PLACE],
    reminderIds: ['reminder-secret'],
    at: AT,
  })
  writeDir(dir, next)

  assert.deepEqual(filesContaining(dir, SECRET), [])
  assert.deepEqual(filesContaining(dir, PLACE), [])
  const after = readDir(dir)
  assert.equal(after[MEMORY_DATA_FILES.longTerm]?.includes(KEPT), true)
  assert.equal(after[MEMORY_DATA_FILES.chat]?.includes(CHAT_USER), true)
  assert.equal(after[MEMORY_DATA_FILES.reminders]?.includes(OTHER_REMINDER), true)
  assert.equal(after[MEMORY_DATA_FILES.opLog]?.includes('user-deleted'), true)
  assert.equal(after[MEMORY_DATA_FILES.opLog]?.includes(REDACTED_MEMORY_NOTE), true)
  assert.equal(after['scratch.txt']?.includes(SECRET), false)
})

test('clear all removes every memory wording from the memory data dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-memory-data-'))
  const files = filesWithSecret()
  const second = 'SECRET-交报告-TOKEN'
  files[MEMORY_DATA_FILES.longTerm] = JSON.stringify([
    memory({ id: 'mem-secret', content: SECRET, loopPlace: PLACE }),
    memory({ id: 'mem-report', content: second }),
  ])
  files['notes.txt'] = second
  writeDir(dir, files)
  const next = scrubMemoryDataFiles(readDir(dir), {
    ids: ['mem-secret', 'mem-report'],
    needles: [SECRET, PLACE, second],
    clearAll: true,
    at: AT,
  })
  writeDir(dir, next)

  assert.deepEqual(filesContaining(dir, SECRET), [])
  assert.deepEqual(filesContaining(dir, PLACE), [])
  assert.deepEqual(filesContaining(dir, second), [])
  const after = readDir(dir)
  assert.equal(after[MEMORY_DATA_FILES.snapshots], '[]')
  assert.equal(after[MEMORY_DATA_FILES.opLog]?.includes('user-deleted'), true)
  assert.equal(after[MEMORY_DATA_FILES.reminders]?.includes(OTHER_REMINDER), true)
})

test('stored delete and clear all leave the wording out of the memory data dir', () => {
  clearDeletedMemorySession()
  const row = memory({
    id: 'mem-secret',
    content: SECRET,
    loopPlace: PLACE,
    loopReminderTaskId: 'reminder-secret',
    evidence: [{ day: '2026-10-16', quote: SECRET, at: AT }],
  })
  const kept = memory({ id: 'mem-kept', content: KEPT, kind: 'fact' })
  installStorage({
    [MEMORY_STORAGE_KEY]: JSON.stringify([row, kept]),
    [DAILY_MEMORY_STORAGE_KEY]: JSON.stringify({ '2026-10-16': [{ id: 'day-1', day: '2026-10-16', role: 'user', content: SECRET, source: 'chat', createdAt: AT }] }),
    [MEMORY_RUN_SNAPSHOT_STORAGE_KEY]: JSON.stringify([{ id: 'run-1', at: AT, memories: [row] }]),
    [MEMORY_OP_LOG_STORAGE_KEY]: JSON.stringify([{
      id: 'op-add',
      at: AT,
      actor: 'turn',
      op: 'ADD',
      targetIds: ['mem-secret'],
      evidenceQuote: SECRET,
      before: [row],
    }]),
    [MEMORY_V1_BACKUP_STORAGE_KEY]: JSON.stringify([row]),
    [ARCHIVE_STORAGE_KEY]: JSON.stringify([{ id: 'mem-secret', content: SECRET }]),
    [PROACTIVE_AGENDA_STORAGE_KEY]: JSON.stringify({ items: [{ id: 'agenda-1', kind: 'open_loop', sourceId: 'mem-secret', summary: SECRET }] }),
    [REMINDER_TASKS_STORAGE_KEY]: JSON.stringify([{ id: 'reminder-secret', title: SECRET, prompt: PLACE }]),
    [CHAT_STORAGE_KEY]: JSON.stringify([
      { id: 'user-1', role: 'user', content: CHAT_USER },
      { id: 'bot-1', role: 'assistant', content: SECRET, proactiveWhy: { quote: SECRET, summary: PLACE, at: AT } },
    ]),
  })

  purgeDeletedMemory(row, AT)
  const deletedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-memory-data-'))
  writeDir(deletedDir, readMemoryDataFiles())
  assert.deepEqual(filesContaining(deletedDir, SECRET), [])
  assert.deepEqual(filesContaining(deletedDir, PLACE), [])
  assert.equal(readDir(deletedDir)[MEMORY_DATA_FILES.longTerm]?.includes(KEPT), true)
  assert.equal(peekDeletedMemory('mem-secret')?.content, SECRET)

  purgeClearedMemories([kept], { '2026-10-16': [{ id: 'day-2', day: '2026-10-16', role: 'user', content: KEPT, source: 'chat', createdAt: AT }] }, AT)
  const clearedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-memory-data-'))
  writeDir(clearedDir, readMemoryDataFiles())
  assert.deepEqual(filesContaining(clearedDir, SECRET), [])
  assert.deepEqual(filesContaining(clearedDir, PLACE), [])
  assert.deepEqual(filesContaining(clearedDir, KEPT), [])
  assert.equal(peekDeletedMemory('mem-secret'), null)
})
