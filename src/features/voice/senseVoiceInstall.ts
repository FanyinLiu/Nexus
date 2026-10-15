/**
 * What to do when the selected local STT engine has no SenseVoice model.
 *
 * A cloud profile counts only when the user stored a credential for it.
 * Empty catalog defaults are not a configured provider. The choice is not
 * persisted: the next turn still starts from the user's saved selection.
 */

import { isSenseVoiceSpeechInputProvider } from '../../lib/audioProviders.ts'
import { getSpeechInputProvider, SPEECH_INPUT_PROVIDERS } from '../../lib/speechProviderCatalog.ts'
import type { AppSettings } from '../../types/app.ts'

export const SENSEVOICE_CATALOG_ID = 'sensevoice'

export type MissingSenseVoiceDecision =
  | { action: 'disabled' }
  | { action: 'cloud'; providerId: string }

/**
 * Show the in-app download only for the local SenseVoice provider, and only
 * until that catalog entry is present.
 */
export function shouldOfferSenseVoiceDownload(providerId: string, modelPresent: boolean): boolean {
  return isSenseVoiceSpeechInputProvider(providerId) && !modelPresent
}

function cloudProfileIsConfigured(providerId: string, apiKey: string | undefined): boolean {
  const entry = getSpeechInputProvider(providerId)
  if (entry.id !== providerId || entry.kind !== 'remote') return false
  return typeof apiKey === 'string' && apiKey.trim().length > 0
}

/**
 * Cloud speech input the user already configured, otherwise leave STT off.
 * Wake word and other sherpa engines are unaffected.
 */
export function resolveMissingSenseVoiceSpeechInput(
  settings: Pick<AppSettings, 'speechInputProviderProfiles'>,
): MissingSenseVoiceDecision {
  const profiles = settings.speechInputProviderProfiles ?? {}
  for (const provider of SPEECH_INPUT_PROVIDERS) {
    if (!cloudProfileIsConfigured(provider.id, profiles[provider.id]?.apiKey)) continue
    return { action: 'cloud', providerId: provider.id }
  }
  return { action: 'disabled' }
}
