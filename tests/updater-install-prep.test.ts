import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createSyncJsonFileStore } from '../electron/services/jsonFileStore.js'
import { resolveLocalDataPaths } from '../electron/services/localDataStoreCore.js'
import {
  UPDATE_INSTALL_FLUSH_ORDER,
  UpdateInstallPrepError,
  applyAutoUpdaterInstallPolicy,
  checkpointLocalDataDatabase,
  createUpdateInstallPrep,
  decideUpdateInstall,
  writeUpdateSnapshot,
} from '../electron/services/updateInstallPrep.js'
import {
  UPDATE_INSTALL_PREP_FAILED,
  UPDATE_INSTALL_SNAPSHOT_FAILED,
} from '../shared/updateErrorCodes.js'

const RELEASE_URL = 'https://github.com/FanyinLiu/Nexus/releases/tag/v0.5.0'

test('autoInstallOnAppQuit stays off while background download stays on', () => {
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
  }
  applyAutoUpdaterInstallPolicy(autoUpdater)
  assert.equal(autoUpdater.autoDownload, true)
  assert.equal(autoUpdater.autoInstallOnAppQuit, false)
  assert.equal(autoUpdater.allowDowngrade, false)
})

test('prepareForUpdateInstall flushes settings, memory v2, the vector store, then sqlite', async () => {
  const calls: string[] = []
  const prep = createUpdateInstallPrep({
    flushSettings: async () => {
      calls.push('settings')
      return '{"uiLanguage":"zh-CN"}'
    },
    flushMemoryV2: async () => {
      calls.push('memory-v2')
      return {
        longTerm: '[{"id":"m-v2"}]',
        daily: '{}',
        opLog: '[]',
      }
    },
    flushMemoryVector: async () => {
      calls.push('memory-vector-flush')
    },
    closeMemoryVector: async () => {
      calls.push('memory-vector-close')
    },
    closeLocalData: async () => {
      calls.push('local-data')
      return { present: false }
    },
    flushPendingWrites: async () => {
      calls.push('pending-writes')
      return true
    },
    writeSnapshot: async (input) => {
      calls.push('snapshot')
      const snapshotInput = input as { memoryV2: { longTerm: string } }
      assert.equal(snapshotInput.memoryV2.longTerm, '[{"id":"m-v2"}]')
      return { directory: '/tmp/nexus-update-snapshot' }
    },
  })

  const result = await prep.prepareForUpdateInstall({
    userDataPath: '/tmp/nexus-user-data',
    fromVersion: '0.4.8',
    toVersion: '0.5.0',
    now: new Date('2026-10-15T00:00:00.000Z'),
  })

  assert.deepEqual(calls, [
    'settings',
    'memory-v2',
    'memory-vector-flush',
    'memory-vector-close',
    'local-data',
    'pending-writes',
    'snapshot',
  ])
  assert.deepEqual(result.order, [...UPDATE_INSTALL_FLUSH_ORDER])
})

test('a memory v2 flush failure aborts before snapshot and does not quitAndInstall', async () => {
  const calls: string[] = []
  const prep = createUpdateInstallPrep({
    flushSettings: async () => {
      calls.push('settings')
      return '{}'
    },
    flushMemoryV2: async () => {
      calls.push('memory-v2')
      throw new Error('memory v2 flush failed')
    },
    flushMemoryVector: async () => {
      calls.push('memory-vector-flush')
    },
    closeMemoryVector: async () => {
      calls.push('memory-vector-close')
    },
    closeLocalData: async () => {
      calls.push('local-data')
      return { present: false }
    },
    flushPendingWrites: async () => {
      calls.push('pending-writes')
    },
    writeSnapshot: async () => {
      calls.push('snapshot')
      return { directory: '/tmp/should-not-exist' }
    },
  })

  await assert.rejects(() => prep.prepareForUpdateInstall({ userDataPath: '/tmp/nexus' }))
  assert.deepEqual(calls, ['settings', 'memory-v2'])

  let quit = 0
  const failures: UpdateInstallPrepError[] = []
  const decision = await decideUpdateInstall({
    isPackaged: true,
    updateMode: 'auto-download',
    releaseUrl: RELEASE_URL,
    openReleasePage: () => {
      calls.push('open')
    },
    prepareForUpdateInstall: () => prep.prepareForUpdateInstall({ userDataPath: '/tmp/nexus' }),
    quitAndInstall: () => {
      quit += 1
    },
    onPrepFailure: (error) => {
      failures.push(error)
    },
  })

  assert.equal(decision.ok, false)
  assert.equal(decision.reason, 'prep-failed')
  assert.equal(quit, 0)
  assert.equal(failures.length, 1)
  assert.equal(failures[0]?.code, UPDATE_INSTALL_PREP_FAILED)
  assert.equal(failures[0]?.messageKey, 'updater.error.install_prep_failed')
  assert.ok(!calls.includes('snapshot'))
  assert.ok(!calls.includes('open'))
  assert.ok(!calls.includes('memory-vector-flush'))
})

test('a failed snapshot blocks install and keeps the earlier snapshot', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'nexus-update-snapshot-'))
  try {
    const paths = await resolveLocalDataPaths({ userDataPath: userData })
    await mkdir(paths.root, { recursive: true })
    const db = new DatabaseSync(paths.databasePath)
    db.exec('CREATE TABLE sample (id INTEGER); INSERT INTO sample (id) VALUES (7);')
    db.close()
    await writeFile(paths.manifestPath, '{"format":"nexus-local-data-manifest"}\n')

    const memoryV2 = {
      longTerm: '[{"id":"m-v2","schemaVersion":2}]',
      daily: '{"2026-10-15":[]}',
      opLog: '[{"op":"ADD"}]',
    }
    const base = {
      userDataPath: userData,
      fromVersion: '0.4.8-beta.1',
      toVersion: '0.5.0',
      settings: '{"uiLanguage":"zh-CN"}',
      memoryV2,
    }
    const localData = await checkpointLocalDataDatabase({ userDataPath: userData })
    assert.equal(localData.present, true)

    const first = await writeUpdateSnapshot({
      ...base,
      now: new Date('2026-10-15T00:00:00.000Z'),
      localData,
      memoryV2: { ...memoryV2, longTerm: '[{"id":"first"}]' },
    })
    const second = await writeUpdateSnapshot({
      ...base,
      now: new Date('2026-10-15T00:00:01.000Z'),
      localData,
      memoryV2: { ...memoryV2, longTerm: '[{"id":"second"}]' },
    })
    const third = await writeUpdateSnapshot({
      ...base,
      now: new Date('2026-10-15T00:00:02.000Z'),
      localData,
    })

    const root = join(userData, 'update-snapshots')
    const names = readdirSync(root).filter((name) => !name.startsWith('.'))
    assert.deepEqual(names.sort(), [second.name, third.name].sort())
    assert.equal(names.includes(first.name), false)
    assert.equal(
      readFileSync(join(third.directory, 'memory-v2', 'long-term.json'), 'utf8'),
      memoryV2.longTerm,
    )
    assert.equal(
      readFileSync(join(third.directory, 'memory-v2', 'op-log.json'), 'utf8'),
      memoryV2.opLog,
    )
    assert.equal(
      readFileSync(join(third.directory, 'settings.json'), 'utf8'),
      base.settings,
    )
    assert.ok(readFileSync(join(third.directory, 'local-data', 'nexus.sqlite')).byteLength > 0)
    assert.equal(
      readFileSync(join(third.directory, 'local-data', 'manifest.json'), 'utf8').includes('nexus-local-data-manifest'),
      true,
    )

    await assert.rejects(
      () => writeUpdateSnapshot({
        ...base,
        now: new Date('2026-10-15T00:00:03.000Z'),
        localData: {
          present: true,
          databasePath: join(userData, 'missing.sqlite'),
          manifestPath: join(userData, 'missing.json'),
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof UpdateInstallPrepError)
        assert.equal(error.code, UPDATE_INSTALL_SNAPSHOT_FAILED)
        assert.equal(error.messageKey, 'updater.error.snapshot_failed')
        return true
      },
    )

    const afterFailure = readdirSync(root)
    assert.deepEqual(afterFailure.filter((name) => !name.startsWith('.')).sort(), names.sort())
    assert.equal(afterFailure.some((name) => name.startsWith('.partial-')), false)

    let quit = 0
    const decision = await decideUpdateInstall({
      isPackaged: true,
      updateMode: 'auto-download',
      releaseUrl: RELEASE_URL,
      openReleasePage: () => {
        throw new Error('manual path should not run')
      },
      prepareForUpdateInstall: async () => {
        throw new UpdateInstallPrepError(
          UPDATE_INSTALL_SNAPSHOT_FAILED,
          'updater.error.snapshot_failed',
          'updater.error.snapshot_failed_rec',
        )
      },
      quitAndInstall: () => {
        quit += 1
      },
      onPrepFailure: (error) => {
        assert.equal(error.code, UPDATE_INSTALL_SNAPSHOT_FAILED)
        assert.equal(error.recommendationKey, 'updater.error.snapshot_failed_rec')
      },
    })
    assert.equal(decision.ok, false)
    assert.equal(quit, 0)
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})

test('unsigned macOS still opens the release page and does not install', async () => {
  const calls: string[] = []
  const decision = await decideUpdateInstall({
    isPackaged: true,
    updateMode: 'manual-download',
    releaseUrl: RELEASE_URL,
    openReleasePage: (url) => {
      calls.push(url)
    },
    prepareForUpdateInstall: async () => {
      calls.push('prep')
    },
    quitAndInstall: () => {
      calls.push('quit')
    },
    onPrepFailure: () => {
      calls.push('fail')
    },
  })

  assert.equal(decision.ok, true)
  assert.equal(decision.reason, 'manual-download')
  assert.deepEqual(calls, [RELEASE_URL])
})

test('debounced json stores flush before their timer and renderer memory v2 is captured', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'nexus-json-flush-'))
  const file = join(userData, 'window-bounds.json')
  try {
    const store = createSyncJsonFileStore({
      getStorePath: () => file,
      debounceMs: 60_000,
    })
    const cache = store.load()
    cache.panel = { width: 420 }
    store.persistDebounced()
    assert.equal(existsSync(file), false)
    assert.equal(await store.flushPending(), true)
    assert.match(readFileSync(file, 'utf8'), /420/)

    const {
      captureDurableUpdateSnapshot,
      writeJson,
      writeJsonDebounced,
      MEMORY_STORAGE_KEY,
      MEMORY_OP_LOG_STORAGE_KEY,
      PROACTIVE_AGENDA_STORAGE_KEY,
    } = await import('../src/lib/storage/core.ts')
    const saved = new Map<string, string>()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: {
        localStorage: {
          getItem: (key: string) => saved.get(key) ?? null,
          setItem: (key: string, value: string) => {
            saved.set(key, String(value))
          },
          removeItem: (key: string) => {
            saved.delete(key)
          },
        },
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        addEventListener: () => undefined,
        dispatchEvent: () => true,
      },
    })
    writeJsonDebounced(MEMORY_STORAGE_KEY, [{
      id: 'loop-1',
      content: 'send the report',
      kind: 'open_loop',
      loopStatus: 'open',
      loopSnoozeUntil: '2026-10-16T18:00:00.000Z',
    }], 60_000)
    writeJsonDebounced(MEMORY_OP_LOG_STORAGE_KEY, [{ id: 'op-1', op: 'ADD' }], 60_000)
    writeJson(PROACTIVE_AGENDA_STORAGE_KEY, {
      items: [{ id: 'agenda:open_loop:loop-1', kind: 'open_loop' }],
      firedAt: [],
      lastConsolidationAt: null,
    })
    assert.equal(saved.get(MEMORY_STORAGE_KEY) ?? null, null)
    const snapshot = captureDurableUpdateSnapshot()
    assert.match(snapshot.memoryV2.longTerm ?? '', /open_loop/)
    assert.match(snapshot.memoryV2.longTerm ?? '', /loopSnoozeUntil/)
    assert.match(snapshot.memoryV2.opLog ?? '', /ADD/)
    assert.match(saved.get(MEMORY_STORAGE_KEY) ?? '', /send the report/)
    assert.match(saved.get(PROACTIVE_AGENDA_STORAGE_KEY) ?? '', /agenda:open_loop:loop-1/)
  } finally {
    rmSync(userData, { recursive: true, force: true })
    delete (globalThis as { window?: unknown }).window
  }
})
