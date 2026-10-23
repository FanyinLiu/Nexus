import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  LONG_TERM_MEMORY_ERROR_CODES,
  createLongTermMemoryFileStore,
  resolveLongTermMemoryFilePath,
} from '../electron/services/longTermMemoryFileStore.js'

const SECRET = 'NEXUSLTFILE-4R2-secret-memory'

function memory(id: string, content: string) {
  return {
    id,
    content,
    category: 'manual',
    source: 'manual',
    createdAt: '2026-10-20T00:00:00.000Z',
    schemaVersion: 2,
    status: 'active',
    updatedAt: '2026-10-20T00:00:00.000Z',
  }
}

async function treeContains(root: string, needle: string): Promise<boolean> {
  const utf8 = Buffer.from(needle, 'utf8')
  const utf16 = Buffer.from(needle, 'utf16le')
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (await treeContains(full, needle)) return true
      continue
    }
    const bytes = await fs.readFile(full)
    if (bytes.includes(utf8) || bytes.includes(utf16)) return true
  }
  return false
}

test('the long-term file store round-trips memories in a temp directory', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-long-term-store-'))
  try {
    const filePath = resolveLongTermMemoryFilePath(dir)
    const store = createLongTermMemoryFileStore({ filePath })
    const rows = [memory('m1', SECRET), memory('m2', 'second memory')]

    assert.deepEqual(await store.load(), { exists: false, memories: [] })
    assert.deepEqual(await store.save(rows), { ok: true, count: 2 })
    assert.deepEqual(await store.load(), { exists: true, memories: rows })

    const reopened = createLongTermMemoryFileStore({ filePath })
    assert.deepEqual(await reopened.load(), { exists: true, memories: rows })
    assert.equal(await treeContains(dir, SECRET), true)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('clear deletes the file and every temp/backup sibling', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-long-term-clear-'))
  try {
    const filePath = resolveLongTermMemoryFilePath(dir)
    const store = createLongTermMemoryFileStore({ filePath })
    await store.save([memory('m1', SECRET)])
    assert.equal(await treeContains(dir, SECRET), true)

    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(`${filePath}.123.456.tmp`, JSON.stringify([memory('m1', SECRET)]), 'utf8')
    await fs.writeFile(`${filePath}.bak`, JSON.stringify([memory('m1', SECRET)]), 'utf8')

    assert.deepEqual(await store.clear(), { ok: true })
    assert.deepEqual(await store.load(), { exists: false, memories: [] })
    assert.equal(await treeContains(dir, SECRET), false)

    const entries = await fs.readdir(path.dirname(filePath))
    assert.deepEqual(entries, [])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('save rejects non-array payloads and non-object rows', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-long-term-invalid-'))
  try {
    const store = createLongTermMemoryFileStore({ filePath: resolveLongTermMemoryFilePath(dir) })
    await assert.rejects(
      () => store.save('not-an-array' as unknown as unknown[]),
      (error: unknown) => (error as { code?: string }).code === LONG_TERM_MEMORY_ERROR_CODES.INVALID_PAYLOAD,
    )
    await assert.rejects(
      () => store.save([42] as unknown[]),
      (error: unknown) => (error as { code?: string }).code === LONG_TERM_MEMORY_ERROR_CODES.INVALID_PAYLOAD,
    )
    assert.deepEqual(await store.load(), { exists: false, memories: [] })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
