// @ts-check
import { ipcMain } from 'electron'
import { showProactiveNotification } from '../services/proactiveNotification.js'
import { requireTrustedSender } from './validate.js'
import { validateProactiveShowNotificationPayload } from './payloadSchemas.js'

export function register() {
  ipcMain.handle('proactive:show-notification', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateProactiveShowNotificationPayload(payload)
    const fired = showProactiveNotification({
      title: payload.title ?? '',
      body: payload.body ?? '',
    })
    return { ok: fired }
  })
}
