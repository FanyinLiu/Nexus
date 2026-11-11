import type { AppSettings } from '../../types/app.ts'

type MicrophoneFeatureSettings = Pick<
  AppSettings,
  'speechInputEnabled' | 'wakeWordEnabled' | 'continuousVoiceModeEnabled' | 'wakewordAlwaysOn'
>

/**
 * Any of these switches can cause Nexus to open the microphone. The permission
 * lifecycle treats a false → true change on this aggregate as a user action.
 */
export function isMicrophoneFeatureEnabled(settings: MicrophoneFeatureSettings): boolean {
  return settings.speechInputEnabled === true
    || settings.wakeWordEnabled === true
    || settings.continuousVoiceModeEnabled === true
    || settings.wakewordAlwaysOn === true
}
