import { ipcMain } from 'electron'
import { requireTrustedSender } from './validate.js'
import { resolveVaultRefsForSender } from '../services/vaultRefs.js'
import { assertSpeechOutputCredentials } from '../services/ttsProviders.js'

export function register({ ttsStreamService }) {
  ipcMain.handle('tts:stream-start', async (event, payload) => {
    requireTrustedSender(event)
    const requestPayload = await resolveVaultRefsForSender(event.sender, payload, ['apiKey'])
    assertSpeechOutputCredentials(requestPayload?.providerId, requestPayload?.apiKey)
    return ttsStreamService.start(event.sender, requestPayload)
  })

  ipcMain.handle('tts:stream-push-text', (event, payload) => {
    requireTrustedSender(event)
    return ttsStreamService.pushText(event.sender, payload)
  })

  ipcMain.handle('tts:stream-finish', async (event, payload) => {
    requireTrustedSender(event)
    return ttsStreamService.finish(event.sender, payload)
  })

  ipcMain.handle('tts:stream-abort', (event, payload) => {
    requireTrustedSender(event)
    return ttsStreamService.abort(event.sender, payload)
  })
}
