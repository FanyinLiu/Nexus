/**
 * Controls exposed by the voice hook for local playback actions.
 * `stopAll` is the user's Stop button; previews and diagnostics must not use it.
 */
export type SpeechPlaybackControls = {
  interrupt: () => void
  stopAll: () => void
}

/**
 * Settings preview and audio diagnostics own only the playback they started.
 * Interrupt the current local sentence instead of clearing queued companion
 * reminders or letters (and never touch the peer window).
 */
export function interruptLocalSpeechPlayback(controls: SpeechPlaybackControls): void {
  controls.interrupt()
}
