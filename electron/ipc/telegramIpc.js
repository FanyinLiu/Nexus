import { BrowserWindow, ipcMain } from 'electron'
import * as telegramGateway from '../services/telegramGateway.js'
import { requireTrustedSender, requireString } from './validate.js'
import { resolveVaultRefsForSender } from '../services/vaultRefs.js'
import { runAuditedExternalAction } from './externalActionAudit.js'
import {
  validateTelegramSendMessagePayload,
  validateTelegramSendVoicePayload,
} from './payloadSchemas.js'

export function register() {
  // Forward incoming Telegram messages to all renderer windows
  telegramGateway.onMessage((msg) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('telegram:message', msg)
    }
  })

  // Forward pairing requests so the settings UI can show approve/dismiss
  telegramGateway.onPairingRequest((request) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('telegram:pairing-request', request)
    }
  })

  ipcMain.handle('telegram:pairing-list', (event) => {
    requireTrustedSender(event)
    return telegramGateway.listPairingRequests()
  })

  ipcMain.handle('telegram:pairing-resolve', (event, payload) => {
    requireTrustedSender(event)
    const senderId = requireString(payload?.senderId, 'senderId')
    return { removed: telegramGateway.resolvePairingRequest(senderId) }
  })

  ipcMain.handle('telegram:connect', async (event, payload) => {
    requireTrustedSender(event)
    const requestPayload = await resolveVaultRefsForSender(event.sender, payload, ['botToken'])
    const botToken = requireString(requestPayload?.botToken, 'botToken')
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
    payload = validateTelegramSendMessagePayload(payload)
    const chatId = Number(payload.chatId)
    const text = payload.text
    const options = {
      replyToMessageId: payload?.replyToMessageId ?? undefined,
      parseMode: payload?.parseMode ?? undefined,
    }
    return runAuditedExternalAction('telegram:send-message', payload, async () => {
      await telegramGateway.sendMessage(chatId, text, options)
      return { ok: true }
    })
  })

  ipcMain.handle('telegram:send-voice', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateTelegramSendVoicePayload(payload)
    const chatId = Number(payload.chatId)
    const audioBase64 = payload.audioBase64
    const mimeType = payload.mimeType
    const audio = Buffer.from(audioBase64, 'base64')
    return runAuditedExternalAction('telegram:send-voice', payload, async () => {
      await telegramGateway.sendVoice(chatId, audio, mimeType, {
        replyToMessageId: payload?.replyToMessageId ?? undefined,
      })
      return { ok: true }
    })
  })

  ipcMain.handle('telegram:status', (event) => {
    requireTrustedSender(event)
    return telegramGateway.getStatus()
  })
}
