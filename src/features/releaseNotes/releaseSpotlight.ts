import type { TranslationKey } from '../../types/i18n.ts'

export type ReleaseSpotlightBullet = {
  id:
    | 'memory_sources'
    | 'memory_control'
    | 'companion_presence'
    | 'first_run'
    | 'companion_boundary'
  titleKey: TranslationKey
  bodyKey: TranslationKey
}

export type ReleaseSpotlightAction = {
  id: 'review_memory' | 'preview_companion'
  labelKey: TranslationKey
  targetSectionId: 'memory' | 'chat'
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
  version: '0.4.1',
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
      id: 'companion_presence',
      titleKey: 'about.release_spotlight.bullet.companion_presence.title',
      bodyKey: 'about.release_spotlight.bullet.companion_presence.body',
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
  actions: [
    {
      id: 'review_memory',
      labelKey: 'about.release_spotlight.action.review_memory',
      targetSectionId: 'memory',
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
