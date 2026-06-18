import { ipcMain } from 'electron'
import { showProactiveNotification } from '../services/proactiveNotification.js'
import { requireTrustedSender } from './validate.js'
import { validateProactiveNotificationPayload } from './payloadSchemas.js'

export function register() {
  ipcMain.handle('proactive:show-notification', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateProactiveNotificationPayload(payload)
    const fired = showProactiveNotification({
      title: payload.title,
      body: payload.body,
    })
    return { ok: fired }
  })
}
