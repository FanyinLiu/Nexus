/**
 * Voice languages Nexus can actually speak and recognize.
 *
 * The five UI locales are the closed set. Stored free-text values from
 * older builds are canonicalized when they are aliases of that set, and
 * left untouched when they are not, so a custom tag a working engine
 * still needs is not rewritten to zh-CN.
 */

export const VOICE_LANGUAGES = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko'] as const

export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number]

/** Edge voices already listed in the speech provider catalog. */
export const EDGE_VOICE_BY_LANGUAGE: Record<VoiceLanguage, string> = {
  'zh-CN': 'zh-CN-XiaoxiaoNeural',
  'zh-TW': 'zh-TW-HsiaoChenNeural',
  'en-US': 'en-US-JennyNeural',
  ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural',
}

const ALIASES: Record<string, VoiceLanguage> = {
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-sg': 'zh-CN',
  cmn: 'zh-CN',
  'cmn-hans': 'zh-CN',
  chinese: 'zh-CN',
  'zh-tw': 'zh-TW',
  'zh-hant': 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh-mo': 'zh-TW',
  'cmn-hant': 'zh-TW',
  en: 'en-US',
  'en-us': 'en-US',
  'en-gb': 'en-US',
  'en-au': 'en-US',
  english: 'en-US',
  ja: 'ja',
  'ja-jp': 'ja',
  jp: 'ja',
  japanese: 'ja',
  ko: 'ko',
  'ko-kr': 'ko',
  kr: 'ko',
  korean: 'ko',
}

export type MigratedVoiceLanguage = {
  value: string
  canonical: VoiceLanguage | null
  changed: boolean
}

function isVoiceLanguage(value: string): value is VoiceLanguage {
  return (VOICE_LANGUAGES as readonly string[]).includes(value)
}

/**
 * Map a stored language tag onto the voice-language set.
 * Empty input stays empty. An unrecognized tag is preserved verbatim
 * (trimmed) so upgrade does not retarget a working custom engine.
 */
export function migrateVoiceLanguageValue(value: unknown): MigratedVoiceLanguage {
  if (typeof value !== 'string') {
    return { value: '', canonical: null, changed: false }
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return { value: '', canonical: null, changed: trimmed !== value }
  }
  const canonical = ALIASES[trimmed.toLowerCase()] ?? null
  if (canonical) {
    return { value: canonical, canonical, changed: canonical !== value }
  }
  if (isVoiceLanguage(trimmed)) {
    return { value: trimmed, canonical: trimmed, changed: trimmed !== value }
  }
  return { value: trimmed, canonical: null, changed: trimmed !== value }
}

/**
 * Language to persist on load. A canonical or custom stored tag wins.
 * Only a missing tag follows the UI language, which is how a fresh
 * install stops defaulting every locale to zh-CN.
 */
export function resolveStoredVoiceLanguage(stored: unknown, uiLanguage: string): string {
  const migrated = migrateVoiceLanguageValue(stored)
  if (migrated.canonical || migrated.value) return migrated.value
  const ui = migrateVoiceLanguageValue(uiLanguage)
  return ui.canonical ?? 'zh-CN'
}

/** Edge voice for a canonical language, or null when the tag is custom. */
export function defaultEdgeVoiceForLanguage(language: string): string | null {
  const canonical = migrateVoiceLanguageValue(language).canonical
  if (!canonical) return null
  return EDGE_VOICE_BY_LANGUAGE[canonical]
}

/**
 * Languages this user has actually set up: UI locale plus any stored
 * voice tags that land in the supported set. The selector still plans
 * all five; this list marks which rows are theirs.
 */
export function configuredVoiceLanguages(input: {
  uiLanguage: string
  speechRecognitionLang?: string
  speechSynthesisLang?: string
}): VoiceLanguage[] {
  const found: VoiceLanguage[] = []
  const push = (value: unknown) => {
    const canonical = migrateVoiceLanguageValue(value).canonical
    if (canonical && !found.includes(canonical)) found.push(canonical)
  }
  push(input.uiLanguage)
  push(input.speechRecognitionLang)
  push(input.speechSynthesisLang)
  return found.length > 0 ? found : ['zh-CN']
}
