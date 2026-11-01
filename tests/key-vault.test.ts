import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'

import {
  resetKeyVaultStateForTests,
  setKeyVaultRuntimeForTests,
  vaultDelete,
  vaultIsAvailable,
  vaultListSlots,
  vaultRetrieve,
  vaultStore,
  vaultStoreMany,
} from '../electron/services/keyVault.js'

let userDataDir = ''

function vaultPath() {
  return path.join(userDataDir, 'vault.json')
}

beforeEach(async () => {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-key-vault-'))
  process.env.NEXUS_VAULT_USER_DATA_DIR = userDataDir
  resetKeyVaultStateForTests()
})

afterEach(async () => {
  resetKeyVaultStateForTests()
  delete process.env.NEXUS_VAULT_USER_DATA_DIR
  delete process.env.SMOKE_TEST
  await fs.rm(userDataDir, { recursive: true, force: true })
})

function fakeSafeStorage(backend: string) {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^enc:/, ''),
    getSelectedStorageBackend: () => backend,
  } as never
}

test('corrupted vault file is backed up and writes are refused without touching the original', async () => {
  // A crash mid-write leaves vault.json as truncated JSON holding live keys.
  const corruptContent = '{"settings:apiKey": {"p": "sk-live-secret", "v": 0'
  await fs.writeFile(vaultPath(), corruptContent, 'utf8')

  // Loading the corrupted vault must not expose or drop entries silently.
  assert.equal(await vaultRetrieve('settings:apiKey'), '')

  // The original file is left untouched and a timestamped backup preserves it.
  assert.equal(await fs.readFile(vaultPath(), 'utf8'), corruptContent)
  const backups = (await fs.readdir(userDataDir)).filter((name) => name.startsWith('vault.json.corrupt-'))
  assert.equal(backups.length, 1)
  assert.equal(await fs.readFile(path.join(userDataDir, backups[0]), 'utf8'), corruptContent)

  // Any subsequent write is refused loudly instead of overwriting the
  // original with an empty-cache-plus-one-entry vault.
  await assert.rejects(
    vaultStore('settings:telegramBotToken', 'new-token'),
    (error: NodeJS.ErrnoException) => error?.code === 'VAULT_CORRUPT_WRITE_BLOCKED',
  )
  assert.equal(await fs.readFile(vaultPath(), 'utf8'), corruptContent)

  // Deleting a slot that is absent from the (empty) in-memory cache is a
  // no-op that never reaches the persist path, so it must not throw — but it
  // must not touch the original file either.
  await vaultDelete('settings:apiKey')
  assert.equal(await fs.readFile(vaultPath(), 'utf8'), corruptContent)

  // Bulk writes go through the same persist path and are blocked too.
  await assert.rejects(
    vaultStoreMany({ 'settings:apiKey': 'replacement' }),
    (error: NodeJS.ErrnoException) => error?.code === 'VAULT_CORRUPT_WRITE_BLOCKED',
  )
  assert.equal(await fs.readFile(vaultPath(), 'utf8'), corruptContent)
  assert.ok(
    (await fs.readdir(userDataDir)).every((name) => !name.endsWith('.tmp')),
    'no temp files should be left behind',
  )
})

test('store retrieve delete roundtrip persists plaintext entries atomically', async () => {
  await vaultStore('settings:apiKey', 'sk-test-key')
  assert.equal(await vaultRetrieve('settings:apiKey'), 'sk-test-key')

  const onDisk = JSON.parse(await fs.readFile(vaultPath(), 'utf8'))
  assert.deepEqual(onDisk, { 'settings:apiKey': { p: 'sk-test-key', v: 0 } })

  // Writes go through a temp file + rename, leaving no temp files behind and
  // keeping the vault readable only by the owner (POSIX only; Windows does not
  // honor POSIX file modes).
  const names = await fs.readdir(userDataDir)
  assert.deepEqual(names, ['vault.json'])
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(vaultPath())).mode & 0o777, 0o600)
  }

  await vaultStoreMany({
    'settings:telegramBotToken': 'telegram-token',
    'settings:screenVlmApiKey': 'vlm-key',
  })
  assert.deepEqual(await vaultListSlots(), [
    'settings:apiKey',
    'settings:telegramBotToken',
    'settings:screenVlmApiKey',
  ])
  assert.equal(await vaultRetrieve('settings:telegramBotToken'), 'telegram-token')

  await vaultDelete('settings:apiKey')
  assert.equal(await vaultRetrieve('settings:apiKey'), '')
  assert.deepEqual(await vaultListSlots(), [
    'settings:telegramBotToken',
    'settings:screenVlmApiKey',
  ])
})

test('storing an empty value deletes the slot and persists', async () => {
  await vaultStore('settings:apiKey', 'sk-test-key')
  await vaultStore('settings:apiKey', '')
  assert.equal(await vaultRetrieve('settings:apiKey'), '')
  assert.deepEqual(JSON.parse(await fs.readFile(vaultPath(), 'utf8')), {})
})

test('SMOKE_TEST cannot enable plaintext storage in a packaged build', async () => {
  process.env.SMOKE_TEST = '1'
  setKeyVaultRuntimeForTests({
    app: { isPackaged: true } as never,
    safeStorage: fakeSafeStorage('gnome_libsecret'),
    platform: 'darwin',
    smokeBuild: false,
  })

  await vaultStore('settings:apiKey', 'sk-live-secret')
  assert.equal(vaultIsAvailable(), true)

  const stored = JSON.parse(await fs.readFile(vaultPath(), 'utf8'))
  assert.equal(stored['settings:apiKey'].v, 1, 'packaged write must be encrypted, not plaintext')
  assert.equal(typeof stored['settings:apiKey'].e, 'string')
  assert.equal(stored['settings:apiKey'].p, undefined)
})

test('the baked smoke build flag still allows plaintext for the local packaged smoke', async () => {
  process.env.SMOKE_TEST = '1'
  setKeyVaultRuntimeForTests({
    app: { isPackaged: true } as never,
    safeStorage: fakeSafeStorage('gnome_libsecret'),
    platform: 'linux',
    smokeBuild: true,
  })

  await vaultStore('settings:apiKey', 'sk-smoke-key')
  assert.deepEqual(JSON.parse(await fs.readFile(vaultPath(), 'utf8')), {
    'settings:apiKey': { p: 'sk-smoke-key', v: 0 },
  })
})

test('packaged Linux refuses writes when safeStorage falls back to basic_text', async () => {
  setKeyVaultRuntimeForTests({
    app: { isPackaged: true } as never,
    safeStorage: fakeSafeStorage('basic_text'),
    platform: 'linux',
    smokeBuild: false,
  })

  assert.equal(vaultIsAvailable(), false)
  await assert.rejects(
    vaultStore('settings:apiKey', 'sk-live-secret'),
    (error: NodeJS.ErrnoException) => error?.code === 'VAULT_ENCRYPTION_UNAVAILABLE',
  )
  await assert.rejects(
    vaultStoreMany({ 'settings:apiKey': 'sk-live-secret' }),
    (error: NodeJS.ErrnoException) => error?.code === 'VAULT_ENCRYPTION_UNAVAILABLE',
  )
  await assert.rejects(fs.readFile(vaultPath(), 'utf8'))
})

test('existing encrypted secrets stay readable on basic_text if they still decrypt', async () => {
  setKeyVaultRuntimeForTests({
    app: { isPackaged: true } as never,
    safeStorage: fakeSafeStorage('basic_text'),
    platform: 'linux',
    smokeBuild: false,
  })
  await fs.writeFile(vaultPath(), JSON.stringify({
    'settings:apiKey': { e: Buffer.from('enc:sk-existing').toString('base64'), v: 1 },
  }), 'utf8')

  assert.equal(await vaultRetrieve('settings:apiKey'), 'sk-existing')
})
