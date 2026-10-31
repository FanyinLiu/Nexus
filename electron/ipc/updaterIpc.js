// @ts-check
import { ipcMain } from 'electron'
import {
  checkForUpdatesNow,
  getUpdaterStatus,
  quitAndInstallUpdate,
} from '../services/updaterService.js'
import { requireTrustedSender } from './validate.js'

export function register() {
  ipcMain.handle('updater:check', async (event) => {
    requireTrustedSender(event)
    return checkForUpdatesNow()
  })

  ipcMain.handle('updater:status', (event) => {
    requireTrustedSender(event)
    return getUpdaterStatus()
  })

  ipcMain.handle('updater:install', (event) => {
    requireTrustedSender(event)
    return quitAndInstallUpdate()
  })
}
