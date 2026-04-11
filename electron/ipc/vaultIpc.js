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

export function register() {
  ipcMain.handle('vault:is-available', (event) => {
    requireTrustedSender(event)
    return vaultIsAvailable()
  })

  ipcMain.handle('vault:store', (event, slot, plaintext) => {
    requireTrustedSender(event)
    return vaultStore(requireSlotName(slot), expectString(plaintext, 'plaintext'))
  })

  ipcMain.handle('vault:retrieve', (event, slot) => {
    requireTrustedSender(event)
    return vaultRetrieve(requireSlotName(slot))
  })

  ipcMain.handle('vault:delete', (event, slot) => {
    requireTrustedSender(event)
    return vaultDelete(requireSlotName(slot))
  })

  ipcMain.handle('vault:list-slots', (event) => {
    requireTrustedSender(event)
    return vaultListSlots()
  })

  ipcMain.handle('vault:store-many', (event, entries) => {
    requireTrustedSender(event)
    return vaultStoreMany(requireVaultEntries(entries))
  })

  ipcMain.handle('vault:retrieve-many', (event, slots) => {
    requireTrustedSender(event)
    return vaultRetrieveMany(requireSlotNames(slots))
  })
}
