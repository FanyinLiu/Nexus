import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'

import {
  initializeLocalDataStore,
  resolveLocalDataPaths,
} from '../electron/services/localDataStoreCore.js'
import {
  checkpointLocalDataDatabase,
  removeMemoryFromUpdateSnapshots,
  writeUpdateSnapshot,
} from '../electron/services/updateInstallPrep.js'

const MARKER = 'NEXUSSNAPCLEAR-7Q-marker-memory'
const KEEP_MARKER = 'NEXUSSNAPCLEAR-KEEP-other-record'

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

async function assertFileHasNoBytes(filePath: string, needle: string): Promise<void> {
  let bytes: Buffer
  try {
    bytes = await fs.readFile(filePath)
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return
    throw error
  }
  const utf8 = Buffer.from(needle, 'utf8')
  const utf16 = Buffer.from(needle, 'utf16le')
  assert.equal(bytes.includes(utf8), false, `${filePath} still contains UTF-8 memory text`)
  assert.equal(bytes.includes(utf16), false, `${filePath} still contains UTF-16LE memory text`)
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

test('clearing scrubs memory rows and settings inside a local-data snapshot', async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-update-snapshot-local-data-'))
  try {
    const localData = await initializeLocalDataStore({ userDataPath: userData })
    assert.equal(localData.healthy, true)
    const paths = await resolveLocalDataPaths({ userDataPath: userData })
    const db = new DatabaseSync(paths.databasePath)
    const at = '2026-10-20T00:00:00.000Z'
    const insert = db.prepare(`
      INSERT INTO local_data_records (domain_id, record_id, payload_json, source, mirrored_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    insert.run('memory-long-term', 'memory-1', JSON.stringify({ id: 'memory-1', content: MARKER }), 'test', at, at)
    insert.run('memory-daily', 'daily-1', JSON.stringify({
      id: 'daily-1',
      day: '2026-10-20',
      content: MARKER,
      createdAt: at,
    }), 'test', at, at)
    insert.run('onboarding', 'state', JSON.stringify({ completedAt: at }), 'test', at, at)
    insert.run('chat-sessions', 'session-1', JSON.stringify({
      id: 'session-1',
      title: KEEP_MARKER,
    }), 'test', at, at)
    db.close()

    const databaseState = await checkpointLocalDataDatabase({ userDataPath: userData })
    assert.equal(databaseState.present, true)
    const created = await writeUpdateSnapshot({
      userDataPath: userData,
      fromVersion: '0.4.8',
      toVersion: '0.5.0',
      now: new Date('2026-10-20T00:00:00.000Z'),
      settings: JSON.stringify({ uiLanguage: 'en', memoryEcho: MARKER, keep: true }),
      memoryV2: {
        longTerm: JSON.stringify([{ id: 'memory-1', content: MARKER }]),
        daily: JSON.stringify({ '2026-10-20': [{ content: MARKER }] }),
        opLog: JSON.stringify([{ op: 'ADD', content: MARKER }]),
      },
      localData: databaseState,
    })

    const snapshotDb = path.join(created.directory, 'local-data', 'nexus.sqlite')
    assert.equal(await treeContains(created.directory, MARKER), true)
    assert.equal(await treeContains(created.directory, KEEP_MARKER), true)

    const result = await removeMemoryFromUpdateSnapshots(userData)
    assert.equal(result.removed.length, 3)

    // The copy stays a valid rollback source: non-memory rows and schema
    // survive, while both memory domains are empty.
    const copy = new DatabaseSync(snapshotDb)
    const memoryRows = copy.prepare(`
      SELECT COUNT(*) AS count FROM local_data_records
      WHERE domain_id IN ('memory-long-term', 'memory-daily')
    `).get() as { count: number }
    const keptRows = copy.prepare(`
      SELECT domain_id AS domainId, payload_json AS payloadJson FROM local_data_records
      WHERE domain_id IN ('onboarding', 'chat-sessions')
      ORDER BY domain_id ASC
    `).all() as Array<{ domainId: string, payloadJson: string }>
    const migrations = copy.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }
    copy.close()
    assert.equal(memoryRows.count, 0)
    assert.deepEqual(keptRows.map((row) => row.domainId), ['chat-sessions', 'onboarding'])
    assert.match(keptRows[0]?.payloadJson ?? '', new RegExp(KEEP_MARKER))
    assert.ok(migrations.count > 0)

    const settings = JSON.parse(
      await fs.readFile(path.join(created.directory, 'settings.json'), 'utf8'),
    ) as Record<string, unknown>
    assert.equal(settings.keep, true)
    assert.equal(JSON.stringify(settings).includes(MARKER), false)

    await assert.rejects(() => fs.access(path.join(created.directory, 'memory-v2')))

    await assertFileHasNoBytes(snapshotDb, MARKER)
    await assertFileHasNoBytes(`${snapshotDb}-wal`, MARKER)
    await assertFileHasNoBytes(`${snapshotDb}-shm`, MARKER)
    assert.equal(await treeContains(created.directory, MARKER), false)
    assert.equal(await treeContains(created.directory, KEEP_MARKER), true)
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
