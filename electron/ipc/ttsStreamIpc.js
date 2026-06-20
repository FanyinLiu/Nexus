import { ipcMain } from 'electron'
import { requireTrustedSender } from './validate.js'
import { resolveVaultRefsForSender } from '../services/vaultRefs.js'
import { assertSpeechOutputCredentials } from '../services/ttsProviders.js'
import {
  validateTtsStreamAbortPayload,
  validateTtsStreamFinishPayload,
  validateTtsStreamPushTextPayload,
  validateTtsStreamStartPayload,
} from './payloadSchemas.js'

export function register({ ttsStreamService }) {
  ipcMain.handle('tts:stream-start', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateTtsStreamStartPayload(payload)
    const requestPayload = await resolveVaultRefsForSender(event.sender, payload, ['apiKey'])
    assertSpeechOutputCredentials(requestPayload?.providerId, requestPayload?.apiKey)
    return ttsStreamService.start(event.sender, requestPayload)
  })

  ipcMain.handle('tts:stream-push-text', (event, payload) => {
    requireTrustedSender(event)
    payload = validateTtsStreamPushTextPayload(payload)
    return ttsStreamService.pushText(event.sender, payload)
  })

  ipcMain.handle('tts:stream-finish', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateTtsStreamFinishPayload(payload)
    return ttsStreamService.finish(event.sender, payload)
  })

  ipcMain.handle('tts:stream-abort', (event, payload) => {
    requireTrustedSender(event)
    payload = validateTtsStreamAbortPayload(payload)
    return ttsStreamService.abort(event.sender, payload)
  })
}
