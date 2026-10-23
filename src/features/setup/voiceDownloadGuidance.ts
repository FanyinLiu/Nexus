/**
 * The missing-model sentence names where the download button lives.
 *
 * The three labels are the same keys the Settings screen renders
 * (title, Voice page, and the collapsible that contains the button).
 * Hard-coding the path lets a renamed section leave the reminder
 * pointing at a nested heading the button is not under.
 */

import type { TranslationKey, TranslationParams } from '../../types/i18n.ts'

const VOICE_DOWNLOAD_PATH = {
  settings: 'settings.title',
  voice: 'settings.simple.voice',
  advanced: 'settings.simple.advanced',
} as const satisfies Record<string, TranslationKey>

/**
 * Fill a missing-model sentence with the Settings path labels.
 */
export function voiceDownloadGuidance(
  translate: (key: TranslationKey, params?: TranslationParams) => string,
  key:
    | 'model_setup.deferred_reminder'
    | 'voice.provider.sensevoice.not_installed'
    | 'voice.provider.paraformer.model_missing',
): string {
  return translate(key, {
    settings: translate(VOICE_DOWNLOAD_PATH.settings),
    voice: translate(VOICE_DOWNLOAD_PATH.voice),
    advanced: translate(VOICE_DOWNLOAD_PATH.advanced),
  })
}
