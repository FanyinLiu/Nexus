/**
 * Renderer → main sync for the on-demand voice sidecars.
 *
 * Sends only the selected engine ids and the two voice switches. The main
 * process owns the Python probe/spawn lifecycle; keeping this payload free of
 * keys and user text also keeps it safe to send from the pet window, which is
 * the only renderer guaranteed to load at launch.
 */

import type { AppSettings } from '../../types/app.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'

export type VoiceRuntimeSyncPayload = {
  speechInputEnabled: boolean
  speechInputProviderId: string
  speechOutputEnabled: boolean
  speechOutputProviderId: string
}

/**
 * Build the compact payload the main-process sidecar supervisor consumes.
 *
 * @param {Pick<AppSettings, 'speechInputEnabled' | 'speechInputProviderId' | 'speechOutputEnabled' | 'speechOutputProviderId'>} settings
 * @returns {VoiceRuntimeSyncPayload}
 */
export function buildVoiceRuntimeSyncPayload(
  settings: Pick<
    AppSettings,
    'speechInputEnabled' | 'speechInputProviderId' | 'speechOutputEnabled' | 'speechOutputProviderId'
  >,
): VoiceRuntimeSyncPayload {
  return {
    speechInputEnabled: settings.speechInputEnabled === true,
    speechInputProviderId: String(settings.speechInputProviderId ?? ''),
    speechOutputEnabled: settings.speechOutputEnabled === true,
    speechOutputProviderId: String(settings.speechOutputProviderId ?? ''),
  }
}

let pendingPayload: VoiceRuntimeSyncPayload | null = null
let draining: Promise<void> | null = null

function drainQueue(): void {
  if (draining) return
  draining = (async () => {
    while (pendingPayload) {
      const payload = pendingPayload
      pendingPayload = null
      const sync = typeof window !== 'undefined' ? window.desktopPet?.voiceRuntimeSync : undefined
      if (!sync) return
      try {
        await sync(payload)
      } catch (error) {
        console.error('[voice-runtime] sync failed:', getRedactedLogErrorMessage(error))
      }
    }
  })().finally(() => {
    draining = null
    if (pendingPayload) drainQueue()
  })
}

/**
 * Queue the latest voice-runtime snapshot. Only the newest snapshot matters,
 * so rapid settings commits collapse into one IPC call after the in-flight
 * sync finishes.
 *
 * @param {AppSettings} settings
 */
export function syncVoiceRuntimeToMain(settings: AppSettings): void {
  pendingPayload = buildVoiceRuntimeSyncPayload(settings)
  drainQueue()
}
