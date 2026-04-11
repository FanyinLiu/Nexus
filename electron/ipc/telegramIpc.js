import { BrowserWindow, ipcMain } from 'electron'
import * as telegramGateway from '../services/telegramGateway.js'
import { requireTrustedSender, requireString } from './validate.js'

export function register() {
  // Forward incoming Telegram messages to all renderer windows
  telegramGateway.onMessage((msg) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('telegram:message', msg)
    }
  })

  ipcMain.handle('telegram:connect', async (event, payload) => {
    requireTrustedSender(event)
    const botToken = requireString(payload?.botToken, 'botToken')
    const allowedChatIds = Array.isArray(payload?.allowedChatIds)
      ? payload.allowedChatIds.filter((id) => typeof id === 'number')
      : []
    await telegramGateway.connect(botToken, allowedChatIds)
    return telegramGateway.getStatus()
  })

  ipcMain.handle('telegram:disconnect', async (event) => {
    requireTrustedSender(event)
    await telegramGateway.disconnect()
    return { ok: true }
  })

  ipcMain.handle('telegram:send-message', async (event, payload) => {
    requireTrustedSender(event)
    const chatId = Number(payload?.chatId)
    if (!Number.isFinite(chatId)) throw new Error('chatId must be a number')
    const text = requireString(payload?.text, 'text')
    const options = {
      replyToMessageId: payload?.replyToMessageId ?? undefined,
      parseMode: payload?.parseMode ?? undefined,
    }
    await telegramGateway.sendMessage(chatId, text, options)
    return { ok: true }
  })

  ipcMain.handle('telegram:status', (event) => {
    requireTrustedSender(event)
    return telegramGateway.getStatus()
  })
}
