import { app, safeStorage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

const VAULT_FILE_NAME = 'vault.json'

let vaultCache = null
let _writeLock = null

async function withVaultLock(fn) {
  while (_writeLock) await _writeLock
  let resolve
  _writeLock = new Promise((r) => { resolve = r })
  try {
    return await fn()
  } finally {
    _writeLock = null
    resolve()
  }
}

function getVaultPath() {
  return path.join(app.getPath('userData'), VAULT_FILE_NAME)
}

function isEncryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

async function loadVault() {
  if (vaultCache) return vaultCache

  try {
    const raw = await fs.readFile(getVaultPath(), 'utf8')
    vaultCache = JSON.parse(raw)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[KeyVault] Failed to read vault file:', error)
    }
    vaultCache = {}
  }

  return vaultCache
}

async function persistVault() {
  const vaultPath = getVaultPath()
  await fs.writeFile(vaultPath, JSON.stringify(vaultCache, null, 2), 'utf8')
}

export function vaultStore(slot, plaintext) {
  return withVaultLock(() => _vaultStore(slot, plaintext))
}

async function _vaultStore(slot, plaintext) {
  const value = String(plaintext ?? '')
  const vault = await loadVault()

  if (!value) {
    delete vault[slot]
    await persistVault()
    return
  }

  if (!isEncryptionAvailable()) {
    throw new Error(
      '系统加密服务不可用，无法安全存储密钥。'
      + '在 Linux 下请安装 gnome-keyring 或 kwallet 后重试。',
    )
  }

  const encrypted = safeStorage.encryptString(value)
  vault[slot] = { e: encrypted.toString('base64'), v: 1 }

  await persistVault()
}

export async function vaultRetrieve(slot) {
  const vault = await loadVault()
  const entry = vault[slot]

  if (!entry) return ''

  if (entry.v === 1 && entry.e) {
    if (!isEncryptionAvailable()) {
      console.warn(`[KeyVault] Encryption unavailable, cannot decrypt slot: ${slot}`)
      return ''
    }

    try {
      return safeStorage.decryptString(Buffer.from(entry.e, 'base64'))
    } catch (error) {
      console.warn(`[KeyVault] Failed to decrypt slot "${slot}":`, error)
      return ''
    }
  }

  if (entry.v === 0 && entry.p != null) {
    return entry.p
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

    if (!isEncryptionAvailable()) {
      throw new Error(
        '系统加密服务不可用，无法安全存储密钥。'
        + '在 Linux 下请安装 gnome-keyring 或 kwallet 后重试。',
      )
    }

    const encrypted = safeStorage.encryptString(plaintext)
    operations.push({ slot, entry: { e: encrypted.toString('base64'), v: 1 } })
  }

  // Phase 2: apply all operations atomically (all encryptions succeeded)
  const vault = await loadVault()
  for (const op of operations) {
    if (op.delete) {
      delete vault[op.slot]
    } else {
      vault[op.slot] = op.entry
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
