import { BrowserWindow, ipcMain } from 'electron'
import * as notificationBridge from '../services/notificationBridge.js'
import { requireTrustedSender } from './validate.js'

export function register() {
  // Forward incoming notifications to all renderer windows
  notificationBridge.onNotification((msg) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('notification:incoming', msg)
    }
  })

  ipcMain.handle('notification:get-channels', (event) => {
    requireTrustedSender(event)
    return notificationBridge.getChannels()
  })

  ipcMain.handle('notification:webhook-info', async (event) => {
    requireTrustedSender(event)
    return notificationBridge.getWebhookInfo()
  })

  ipcMain.handle('notification:set-channels', (event, channels) => {
    requireTrustedSender(event)
    if (!Array.isArray(channels)) {
      throw new Error('channels must be an array')
    }
    notificationBridge.setChannels(channels)
  })

  ipcMain.handle('notification:start', async (event) => {
    requireTrustedSender(event)
    await notificationBridge.start()
  })

  ipcMain.handle('notification:stop', (event) => {
    requireTrustedSender(event)
    notificationBridge.stop()
  })
}
