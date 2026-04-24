import { ipcMain } from 'electron'
import { showProactiveNotification } from '../services/proactiveNotification.js'
import { requireTrustedSender } from './validate.js'

export function register() {
  ipcMain.handle('proactive:show-notification', async (event, payload) => {
    requireTrustedSender(event)
    const fired = showProactiveNotification({
      title: String(payload?.title ?? ''),
      body: String(payload?.body ?? ''),
    })
    return { ok: fired }
  })
}
