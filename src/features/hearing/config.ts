import type { AppSettings } from '../../types'
import type { VadSensitivity, VoiceTriggerMode } from '../../types/voice'

export type HearingConfig = {
  speechInputEnabled: boolean
  speechInputProviderId: string
  speechInputApiBaseUrl: string
  speechInputApiKey: string
  speechInputModel: string
  speechInputFailoverEnabled: boolean
  speechRecognitionLang: string

  voiceActivityDetectionEnabled: boolean
  vadSensitivity: VadSensitivity

  voiceTriggerMode: VoiceTriggerMode
  wakeWordEnabled: boolean
  wakeWord: string

  companionName: string
  toolWeatherDefaultLocation: string
}

export function hearingConfigFromSettings(settings: AppSettings): HearingConfig {
  return {
    speechInputEnabled: settings.speechInputEnabled,
    speechInputProviderId: settings.speechInputProviderId,
    speechInputApiBaseUrl: settings.speechInputApiBaseUrl,
    speechInputApiKey: settings.speechInputApiKey,
    speechInputModel: settings.speechInputModel,
    speechInputFailoverEnabled: settings.speechInputFailoverEnabled,
    speechRecognitionLang: settings.speechRecognitionLang,
    voiceActivityDetectionEnabled: settings.voiceActivityDetectionEnabled,
    vadSensitivity: settings.vadSensitivity,
    voiceTriggerMode: settings.voiceTriggerMode,
    wakeWordEnabled: settings.wakeWordEnabled,
    wakeWord: settings.wakeWord,
    companionName: settings.companionName,
    toolWeatherDefaultLocation: settings.toolWeatherDefaultLocation,
  }
}
