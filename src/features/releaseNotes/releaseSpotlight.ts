import type { TranslationKey } from '../../types/i18n.ts'

export type ReleaseSpotlightBullet = {
  id: 'privacy_switches' | 'deferred_reminders' | 'deleted_memory' | 'permissions'
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
  version: '0.5.2',
  eyebrowKey: 'about.release_spotlight.eyebrow',
  titleKey: 'about.release_spotlight.title',
  summaryKey: 'about.release_spotlight.summary',
  bullets: [
    {
      id: 'privacy_switches',
      titleKey: 'about.release_spotlight.bullet.privacy_switches.title',
      bodyKey: 'about.release_spotlight.bullet.privacy_switches.body',
    },
    {
      id: 'deferred_reminders',
      titleKey: 'about.release_spotlight.bullet.deferred_reminders.title',
      bodyKey: 'about.release_spotlight.bullet.deferred_reminders.body',
    },
    {
      id: 'deleted_memory',
      titleKey: 'about.release_spotlight.bullet.deleted_memory.title',
      bodyKey: 'about.release_spotlight.bullet.deleted_memory.body',
    },
    {
      id: 'permissions',
      titleKey: 'about.release_spotlight.bullet.permissions.title',
      bodyKey: 'about.release_spotlight.bullet.permissions.body',
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
