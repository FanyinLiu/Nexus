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
    | 'transparent_compositing'
    | 'content_security'
    | 'context_recovery'
    | 'graceful_fallback'
    | 'import_validation'
    | 'repair_guidance'
    | 'limited_compatibility'
    | 'private_diagnostics'
    | 'runtime_proof'
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
  version: '0.4.7-beta.1',
  eyebrowKey: 'about.release_spotlight.eyebrow',
  titleKey: 'about.release_spotlight.title',
  summaryKey: 'about.release_spotlight.summary',
  bullets: [
    {
      id: 'import_validation',
      titleKey: 'about.release_spotlight.bullet.import_validation.title',
      bodyKey: 'about.release_spotlight.bullet.import_validation.body',
    },
    {
      id: 'repair_guidance',
      titleKey: 'about.release_spotlight.bullet.repair_guidance.title',
      bodyKey: 'about.release_spotlight.bullet.repair_guidance.body',
    },
    {
      id: 'limited_compatibility',
      titleKey: 'about.release_spotlight.bullet.limited_compatibility.title',
      bodyKey: 'about.release_spotlight.bullet.limited_compatibility.body',
    },
    {
      id: 'private_diagnostics',
      titleKey: 'about.release_spotlight.bullet.private_diagnostics.title',
      bodyKey: 'about.release_spotlight.bullet.private_diagnostics.body',
    },
    {
      id: 'runtime_proof',
      titleKey: 'about.release_spotlight.bullet.runtime_proof.title',
      bodyKey: 'about.release_spotlight.bullet.runtime_proof.body',
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
