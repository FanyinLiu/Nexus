import { ipcMain } from 'electron'
import {
  vaultStore,
  vaultRetrieve,
  vaultDelete,
  vaultListSlots,
  vaultStoreMany,
  vaultRetrieveMany,
  vaultIsAvailable,
} from '../services/keyVault.js'
import {
  requireTrustedSender,
  requireSlotName,
  requireSlotNames,
  requireVaultEntries,
  expectString,
} from './validate.js'
import { audit } from '../services/auditLog.js'

export function register() {
  ipcMain.handle('vault:is-available', (event) => {
    requireTrustedSender(event)
    return vaultIsAvailable()
  })

  ipcMain.handle('vault:store', (event, slot, plaintext) => {
    requireTrustedSender(event)
    const name = requireSlotName(slot)
    audit('vault', 'store', { slot: name })
    return vaultStore(name, expectString(plaintext, 'plaintext'))
  })

  ipcMain.handle('vault:retrieve', (event, slot) => {
    requireTrustedSender(event)
    const name = requireSlotName(slot)
    audit('vault', 'retrieve', { slot: name })
    return vaultRetrieve(name)
  })

  ipcMain.handle('vault:delete', (event, slot) => {
    requireTrustedSender(event)
    const name = requireSlotName(slot)
    audit('vault', 'delete', { slot: name })
    return vaultDelete(name)
  })

  ipcMain.handle('vault:list-slots', (event) => {
    requireTrustedSender(event)
    audit('vault', 'list-slots')
    return vaultListSlots()
  })

  ipcMain.handle('vault:store-many', (event, entries) => {
    requireTrustedSender(event)
    const validated = requireVaultEntries(entries)
    // requireVaultEntries returns a Record<slot, plaintext> — using
    // Array.map on it crashes; pull the slot names via Object.keys so the
    // audit log is accurate and settings save doesn't bail out here.
    audit('vault', 'store-many', { slots: Object.keys(validated) })
    return vaultStoreMany(validated)
  })

  ipcMain.handle('vault:retrieve-many', (event, slots) => {
    requireTrustedSender(event)
    const names = requireSlotNames(slots)
    audit('vault', 'retrieve-many', { slots: names })
    return vaultRetrieveMany(names)
  })
}
