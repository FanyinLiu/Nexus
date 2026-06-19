// Auto-updater event payloads broadcast from the Electron main process via
// the 'updater:event' IPC channel.

export type UpdaterEvent =
  | { type: 'idle' }
  | { type: 'checking' }
  | { type: 'available'; version: string | null; releaseNotes: string | null }
  | { type: 'manual-update'; version: string | null; releaseUrl: string; reason: string | null }
  | { type: 'not-available'; version: string }
  | {
      type: 'progress'
      percent: number
      transferred: number
      total: number
      bytesPerSecond: number
    }
  | { type: 'downloaded'; version: string | null; releaseNotes: string | null }
  | { type: 'error'; message: string }
