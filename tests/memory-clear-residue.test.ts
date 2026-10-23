import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { register } from 'node:module'
import { test } from 'node:test'

import {
  crc32cChecksum,
  encodeLevelDbLog,
  readLevelDbLogPayloads,
} from '../electron/services/chromiumStorageScrub.js'
import {
  applyMemoryLocalDataMigration,
  readMemoryLocalData,
} from '../electron/services/localDataMemoryStore.js'
import { buildMemoryLocalDataMigrationPackageFromState } from '../src/lib/storage/memoryLocalDataMigration.ts'
import {
  AMBIENT_PRESENCE_STORAGE_KEY,
  PRESENCE_HISTORY_STORAGE_KEY,
} from '../src/lib/storage/core.ts'
import { purgeClearedMemories } from '../src/lib/storage/purgeMemoryStores.ts'
import type { DailyMemoryStore, MemoryItem } from '../src/types/memory.ts'

register(new URL('./helpers/memory-vector-electron-hooks.mjs', import.meta.url))

const SECRET = 'NEXUSMEMCLEAR7Q-violet-diary'
const SECRET_QUOTE = SECRET.slice(0, 19)
const KEEP_LOG = 'KEEP_SETTINGS_TOKEN'
const KEEP_INDEXED = 'KEEP_INDEXEDDB_NOTE'
const KEEP_GREETING = 'KEEP_GREETING_NOTE'
const PENDING_GREETING_KEY = 'nexus:pending-companion-greeting'
const AT = '2026-06-19T10:00:00.000Z'

async function treeContains(root: string, needle: string): Promise<boolean> {
  const utf8 = Buffer.from(needle, 'utf8')
  const utf16 = Buffer.from(needle, 'utf16le')
  async function walk(dir: string): Promise<boolean> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return false
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (await walk(full)) return true
      } else if (entry.isFile()) {
        const bytes = await fs.readFile(full)
        if (bytes.includes(utf8) || bytes.includes(utf16)) return true
      }
    }
    return false
  }
  return walk(root)
}

test('a LevelDB log round-trips and uses the Castagnoli checksum', () => {
  assert.equal(crc32cChecksum(Buffer.from('123456789')), 0xe3069283)
  const payloads = [Buffer.from('alpha'), Buffer.from(KEEP_LOG)]
  const read = readLevelDbLogPayloads(encodeLevelDbLog(payloads))
  assert.ok(read)
  assert.deepEqual(read.map((payload) => payload.toString('utf8')), ['alpha', KEEP_LOG])
})

test('store, recall, and clear drop memory text from vectors, sqlite, logs, and greetings', async () => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-memory-residue-'))
  ;(globalThis as { __nexusMemoryVectorUserData?: string }).__nexusMemoryVectorUserData = userDataPath
  let store: typeof import('../electron/services/memoryVectorStore.js') | null = null
  try {
    store = await import('../electron/services/memoryVectorStore.js')
    const { clearMemoryUserData } = await import('../electron/services/memoryUserDataClear.js')

    await store.indexMemory('mem-clear', SECRET, [1, 0, 0], 'long_term')
    await store.flush()
    assert.equal(await treeContains(userDataPath, SECRET), true)

    const keyword = await store.searchKeyword(SECRET)
    assert.equal(keyword.some((row) => row.id === 'mem-clear' && row.content === SECRET), true)
    const similar = await store.searchSimilar([1, 0, 0], { limit: 5, threshold: 0.5 })
    assert.equal(similar.some((row) => row.id === 'mem-clear' && row.content === SECRET), true)

    const row: MemoryItem = {
      id: 'mem-clear',
      content: SECRET,
      category: 'manual',
      source: 'manual',
      createdAt: AT,
      importance: 'normal',
      importanceScore: 0.5,
    }
    const daily: DailyMemoryStore = {
      '2026-06-19': [{
        id: 'diary-clear',
        day: '2026-06-19',
        role: 'user',
        content: SECRET,
        source: 'chat',
        createdAt: AT,
      }],
    }
    const applied = await applyMemoryLocalDataMigration({
      userDataPath,
      confirmed: true,
      migrationPackage: buildMemoryLocalDataMigrationPackageFromState([row], daily),
      now: new Date('2026-06-19T11:00:00.000Z'),
    })
    assert.equal(applied.ok, true)
    const stored = await readMemoryLocalData({ userDataPath })
    assert.equal(stored.ok, true)
    assert.equal(stored.memories.some((item) => item.content === SECRET), true)
    assert.equal(stored.daily.some((item) => item.content === SECRET), true)

    const snapshotDir = path.join(userDataPath, 'update-snapshots', 'snap-clear')
    const snapshotMemoryDir = path.join(snapshotDir, 'memory-v2')
    await fs.mkdir(snapshotMemoryDir, { recursive: true })
    await fs.writeFile(path.join(snapshotMemoryDir, 'long-term.json'), JSON.stringify([row]))
    await fs.writeFile(path.join(snapshotMemoryDir, 'daily.json'), JSON.stringify(daily))
    await fs.writeFile(path.join(snapshotMemoryDir, 'op-log.json'), JSON.stringify([{ content: SECRET }]))
    await fs.writeFile(path.join(snapshotDir, 'settings.json'), '{"keep":true}')
    await fs.writeFile(path.join(snapshotDir, 'manifest.json'), '{"keep":true}')

    const leveldb = path.join(userDataPath, 'Local Storage', 'leveldb')
    const indexeddb = path.join(userDataPath, 'IndexedDB', 'http_127.0.0.1.indexeddb.leveldb')
    const sessionStorage = path.join(userDataPath, 'Session Storage')
    await fs.mkdir(leveldb, { recursive: true })
    await fs.mkdir(indexeddb, { recursive: true })
    await fs.mkdir(sessionStorage, { recursive: true })
    const leveldbLog = path.join(leveldb, '000003.log')
    await fs.writeFile(leveldbLog, encodeLevelDbLog([
      Buffer.from(`settings:${KEEP_LOG}`),
      Buffer.from(`memory:${SECRET}`),
      Buffer.from(`greeting:${SECRET_QUOTE}`),
    ]))
    await fs.writeFile(path.join(indexeddb, '000001.log'), `note ${SECRET} ${KEEP_INDEXED}`)
    await fs.writeFile(path.join(sessionStorage, '000002.log'), encodeLevelDbLog([
      Buffer.from(SECRET, 'utf16le'),
      Buffer.from(`session:${KEEP_LOG}`),
    ]))
    await fs.writeFile(path.join(userDataPath, 'unrelated.txt'), 'leave-this-file')

    const values = new Map<string, string>([
      [PRESENCE_HISTORY_STORAGE_KEY, JSON.stringify([
        { text: `记得 ${SECRET_QUOTE}`, category: 'memory', createdAt: AT },
        { text: KEEP_GREETING, category: 'neutral', createdAt: AT },
      ])],
      [AMBIENT_PRESENCE_STORAGE_KEY, JSON.stringify({
        text: `你提过 ${SECRET}`,
        createdAt: AT,
        expiresAt: '2099-01-01T00:00:00.000Z',
      })],
      [PENDING_GREETING_KEY, JSON.stringify({ greeting: `hello ${SECRET_QUOTE}` })],
    ])
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, String(value)) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => { values.clear() },
    }
    let flushed = false
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage,
        dispatchEvent: () => true,
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        desktopPet: {
          memoryVectorClear: (payload?: { needles?: string[] }) => {
            const needles = payload?.needles ?? []
            assert.equal(needles.includes(SECRET), true)
            return clearMemoryUserData({
              userDataPath,
              needles,
              flushStorage: () => { flushed = true },
            })
          },
        },
      },
      configurable: true,
      writable: true,
    })
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorage,
      configurable: true,
      writable: true,
    })

    const pending = purgeClearedMemories([row], daily) as unknown as Promise<{
      storageFilesRewritten?: number
      snapshotMemoryFilesRemoved?: number
    } | undefined>
    assert.equal(pending instanceof Promise, true)
    const cleared = await pending
    assert.equal(flushed, true)
    assert.ok((cleared?.storageFilesRewritten ?? 0) >= 3)
    assert.equal(cleared?.snapshotMemoryFilesRemoved, 3)

    assert.equal(await treeContains(userDataPath, SECRET), false)
    assert.equal(await treeContains(userDataPath, SECRET_QUOTE), false)
    assert.equal(await treeContains(userDataPath, KEEP_LOG), true)
    assert.equal(await treeContains(userDataPath, KEEP_INDEXED), true)
    await assert.rejects(() => fs.access(snapshotMemoryDir))
    assert.equal(await fs.readFile(path.join(snapshotDir, 'settings.json'), 'utf8'), '{"keep":true}')
    assert.equal(await fs.readFile(path.join(snapshotDir, 'manifest.json'), 'utf8'), '{"keep":true}')
    assert.equal(await fs.readFile(path.join(userDataPath, 'unrelated.txt'), 'utf8'), 'leave-this-file')

    const rewritten = readLevelDbLogPayloads(await fs.readFile(leveldbLog))
    assert.ok(rewritten)
    assert.equal(rewritten.some((payload) => payload.includes(KEEP_LOG)), true)
    assert.equal(rewritten.some((payload) => payload.includes(SECRET)), false)
    assert.equal(rewritten.some((payload) => payload.includes(SECRET_QUOTE)), false)

    assert.deepEqual(await store.searchKeyword(SECRET), [])
    const similarAfter = await store.searchSimilar([1, 0, 0], { limit: 5, threshold: 0.5 })
    assert.equal(similarAfter.some((item) => String(item.content).includes(SECRET)), false)

    const after = await readMemoryLocalData({ userDataPath })
    assert.equal(after.ok, true)
    assert.equal(after.memories.some((item) => String(item.content).includes(SECRET)), false)
    assert.equal(after.daily.some((item) => String(item.content).includes(SECRET)), false)

    const storedText = [...values.values()].join('\n')
    assert.equal(storedText.includes(SECRET), false)
    assert.equal(storedText.includes(SECRET_QUOTE), false)
    assert.equal(values.get(PENDING_GREETING_KEY) ?? null, null)
    assert.equal(values.get(AMBIENT_PRESENCE_STORAGE_KEY) ?? null, null)
    // Presence lines can quote memory text, so clear-all drops the history
    // outright instead of keeping the non-memory rows in localStorage.
    assert.equal(values.get(PRESENCE_HISTORY_STORAGE_KEY) ?? null, null)
  } finally {
    await store?.terminate()
    await fs.rm(userDataPath, { recursive: true, force: true })
  }
})
