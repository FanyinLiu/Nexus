import type { TranslationKey } from '../../types/i18n.ts'

export type ReleaseSpotlightBullet = {
  id: 'packaged_voice' | 'interrupt' | 'takeover' | 'memory'
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
  version: '0.5.1',
  eyebrowKey: 'about.release_spotlight.eyebrow',
  titleKey: 'about.release_spotlight.title',
  summaryKey: 'about.release_spotlight.summary',
  bullets: [
    {
      id: 'packaged_voice',
      titleKey: 'about.release_spotlight.bullet.packaged_voice.title',
      bodyKey: 'about.release_spotlight.bullet.packaged_voice.body',
    },
    {
      id: 'interrupt',
      titleKey: 'about.release_spotlight.bullet.interrupt.title',
      bodyKey: 'about.release_spotlight.bullet.interrupt.body',
    },
    {
      id: 'takeover',
      titleKey: 'about.release_spotlight.bullet.takeover.title',
      bodyKey: 'about.release_spotlight.bullet.takeover.body',
    },
    {
      id: 'memory',
      titleKey: 'about.release_spotlight.bullet.memory.title',
      bodyKey: 'about.release_spotlight.bullet.memory.body',
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
