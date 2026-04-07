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

export function register() {
  ipcMain.handle('vault:is-available', () => vaultIsAvailable())

  ipcMain.handle('vault:store', (_event, slot, plaintext) => vaultStore(slot, plaintext))

  ipcMain.handle('vault:retrieve', (_event, slot) => vaultRetrieve(slot))

  ipcMain.handle('vault:delete', (_event, slot) => vaultDelete(slot))

  ipcMain.handle('vault:list-slots', () => vaultListSlots())

  ipcMain.handle('vault:store-many', (_event, entries) => vaultStoreMany(entries))

  ipcMain.handle('vault:retrieve-many', (_event, slots) => vaultRetrieveMany(slots))
}
