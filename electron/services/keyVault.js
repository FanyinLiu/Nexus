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

  if (isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(value)
    vault[slot] = { e: encrypted.toString('base64'), v: 1 }
  } else {
    vault[slot] = { p: value, v: 0 }
  }

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

  for (const [slot, value] of Object.entries(entries)) {
    const plaintext = String(value ?? '')

    if (!plaintext) {
      delete (await loadVault())[slot]
      continue
    }

    const vault = await loadVault()

    if (isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(plaintext)
      vault[slot] = { e: encrypted.toString('base64'), v: 1 }
    } else {
      vault[slot] = { p: plaintext, v: 0 }
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
