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
  requireSlotName,
  requireSlotNames,
  requireVaultEntries,
  expectString,
} from './validate.js'

export function register() {
  ipcMain.handle('vault:is-available', () => vaultIsAvailable())

  ipcMain.handle('vault:store', (_event, slot, plaintext) =>
    vaultStore(requireSlotName(slot), expectString(plaintext, 'plaintext')))

  ipcMain.handle('vault:retrieve', (_event, slot) =>
    vaultRetrieve(requireSlotName(slot)))

  ipcMain.handle('vault:delete', (_event, slot) =>
    vaultDelete(requireSlotName(slot)))

  ipcMain.handle('vault:list-slots', () => vaultListSlots())

  ipcMain.handle('vault:store-many', (_event, entries) =>
    vaultStoreMany(requireVaultEntries(entries)))

  ipcMain.handle('vault:retrieve-many', (_event, slots) =>
    vaultRetrieveMany(requireSlotNames(slots)))
}
