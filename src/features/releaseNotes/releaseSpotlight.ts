import type { TranslationKey } from '../../types/i18n.ts'

export type ReleaseSpotlightBullet = {
  id: 'gaze' | 'messages' | 'voice' | 'updates'
  titleKey: TranslationKey
  bodyKey: TranslationKey
}

export type ReleaseSpotlightAction = {
  id: 'open_voice' | 'preview_companion'
  labelKey: TranslationKey
  targetSectionId: 'voice' | 'chat'
}

export type ReleaseSpotlight = {
  version: string
  eyebrowKey: TranslationKey
  titleKey: TranslationKey
  summaryKey: TranslationKey
  bullets: readonly ReleaseSpotlightBullet[]
  actions: readonly ReleaseSpotlightAction[]
}

export const CURRENT_RELEASE_SPOTLIGHT: ReleaseSpotlight = {
  version: '0.4.8-beta.1',
  eyebrowKey: 'about.release_spotlight.eyebrow',
  titleKey: 'about.release_spotlight.title',
  summaryKey: 'about.release_spotlight.summary',
  bullets: [
    {
      id: 'gaze',
      titleKey: 'about.release_spotlight.bullet.gaze.title',
      bodyKey: 'about.release_spotlight.bullet.gaze.body',
    },
    {
      id: 'messages',
      titleKey: 'about.release_spotlight.bullet.messages.title',
      bodyKey: 'about.release_spotlight.bullet.messages.body',
    },
    {
      id: 'voice',
      titleKey: 'about.release_spotlight.bullet.voice.title',
      bodyKey: 'about.release_spotlight.bullet.voice.body',
    },
    {
      id: 'updates',
      titleKey: 'about.release_spotlight.bullet.updates.title',
      bodyKey: 'about.release_spotlight.bullet.updates.body',
    },
  ],
  actions: [
    {
      id: 'open_voice',
      labelKey: 'about.release_spotlight.action.open_voice',
      targetSectionId: 'voice',
    },
    {
      id: 'preview_companion',
      labelKey: 'about.release_spotlight.action.preview_companion',
      targetSectionId: 'chat',
    },
  ],
}

export function getReleaseSpotlightTranslationKeys(spotlight = CURRENT_RELEASE_SPOTLIGHT): TranslationKey[] {
  return [
    spotlight.eyebrowKey,
    spotlight.titleKey,
    spotlight.summaryKey,
    ...spotlight.bullets.flatMap((item) => [item.titleKey, item.bodyKey]),
    ...spotlight.actions.map((item) => item.labelKey),
  ]
}
