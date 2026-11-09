// @ts-check
// Cross-window speech stop: the renderer that owns the Stop button tears down
// its own runtime first, then asks main to notify every peer window. The
// sender is skipped so the event cannot bounce back into a feedback loop.

/**
 * Channel main uses to tell every other window that the user stopped speech.
 */
export const VOICE_STOP_PLAYBACK_CHANNEL = 'voice:stop-playback'

/**
 * Send the stop event to every window except the one that requested it.
 * @param {number} senderWebContentsId
 * @param {ReadonlyArray<{
 *   isDestroyed?: () => boolean,
 *   webContents: { id: number, send: (channel: string) => void },
 * }>} windows
 */
export function broadcastVoiceStopPlayback(senderWebContentsId, windows) {
  for (const win of windows) {
    if (!win || win.isDestroyed?.()) continue
    if (win.webContents.id === senderWebContentsId) continue
    win.webContents.send(VOICE_STOP_PLAYBACK_CHANNEL)
  }
}
