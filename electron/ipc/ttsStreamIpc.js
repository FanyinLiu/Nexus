import { ipcMain } from 'electron'

export function register({ ttsStreamService }) {
  ipcMain.handle('tts:stream-start', (event, payload) => {
    return ttsStreamService.start(event.sender, payload)
  })

  ipcMain.handle('tts:stream-push-text', (event, payload) => {
    return ttsStreamService.pushText(event.sender, payload)
  })

  ipcMain.handle('tts:stream-finish', async (event, payload) => {
    return ttsStreamService.finish(event.sender, payload)
  })

  ipcMain.handle('tts:stream-abort', (event, payload) => {
    return ttsStreamService.abort(event.sender, payload)
  })
}
