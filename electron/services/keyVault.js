import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createAsyncLock } from './asyncLock.js'
import { getRedactedErrorMessage } from './errorRedaction.js'

// Electron's app/safeStorage when running inside the app; absent under plain
// node:test (requiring 'electron' there yields the binary path string, not
// the API). This is what makes the vault loadable in tests — they point
// NEXUS_VAULT_USER_DATA_DIR at a temp dir instead.
const require = createRequire(import.meta.url)
let electronApp = null
let safeStorage = null
try {
  const electron = require('electron')
  if (typeof electron?.app?.getPath === 'function') {
    electronApp = electron.app
    safeStorage = electron.safeStorage ?? null
  }
} catch {
  // plain node — fall through; getVaultPath uses NEXUS_VAULT_USER_DATA_DIR
}

const VAULT_FILE_NAME = 'vault.json'

let vaultCache = null
const withVaultLock = createAsyncLock()
const decryptedVaultCache = new Map()
let safeStorageAccessBlocked = false
let safeStorageFailureLogged = false
// Set when vault.json exists but fails to parse: writes stay blocked for the
// rest of the process so a truncated file is never overwritten with an
// empty-cache-plus-one-entry vault.
let vaultWriteBlocked = false

function getVaultPath() {
  const userDataDirOverride = process.env.NEXUS_VAULT_USER_DATA_DIR
  if (userDataDirOverride) return path.join(userDataDirOverride, VAULT_FILE_NAME)
  if (!electronApp) throw new Error('Electron app path API is unavailable')
  return path.join(electronApp.getPath('userData'), VAULT_FILE_NAME)
}

// Dev-mode and smoke-only plaintext path: skip safeStorage entirely so unsigned
// dev binaries and local packaged smoke do not trigger a Keychain password
// prompt. SMOKE_TEST is set only by the local smoke harness; production
// packaged installers still require safeStorage and never fall through here.
function isDevPlaintextMode() {
  return !electronApp?.isPackaged || process.env.SMOKE_TEST === '1'
}

function isEncryptionAvailable() {
  if (isDevPlaintextMode()) return true
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function markSafeStorageAccessBlocked(error, operation) {
  safeStorageAccessBlocked = true
  if (safeStorageFailureLogged) return
  safeStorageFailureLogged = true
  console.warn(
    `[KeyVault] safeStorage ${operation} failed; disabling further attempts for this process:`,
    getRedactedErrorMessage(error),
  )
}

function assertSafeStorageAccessAllowed() {
  if (safeStorageAccessBlocked) {
    throw new Error('系统钥匙串暂时不可用。本次启动不会重复请求钥匙串权限。')
  }
}

function encryptWithSafeStorage(value) {
  assertSafeStorageAccessAllowed()
  try {
    return safeStorage.encryptString(value)
  } catch (error) {
    markSafeStorageAccessBlocked(error, 'encryption')
    throw new Error('系统钥匙串暂时不可用。本次启动不会重复请求钥匙串权限。', { cause: error })
  }
}

function decryptWithSafeStorage(value) {
  if (safeStorageAccessBlocked) return ''
  try {
    return safeStorage.decryptString(value)
  } catch (error) {
    markSafeStorageAccessBlocked(error, 'decryption')
    return ''
  }
}

async function loadVault() {
  if (vaultCache) return vaultCache

  let raw
  try {
    raw = await fs.readFile(getVaultPath(), 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[KeyVault] Failed to read vault file:', getRedactedErrorMessage(error))
    }
    vaultCache = {}
    return vaultCache
  }

  try {
    vaultCache = JSON.parse(raw)
  } catch (error) {
    await quarantineCorruptVaultFile(error)
    vaultCache = {}
  }

  return vaultCache
}

// A crash mid-write can leave vault.json as truncated JSON. Treating it as an
// empty vault would let the next persist overwrite the file with
// empty-cache-plus-one-entry and silently destroy every stored key, so
// preserve a timestamped backup and refuse all writes for this process.
async function quarantineCorruptVaultFile(parseError) {
  vaultWriteBlocked = true
  const backupPath = `${getVaultPath()}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
  try {
    await fs.copyFile(getVaultPath(), backupPath)
    console.warn(
      '[KeyVault] Vault file is corrupted; backed it up and disabled vault writes for this process:',
      getRedactedErrorMessage(parseError),
    )
  } catch (backupError) {
    console.warn(
      '[KeyVault] Vault file is corrupted and the backup copy failed; vault writes are disabled for this process:',
      getRedactedErrorMessage(backupError),
    )
  }
}

async function persistVault() {
  if (vaultWriteBlocked) {
    const error = new Error(
      '密钥库文件已损坏，为保护已存密钥，本次启动已禁止写入。请重启应用后重新设置密钥。',
    )
    error.code = 'VAULT_CORRUPT_WRITE_BLOCKED'
    throw error
  }
  const vaultPath = getVaultPath()
  const tempPath = `${vaultPath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(vaultCache, null, 2), { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tempPath, vaultPath)
}

export function vaultStore(slot, plaintext) {
  return withVaultLock(() => _vaultStore(slot, plaintext))
}

async function _vaultStore(slot, plaintext) {
  const value = String(plaintext ?? '')
  const slotName = String(slot ?? '')
  const vault = await loadVault()

  if (!value) {
    delete vault[slotName]
    decryptedVaultCache.delete(slotName)
    await persistVault()
    return
  }

  if (isDevPlaintextMode()) {
    vault[slotName] = { p: value, v: 0 }
    decryptedVaultCache.set(slotName, value)
    await persistVault()
    return
  }

  if (!isEncryptionAvailable()) {
    throw new Error(
      '系统加密服务好像不可用，密钥没法安全存储。'
      + '在 Linux 下试试安装 gnome-keyring 或 kwallet 再重试？',
    )
  }

  const encrypted = encryptWithSafeStorage(value)
  vault[slotName] = { e: encrypted.toString('base64'), v: 1 }
  decryptedVaultCache.set(slotName, value)

  await persistVault()
}

export function vaultRetrieve(slot) {
  return withVaultLock(() => _vaultRetrieve(slot))
}

async function _vaultRetrieve(slot) {
  const slotName = String(slot ?? '')
  if (decryptedVaultCache.has(slotName)) {
    return decryptedVaultCache.get(slotName)
  }

  const vault = await loadVault()
  const entry = vault[slotName]

  if (!entry) return ''

  if (entry.v === 1 && entry.e) {
    if (isDevPlaintextMode()) {
      // Pre-existing encrypted entry from a packaged install — decrypting would
      // trigger the Keychain prompt we're trying to avoid in dev. Drop it; user
      // re-enters the key once and it gets re-stored as plaintext (v=0).
      return ''
    }

    if (!isEncryptionAvailable()) {
      console.warn('[KeyVault] Encryption unavailable; encrypted vault entries are unavailable')
      return ''
    }

    const plaintext = decryptWithSafeStorage(Buffer.from(entry.e, 'base64'))
    if (plaintext) decryptedVaultCache.set(slotName, plaintext)
    return plaintext
  }

  if (entry.v === 0 && entry.p != null) {
    const plaintext = String(entry.p)
    decryptedVaultCache.set(slotName, plaintext)
    return plaintext
  }

  return ''
}

export function vaultDelete(slot) {
  return withVaultLock(() => _vaultDelete(slot))
}

async function _vaultDelete(slot) {
  const vault = await loadVault()

  if (!(slot in vault)) return

  delete vault[slot]
  decryptedVaultCache.delete(String(slot ?? ''))
  await persistVault()
}

export async function vaultListSlots() {
  const vault = await loadVault()
  return Object.keys(vault)
}

export function vaultStoreMany(entries) {
  return withVaultLock(() => _vaultStoreMany(entries))
}

async function _vaultStoreMany(entries) {
  if (!entries || typeof entries !== 'object') return

  // Phase 1: encrypt all values upfront (may throw — no cache mutation yet)
  const operations = []
  for (const [slot, value] of Object.entries(entries)) {
    const plaintext = String(value ?? '')
    if (!plaintext) {
      operations.push({ slot, delete: true })
      continue
    }

    if (isDevPlaintextMode()) {
      operations.push({ slot, entry: { p: plaintext, v: 0 }, plaintext })
      continue
    }

    if (!isEncryptionAvailable()) {
      throw new Error(
        '系统加密服务好像不可用，密钥没法安全存储。'
        + '在 Linux 下试试安装 gnome-keyring 或 kwallet 再重试？',
      )
    }

    const encrypted = encryptWithSafeStorage(plaintext)
    operations.push({ slot, entry: { e: encrypted.toString('base64'), v: 1 }, plaintext })
  }

  // Phase 2: apply all operations atomically (all encryptions succeeded)
  const vault = await loadVault()
  for (const op of operations) {
    if (op.delete) {
      delete vault[op.slot]
      decryptedVaultCache.delete(op.slot)
    } else {
      vault[op.slot] = op.entry
      decryptedVaultCache.set(op.slot, op.plaintext)
    }
  }

  await persistVault()
}

export async function vaultRetrieveMany(slots) {
  const result = {}

  for (const slot of slots) {
    result[slot] = await vaultRetrieve(slot)
  }

  return result
}

export function vaultIsAvailable() {
  return isEncryptionAvailable()
}

/** @internal Test-only: reset in-memory vault state between test cases. */
export function resetKeyVaultStateForTests() {
  vaultCache = null
  decryptedVaultCache.clear()
  vaultWriteBlocked = false
  safeStorageAccessBlocked = false
  safeStorageFailureLogged = false
}
