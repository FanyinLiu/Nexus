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

test('a corrupt file is backed up instead of being reported as an empty store', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-long-term-corrupt-'))
  try {
    const filePath = resolveLongTermMemoryFilePath(dir)
    const original = `{"format":"nexus-long-term-memory","version":1,"memories":[${JSON.stringify(SECRET)}`
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, original, 'utf8')
    await fs.chmod(filePath, 0o644)
    const store = createLongTermMemoryFileStore({ filePath })

    const loaded = await store.load()
    assert.equal(loaded.exists, false)
    assert.equal(loaded.corrupt, true)
    assert.equal(typeof loaded.backupPath, 'string')
    assert.deepEqual(loaded.memories, [])
    assert.equal(await fs.readFile(loaded.backupPath!, 'utf8'), original)
    await assert.rejects(() => fs.access(filePath))
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(loaded.backupPath!)).mode & 0o777, 0o600)
    }

    // A later save writes a fresh store and must not touch the backup.
    await store.save([memory('m2', 'fresh memory')])
    assert.equal(await fs.readFile(loaded.backupPath!, 'utf8'), original)
    assert.deepEqual((await store.load()).memories.map((row) => row.id), ['m2'])

    await store.clear()
    await assert.rejects(() => fs.access(loaded.backupPath!))
    assert.equal(await treeContains(dir, SECRET), false)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('a file with the wrong envelope is treated as corrupt, not empty', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-long-term-envelope-'))
  try {
    const filePath = resolveLongTermMemoryFilePath(dir)
    const original = JSON.stringify({ format: 'some-other-store', memories: [memory('m1', SECRET)] })
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, original, 'utf8')
    const store = createLongTermMemoryFileStore({ filePath })

    const loaded = await store.load()
    assert.equal(loaded.exists, false)
    assert.equal(loaded.corrupt, true)
    assert.equal(await fs.readFile(loaded.backupPath!, 'utf8'), original)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('save writes the memory file with owner-only permissions', { skip: process.platform === 'win32' }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-long-term-mode-'))
  try {
    const filePath = resolveLongTermMemoryFilePath(dir)
    const store = createLongTermMemoryFileStore({ filePath })
    await store.save([memory('m1', SECRET)])

    const mode = (await fs.stat(filePath)).mode & 0o777
    assert.equal(mode, 0o600)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('save creates the memory directory with owner-only permissions', { skip: process.platform === 'win32' }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-long-term-dir-mode-'))
  try {
    const filePath = resolveLongTermMemoryFilePath(dir)
    const store = createLongTermMemoryFileStore({ filePath })
    await store.save([memory('m1', SECRET)])

    const mode = (await fs.stat(path.dirname(filePath))).mode & 0o777
    assert.equal(mode, 0o700)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('save tightens an existing directory that was created with a looser mode', { skip: process.platform === 'win32' }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-long-term-dir-fix-'))
  try {
    const filePath = resolveLongTermMemoryFilePath(dir)
    const memoryDir = path.dirname(filePath)
    await fs.mkdir(memoryDir, { recursive: true })
    await fs.chmod(memoryDir, 0o755)
    const store = createLongTermMemoryFileStore({ filePath })
    await store.save([memory('m1', SECRET)])

    const mode = (await fs.stat(memoryDir)).mode & 0o777
    assert.equal(mode, 0o700)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
