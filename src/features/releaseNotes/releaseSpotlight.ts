import type { TranslationKey } from '../../types/i18n.ts'

export type ReleaseSpotlightBullet = {
  id: 'notebook' | 'reminders' | 'quiet' | 'away'
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
  version: '0.5.0',
  eyebrowKey: 'about.release_spotlight.eyebrow',
  titleKey: 'about.release_spotlight.title',
  summaryKey: 'about.release_spotlight.summary',
  bullets: [
    {
      id: 'notebook',
      titleKey: 'about.release_spotlight.bullet.notebook.title',
      bodyKey: 'about.release_spotlight.bullet.notebook.body',
    },
    {
      id: 'reminders',
      titleKey: 'about.release_spotlight.bullet.reminders.title',
      bodyKey: 'about.release_spotlight.bullet.reminders.body',
    },
    {
      id: 'quiet',
      titleKey: 'about.release_spotlight.bullet.quiet.title',
      bodyKey: 'about.release_spotlight.bullet.quiet.body',
    },
    {
      id: 'away',
      titleKey: 'about.release_spotlight.bullet.away.title',
      bodyKey: 'about.release_spotlight.bullet.away.body',
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
