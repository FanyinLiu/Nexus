import type { AppSettings } from '../../types/app.ts'
import { isMicrophoneFeatureEnabled } from '../voice/microphoneFeature.ts'

type ScreenSettings = Pick<AppSettings, 'contextAwarenessEnabled' | 'screenContextEnabled'>

type MediaPermissionSettings = ScreenSettings & Pick<
  AppSettings,
  'speechInputEnabled' | 'wakeWordEnabled' | 'continuousVoiceModeEnabled' | 'wakewordAlwaysOn'
>

/**
 * Screen recording is only active when the context-awareness master and the
 * screen sub-switch are both on. Startup, edge detection, and Settings status
 * all consume this single combined result.
 */
export function isScreenContextActive(settings: ScreenSettings): boolean {
  return settings.contextAwarenessEnabled === true && settings.screenContextEnabled === true
}

export type MediaPermissionStatusRequest = {
  microphoneEnabled: boolean
  screenContextActive: boolean
}

export function buildMediaPermissionStatusRequest(
  settings: MediaPermissionSettings,
): MediaPermissionStatusRequest {
  return {
    microphoneEnabled: isMicrophoneFeatureEnabled(settings),
    screenContextActive: isScreenContextActive(settings),
  }
}
