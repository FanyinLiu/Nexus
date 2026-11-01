/**
 * Drawer view model derived from the draft and live companion state. Kept out
 * of the renderer so the page components receive precomputed labels, section
 * metadata, home groups, and theme tone class names without duplicating memo
 * chains. Memo dependencies intentionally mirror the former inline block.
 */

import { useCallback, useMemo } from 'react'
import {
  getMemorySearchModeOptions,
  getSettingsSectionOptions,
  getSettingsThemeTone,
  normalizeSettingsSectionId,
} from '../settingsDrawerSupport.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage.ts'
import { buildSettingsSectionMeta, getSettingsTrustSurfaceGroupId } from '../settingsDrawerMetadata.ts'
import { compareSettingsHomeSections, SETTINGS_HOME_GROUPS } from '../settingsHomeArchitecture.ts'
import type { SettingsSectionId } from '../settingsDrawerSupport.ts'
import type { PetModelDefinition } from '../../features/pet/index.ts'
import type {
  AppSettings,
  DailyMemoryEntry,
  DebugConsoleEvent,
  MemoryItem,
} from '../../types/index.ts'

export type SettingsDrawerViewModelInput = {
  activeSectionId: SettingsSectionId
  chatMessageCount: number
  clickThroughEnabled: boolean
  continuousVoiceActive: boolean
  dailyMemoryEntries: DailyMemoryEntry[]
  debugConsoleEvents: DebugConsoleEvent[]
  draft: AppSettings
  liveTranscript: string
  memories: MemoryItem[]
  petModelPresets: PetModelDefinition[]
  settingsView: 'home' | 'section'
}

export function useSettingsDrawerViewModel({
  activeSectionId,
  chatMessageCount,
  clickThroughEnabled,
  continuousVoiceActive,
  dailyMemoryEntries,
  debugConsoleEvents,
  draft,
  liveTranscript,
  memories,
  petModelPresets,
  settingsView,
}: SettingsDrawerViewModelInput) {
  const petModel = petModelPresets.find((preset) => preset.id === draft.petModelId) ?? petModelPresets[0]

  const uiLanguage = draft.uiLanguage
  const ti = useCallback((
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(uiLanguage, key, params), [uiLanguage])
  const memorySearchModeOptions = useMemo(
    () => getMemorySearchModeOptions(uiLanguage),
    [uiLanguage],
  )
  const settingsSectionOptions = useMemo(
    () => getSettingsSectionOptions(uiLanguage),
    [uiLanguage],
  )
  const selectedMemorySearchMode = useMemo(
    () => memorySearchModeOptions.find((option) => option.value === draft.memorySearchMode)
      ?? memorySearchModeOptions[1],
    [draft.memorySearchMode, memorySearchModeOptions],
  )
  const activeSectionLabel = settingsSectionOptions.find((section) => section.id === activeSectionId)?.label
    ?? settingsSectionOptions.find((section) => section.id === normalizeSettingsSectionId(activeSectionId))?.label
    ?? settingsSectionOptions[0].label
  const { meta: settingsSectionMetaById } = useMemo(() => buildSettingsSectionMeta({
    ti,
    uiLanguage,
    draft,
    petModel,
    memories,
    dailyMemoryEntries,
    chatMessageCount,
    liveTranscript,
    debugConsoleEvents,
    continuousVoiceActive,
    clickThroughEnabled,
  }), [
    chatMessageCount,
    continuousVoiceActive,
    dailyMemoryEntries,
    debugConsoleEvents,
    draft,
    liveTranscript,
    memories,
    petModel,
    ti,
    uiLanguage,
    clickThroughEnabled,
  ])
  const settingsHomeCards = useMemo(() => settingsSectionOptions.map((section) => {
    const sectionMeta = settingsSectionMetaById[section.id]

    return {
      key: section.id,
      sectionId: section.id,
      title: section.label,
      eyebrow: sectionMeta.eyebrow,
      description: sectionMeta.description,
      glyph: sectionMeta.glyph,
      preview: sectionMeta.preview,
      trustGroup: getSettingsTrustSurfaceGroupId(section.id),
    }
  }), [settingsSectionMetaById, settingsSectionOptions])
  const settingsHomeCardsBySectionId = useMemo(
    () => new Map(settingsHomeCards.map((card) => [card.sectionId, card])),
    [settingsHomeCards],
  )
  const settingsHomeGroups = useMemo(() => SETTINGS_HOME_GROUPS.map((group) => ({
    ...group,
    cards: group.sectionIds
      .map((sectionId) => settingsHomeCardsBySectionId.get(sectionId))
      .filter((card): card is (typeof settingsHomeCards)[number] => Boolean(card))
      .sort((first, second) => compareSettingsHomeSections(group.sectionIds, first, second)),
  })).filter((group) => group.cards.length || group.actions?.length), [settingsHomeCardsBySectionId])
  const activeSectionMeta = settingsSectionMetaById[activeSectionId]
  const activeSectionDescription = activeSectionMeta.description
  const settingsThemeTone = getSettingsThemeTone(draft.themeId, draft.themeColorScheme)
  const settingsUsesDarkChrome = settingsThemeTone === 'black' || settingsThemeTone === 'night'
  const settingsBackdropClassName = [
    'settings-backdrop sb',
    settingsUsesDarkChrome ? 'settings-backdrop--night sb-night' : 'settings-backdrop--day sb-day',
    settingsThemeTone === 'black' ? 'settings-backdrop--black sb-black' : '',
    settingsUsesDarkChrome ? '' : 'settings-backdrop--light sb-light',
    settingsThemeTone === 'warm-day' ? 'settings-backdrop--warm-day sb-warm' : '',
  ].filter(Boolean).join(' ')
  const settingsDrawerClassName = [
    'settings-drawer sd',
    settingsView === 'home' ? 'settings-drawer--home sd-home' : 'settings-drawer--section sd-section',
    settingsUsesDarkChrome ? 'settings-drawer--night sd-night' : 'settings-drawer--day sd-day',
    settingsThemeTone === 'black' ? 'settings-drawer--black sd-black' : '',
    settingsUsesDarkChrome ? '' : 'settings-drawer--light sd-light',
    !settingsUsesDarkChrome && settingsView !== 'home' ? 'settings-drawer--light-section sd-light-section' : '',
    settingsThemeTone === 'warm-day' ? 'settings-drawer--warm-day sd-warm' : '',
    settingsThemeTone === 'warm-day' && settingsView !== 'home' ? 'settings-drawer--warm-section sd-warm-section' : '',
    settingsThemeTone === 'day' && settingsView !== 'home' ? 'settings-drawer--day-section sd-day-section' : '',
  ].filter(Boolean).join(' ')

  return {
    activeSectionDescription,
    activeSectionLabel,
    activeSectionMeta,
    memorySearchModeOptions,
    petModel,
    selectedMemorySearchMode,
    settingsBackdropClassName,
    settingsDrawerClassName,
    settingsHomeGroups,
    settingsSectionMetaById,
    settingsSectionOptions,
    settingsThemeTone,
    ti,
    uiLanguage,
  }
}
