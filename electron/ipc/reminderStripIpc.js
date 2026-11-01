// @ts-check
import { ipcMain } from 'electron'
import { isReminderStripContents, showReminderStrip } from '../services/reminderStrip.js'
import { requireTrustedSender } from './validate.js'

export function register() {
  ipcMain.handle('reminder-strip:show', async (event, payload) => {
    requireTrustedSender(event)
    if (isReminderStripContents(event.sender)) {
      throw new Error('IPC rejected: the reminder strip cannot queue reminders')
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('reminder strip payload must be an object')
    }
    return { ok: showReminderStrip(payload) }
  })
}
