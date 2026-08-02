import type { TranslationKey } from '../../types/i18n.ts'

export type ReleaseSpotlightBullet = {
  id:
    | 'companion_presence'
    | 'transparent_surface'
    | 'text_chat_support'
    | 'voice_settings'
    | 'companion_boundary'
    | 'toolchain_refresh'
    | 'security_hardening'
    | 'code_health'
    | 'quality_gates'
    | 'release_pipeline'
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
  version: '0.4.5-beta.1',
  eyebrowKey: 'about.release_spotlight.eyebrow',
  titleKey: 'about.release_spotlight.title',
  summaryKey: 'about.release_spotlight.summary',
  bullets: [
    {
      id: 'toolchain_refresh',
      titleKey: 'about.release_spotlight.bullet.toolchain_refresh.title',
      bodyKey: 'about.release_spotlight.bullet.toolchain_refresh.body',
    },
    {
      id: 'security_hardening',
      titleKey: 'about.release_spotlight.bullet.security_hardening.title',
      bodyKey: 'about.release_spotlight.bullet.security_hardening.body',
    },
    {
      id: 'code_health',
      titleKey: 'about.release_spotlight.bullet.code_health.title',
      bodyKey: 'about.release_spotlight.bullet.code_health.body',
    },
    {
      id: 'quality_gates',
      titleKey: 'about.release_spotlight.bullet.quality_gates.title',
      bodyKey: 'about.release_spotlight.bullet.quality_gates.body',
    },
    {
      id: 'release_pipeline',
      titleKey: 'about.release_spotlight.bullet.release_pipeline.title',
      bodyKey: 'about.release_spotlight.bullet.release_pipeline.body',
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
