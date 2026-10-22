import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { register } from 'node:module'
import { test } from 'node:test'

import { applyMemoryLocalDataMigration } from '../electron/services/localDataMemoryStore.js'
import { buildMemoryLocalDataMigrationPackageFromState } from '../src/lib/storage/memoryLocalDataMigration.ts'

register(new URL('./helpers/memory-vector-electron-hooks.mjs', import.meta.url))

const DELETE_SECRET = 'NEXUS_SECRET_DELETE_ONE_peanut'
const CLEAR_SECRET = 'NEXUS_SECRET_CLEAR_ALL_diary'
const VECTOR_SNAPSHOT_FILE = 'memory-vectors.json'

async function readTree(root: string): Promise<string> {
  const chunks: string[] = []
  async function walk(dir: string) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else {
        chunks.push(await fs.readFile(full, 'utf8'))
      }
    }
  }
  await walk(root)
  return chunks.join('\n')
}

async function readVectorEntries(root: string): Promise<Array<{ id: string, content: string }>> {
  const raw = await fs.readFile(path.join(root, VECTOR_SNAPSHOT_FILE), 'utf8')
  const parsed = JSON.parse(raw) as { entries?: Array<{ id?: string, content?: string }> }
  return (parsed.entries ?? []).map((entry) => ({
    id: String(entry.id ?? ''),
    content: String(entry.content ?? ''),
  }))
}

test('single delete and clear all remove memory plaintext from disk', async () => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-memory-delete-'))
  ;(globalThis as { __nexusMemoryVectorUserData?: string }).__nexusMemoryVectorUserData = userDataPath
  try {
    const store = await import('../electron/services/memoryVectorStore.js')

    await store.indexMemory('mem-delete', DELETE_SECRET, [0.2, 0.4, 0.6], 'long_term')
    await store.flush()
    assert.match(await readTree(userDataPath), new RegExp(DELETE_SECRET))
    assert.deepEqual(
      (await readVectorEntries(userDataPath)).map((entry) => entry.id),
      ['mem-delete'],
    )

    const removed = await store.removeMemory('mem-delete')
    assert.equal(removed, true)
    assert.equal((await readTree(userDataPath)).includes(DELETE_SECRET), false)
    assert.deepEqual(await readVectorEntries(userDataPath), [])

    await store.indexMemory('mem-clear', CLEAR_SECRET, [0.1, 0.3], 'long_term')
    await store.indexMemory('diary-clear', `${CLEAR_SECRET}-note`, [0.5], 'daily')
    await store.flush()

    const migrationPackage = buildMemoryLocalDataMigrationPackageFromState(
      [{
        id: 'mem-clear',
        content: CLEAR_SECRET,
        category: 'manual',
        source: 'manual',
        createdAt: '2026-06-19T10:00:00.000Z',
        importance: 'normal',
        importanceScore: 0.5,
      }],
      {
        '2026-06-19': [{
          id: 'diary-clear',
          day: '2026-06-19',
          role: 'user',
          content: `${CLEAR_SECRET}-note`,
          source: 'chat',
          createdAt: '2026-06-19T10:30:00.000Z',
        }],
      },
    )
    const applied = await applyMemoryLocalDataMigration({
      userDataPath,
      confirmed: true,
      migrationPackage,
      now: new Date('2026-06-19T11:00:00.000Z'),
    })
    assert.equal(applied.ok, true)
    assert.match(await readTree(userDataPath), new RegExp(CLEAR_SECRET))

    const { clearMemoryLocalDataContent } = await import('../electron/services/localDataMemoryStore.js')
    await store.clearAllEntries()
    const cleared = await clearMemoryLocalDataContent({ userDataPath })
    assert.equal(cleared.ok, true)
    const after = await readTree(userDataPath)
    assert.equal(after.includes(CLEAR_SECRET), false)
    assert.equal(after.includes(DELETE_SECRET), false)
    assert.deepEqual(await readVectorEntries(userDataPath), [])
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true })
  }
})
