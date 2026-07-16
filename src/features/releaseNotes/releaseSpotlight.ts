import type { TranslationKey } from '../../types/i18n.ts'

export type ReleaseSpotlightBullet = {
  id:
    | 'companion_presence'
    | 'transparent_surface'
    | 'text_chat_support'
    | 'voice_settings'
    | 'companion_boundary'
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
  version: '0.4.3',
  eyebrowKey: 'about.release_spotlight.eyebrow',
  titleKey: 'about.release_spotlight.title',
  summaryKey: 'about.release_spotlight.summary',
  bullets: [
    {
      id: 'companion_presence',
      titleKey: 'about.release_spotlight.bullet.companion_presence.title',
      bodyKey: 'about.release_spotlight.bullet.companion_presence.body',
    },
    {
      id: 'transparent_surface',
      titleKey: 'about.release_spotlight.bullet.transparent_surface.title',
      bodyKey: 'about.release_spotlight.bullet.transparent_surface.body',
    },
    {
      id: 'text_chat_support',
      titleKey: 'about.release_spotlight.bullet.text_chat_support.title',
      bodyKey: 'about.release_spotlight.bullet.text_chat_support.body',
    },
    {
      id: 'voice_settings',
      titleKey: 'about.release_spotlight.bullet.voice_settings.title',
      bodyKey: 'about.release_spotlight.bullet.voice_settings.body',
    },
    {
      id: 'companion_boundary',
      titleKey: 'about.release_spotlight.bullet.companion_boundary.title',
      bodyKey: 'about.release_spotlight.bullet.companion_boundary.body',
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
