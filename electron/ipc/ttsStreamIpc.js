import { ipcMain } from 'electron'
import { requireTrustedSender } from './validate.js'

export function register({ ttsStreamService }) {
  ipcMain.handle('tts:stream-start', (event, payload) => {
    requireTrustedSender(event)
    return ttsStreamService.start(event.sender, payload)
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
