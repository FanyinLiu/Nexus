import { BrowserWindow, ipcMain } from 'electron'
import * as discordGateway from '../services/discordGateway.js'
import { requireTrustedSender, requireString } from './validate.js'

export function register() {
  // Forward incoming Discord messages to all renderer windows
  discordGateway.onMessage((msg) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('discord:message', msg)
    }
  })

  ipcMain.handle('discord:connect', async (event, payload) => {
    requireTrustedSender(event)
    const botToken = requireString(payload?.botToken, 'botToken')
    const allowedChannelIds = Array.isArray(payload?.allowedChannelIds)
      ? payload.allowedChannelIds.filter((id) => typeof id === 'string' && id.length > 0)
      : []
    await discordGateway.connect(botToken, allowedChannelIds)
    return discordGateway.getStatus()
  })

  ipcMain.handle('discord:disconnect', async (event) => {
    requireTrustedSender(event)
    await discordGateway.disconnect()
    return { ok: true }
  })

  ipcMain.handle('discord:send-message', async (event, payload) => {
    requireTrustedSender(event)
    const channelId = requireString(payload?.channelId, 'channelId')
    const text = requireString(payload?.text, 'text')
    const options = {
      replyToMessageId: payload?.replyToMessageId ?? undefined,
    }
    await discordGateway.sendMessage(channelId, text, options)
    return { ok: true }
  })

  ipcMain.handle('discord:status', (event) => {
    requireTrustedSender(event)
    return discordGateway.getStatus()
  })
}
