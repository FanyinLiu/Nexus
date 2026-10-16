/**
 * Live summaries for the five settings home cards.
 * The page itself shows the longer hint; the card shows the current result.
 */

import {
  inferCompanionInitiative,
  sharedLookup,
  type SettingsSimplePageId,
} from '../../features/settingsSimplify/index.ts'
import { getApiProviderPreset } from '../../features/models/providerCatalog.ts'
import { pickTranslatedUiText, UI_LANGUAGE_OPTIONS } from '../../lib/uiLanguage.ts'
import type { SettingsCardIconKey } from '../settingsDrawerIcons.tsx'
import type { AppSettings, TranslationKey, TranslationParams, UiLanguage } from '../../types/index.ts'

const PAGE_ICON: Record<SettingsSimplePageId, SettingsCardIconKey> = {
  appearance: 'palette',
  voice: 'waveform',
  memory: 'bookmark',
  connect: 'plug',
  about: 'info',
}

const PAGE_TONE = {
  appearance: 'accent',
  voice: 'accent',
  memory: 'success',
  connect: 'warning',
  about: 'accent',
} as const

/** Translate one settings string for the draft's language. */
export function simpleTranslate(language: UiLanguage) {
  return (key: TranslationKey, params?: TranslationParams) => pickTranslatedUiText(language, key, params)
}

function pageSummary(
  page: SettingsSimplePageId,
  draft: AppSettings,
  ti: ReturnType<typeof simpleTranslate>,
) {
  if (page === 'appearance') {
    const pace = inferCompanionInitiative(draft)
    if (pace === 'quiet') return ti('settings.simple.initiative_quiet')
    if (pace === 'sometimes') return ti('settings.simple.initiative_sometimes')
    if (pace === 'often') return ti('settings.simple.initiative_often')
    return ti('settings.simple.initiative_custom')
  }
  if (page === 'voice') {
    if (draft.speechInputEnabled && draft.speechOutputEnabled) return ti('settings.simple.summary_voice_both')
    if (draft.speechInputEnabled) return ti('settings.simple.summary_voice_listen')
    if (draft.speechOutputEnabled) return ti('settings.simple.summary_voice_speak')
    return ti('settings.simple.summary_voice_off')
  }
  if (page === 'memory') {
    return draft.memoryPaused
      ? ti('settings.simple.summary_memory_paused')
      : ti('settings.simple.summary_memory_on')
  }
  if (page === 'connect') {
    const preset = getApiProviderPreset(draft.apiProviderId)
    const lookup = sharedLookup(draft.toolWebSearchEnabled, draft.toolWeatherEnabled)
    return lookup ? `${preset.label} · ${ti('settings.simple.summary_connect_lookup')}` : preset.label
  }
  return UI_LANGUAGE_OPTIONS.find((option) => option.value === draft.uiLanguage)?.nativeLabel ?? draft.uiLanguage
}

/** Home-card copy for the five pages. Descriptions are the live result. */
export function settingsSimpleGroupCopy(draft: AppSettings) {
  const ti = simpleTranslate(draft.uiLanguage)
  return (['appearance', 'voice', 'memory', 'connect', 'about'] as const).map((page) => ({
    id: page,
    label: ti(`settings.simple.${page}`),
    description: pageSummary(page, draft, ti),
    detail: ti(`settings.simple.${page}_hint`),
    icon: PAGE_ICON[page],
    tone: PAGE_TONE[page],
  }))
}
