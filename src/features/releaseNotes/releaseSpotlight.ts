import type { TranslationKey } from '../../types/i18n.ts'

export type ReleaseSpotlightBullet = {
  id: 'memory_sources' | 'memory_control' | 'first_run' | 'companion_boundary'
  titleKey: TranslationKey
  bodyKey: TranslationKey
}

export type ReleaseSpotlight = {
  version: string
  eyebrowKey: TranslationKey
  titleKey: TranslationKey
  summaryKey: TranslationKey
  bullets: readonly ReleaseSpotlightBullet[]
}

export const CURRENT_RELEASE_SPOTLIGHT: ReleaseSpotlight = {
  version: '0.3.5',
  eyebrowKey: 'about.release_spotlight.eyebrow',
  titleKey: 'about.release_spotlight.title',
  summaryKey: 'about.release_spotlight.summary',
  bullets: [
    {
      id: 'memory_sources',
      titleKey: 'about.release_spotlight.bullet.memory_sources.title',
      bodyKey: 'about.release_spotlight.bullet.memory_sources.body',
    },
    {
      id: 'memory_control',
      titleKey: 'about.release_spotlight.bullet.memory_control.title',
      bodyKey: 'about.release_spotlight.bullet.memory_control.body',
    },
    {
      id: 'first_run',
      titleKey: 'about.release_spotlight.bullet.first_run.title',
      bodyKey: 'about.release_spotlight.bullet.first_run.body',
    },
    {
      id: 'companion_boundary',
      titleKey: 'about.release_spotlight.bullet.companion_boundary.title',
      bodyKey: 'about.release_spotlight.bullet.companion_boundary.body',
    },
  ],
}

export function getReleaseSpotlightTranslationKeys(spotlight = CURRENT_RELEASE_SPOTLIGHT): TranslationKey[] {
  return [
    spotlight.eyebrowKey,
    spotlight.titleKey,
    spotlight.summaryKey,
    ...spotlight.bullets.flatMap((item) => [item.titleKey, item.bodyKey]),
  ]
}
