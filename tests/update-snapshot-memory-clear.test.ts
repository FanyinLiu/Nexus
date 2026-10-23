import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  removeMemoryFromUpdateSnapshots,
  writeUpdateSnapshot,
} from '../electron/services/updateInstallPrep.js'

const MARKER = 'NEXUSSNAPCLEAR-7Q-marker-memory'

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

async function writeHandmadeSnapshot(directory: string, settings: string) {
  await fs.mkdir(path.join(directory, 'memory-v2'), { recursive: true })
  await fs.writeFile(path.join(directory, 'memory-v2', 'long-term.json'), JSON.stringify([{ content: MARKER }]))
  await fs.writeFile(path.join(directory, 'memory-v2', 'daily.json'), MARKER)
  await fs.writeFile(path.join(directory, 'memory-v2', 'op-log.json'), MARKER)
  await fs.writeFile(path.join(directory, 'settings.json'), settings)
  await fs.writeFile(path.join(directory, 'manifest.json'), '{"format":"nexus-update-snapshot"}')
}

test('removeMemoryFromUpdateSnapshots deletes every snapshot memory copy', async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-update-snapshot-clear-'))
  try {
    const root = path.join(userData, 'update-snapshots')
    const created = await writeUpdateSnapshot({
      userDataPath: userData,
      fromVersion: '0.4.8',
      toVersion: '0.5.0',
      now: new Date('2026-10-20T00:00:00.000Z'),
      settings: '{"uiLanguage":"zh-CN"}',
      memoryV2: {
        longTerm: JSON.stringify([{ id: 'm1', content: MARKER }]),
        daily: JSON.stringify({ '2026-10-20': [{ content: MARKER }] }),
        opLog: JSON.stringify([{ op: 'ADD', content: MARKER }]),
      },
      localData: { present: false },
    })

    const handmade = path.join(root, 'handmade')
    const partial = path.join(root, '.partial-leftover')
    await writeHandmadeSnapshot(handmade, '{"keep":"handmade"}')
    await writeHandmadeSnapshot(partial, '{"keep":"partial"}')

    assert.equal(await treeContains(userData, MARKER), true)

    const result = await removeMemoryFromUpdateSnapshots(userData)

    assert.equal(result.removed.length, 9)
    assert.deepEqual(
      result.removed.map((entry) => path.basename(entry)).sort(),
      [
        'daily.json',
        'daily.json',
        'daily.json',
        'long-term.json',
        'long-term.json',
        'long-term.json',
        'op-log.json',
        'op-log.json',
        'op-log.json',
      ],
    )
    for (const entry of result.removed) {
      assert.equal(entry.startsWith(`${'update-snapshots'}${path.sep}`), true)
      await assert.rejects(() => fs.access(path.join(userData, entry)))
    }

    for (const directory of [created.directory, handmade, partial]) {
      await assert.rejects(() => fs.access(path.join(directory, 'memory-v2')))
      assert.equal((await fs.stat(path.join(directory, 'settings.json'))).isFile(), true)
      assert.equal((await fs.stat(path.join(directory, 'manifest.json'))).isFile(), true)
    }
    assert.equal(await fs.readFile(path.join(handmade, 'settings.json'), 'utf8'), '{"keep":"handmade"}')
    assert.equal(await fs.readFile(path.join(partial, 'settings.json'), 'utf8'), '{"keep":"partial"}')
    assert.equal(
      await fs.readFile(path.join(created.directory, 'settings.json'), 'utf8'),
      '{"uiLanguage":"zh-CN"}',
    )

    assert.equal(await treeContains(userData, MARKER), false)
  } finally {
    await fs.rm(userData, { recursive: true, force: true })
  }
})

test('a missing update-snapshots directory removes nothing', async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-update-snapshot-missing-'))
  try {
    assert.deepEqual(await removeMemoryFromUpdateSnapshots(userData), { removed: [] })
  } finally {
    await fs.rm(userData, { recursive: true, force: true })
  }
})
