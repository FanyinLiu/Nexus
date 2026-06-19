import { BrowserWindow, ipcMain } from 'electron'
import * as discordGateway from '../services/discordGateway.js'
import { requireTrustedSender, requireString } from './validate.js'
import { resolveVaultRefsForSender } from '../services/vaultRefs.js'
import { audit } from '../services/auditLog.js'
import { requireExternalActionPermission } from '../services/externalActionPolicy.js'
import {
  summarizeExternalActionRequest,
  summarizeExternalActionResult,
} from './externalActionAudit.js'
import {
  validateDiscordSendMessagePayload,
  validateDiscordSendVoicePayload,
} from './payloadSchemas.js'

async function runAuditedExternalAction(channel, payload, action) {
  audit('external-action', 'request', summarizeExternalActionRequest(channel, payload))
  try {
    await requireExternalActionPermission(channel)
    const result = await action()
    audit('external-action', 'result', summarizeExternalActionResult(channel, result))
    return result
  } catch (error) {
    audit('external-action', 'result', summarizeExternalActionResult(channel, {}, error))
    throw error
  }
}

export function register() {
  // Forward incoming Discord messages to all renderer windows
  discordGateway.onMessage((msg) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('discord:message', msg)
    }
  })

  // Forward pairing requests so the settings UI can show approve/dismiss
  discordGateway.onPairingRequest((request) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('discord:pairing-request', request)
    }
  })

  ipcMain.handle('discord:pairing-list', (event) => {
    requireTrustedSender(event)
    return discordGateway.listPairingRequests()
  })

  ipcMain.handle('discord:pairing-resolve', (event, payload) => {
    requireTrustedSender(event)
    const senderId = requireString(payload?.senderId, 'senderId')
    return { removed: discordGateway.resolvePairingRequest(senderId) }
  })

  ipcMain.handle('discord:connect', async (event, payload) => {
    requireTrustedSender(event)
    const requestPayload = await resolveVaultRefsForSender(event.sender, payload, ['botToken'])
    const botToken = requireString(requestPayload?.botToken, 'botToken')
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
    payload = validateDiscordSendMessagePayload(payload)
    const channelId = payload.channelId
    const text = payload.text
    const options = {
      replyToMessageId: payload?.replyToMessageId ?? undefined,
    }
    return runAuditedExternalAction('discord:send-message', payload, async () => {
      await discordGateway.sendMessage(channelId, text, options)
      return { ok: true }
    })
  })

  ipcMain.handle('discord:send-voice', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateDiscordSendVoicePayload(payload)
    const channelId = payload.channelId
    const audioBase64 = payload.audioBase64
    const mimeType = payload.mimeType
    const audio = Buffer.from(audioBase64, 'base64')
    return runAuditedExternalAction('discord:send-voice', payload, async () => {
      await discordGateway.sendAudioAttachment(channelId, audio, mimeType, {
        replyToMessageId: payload?.replyToMessageId ?? undefined,
      })
      return { ok: true }
    })
  })

  ipcMain.handle('discord:status', (event) => {
    requireTrustedSender(event)
    return discordGateway.getStatus()
  })
}
