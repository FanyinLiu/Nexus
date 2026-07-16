import type { SettingsTrustSurfaceGroupId } from './settingsDrawerMetadata.ts'
import type { SettingsSectionId } from './settingsDrawerSupport.ts'
import type { TranslationKey } from '../types/i18n.ts'
import type { SettingsCardIconKey } from './settingsDrawerIcons.tsx'

export type SettingsHomeActionId = 'onboarding'

export type SettingsHomeActionEntry = {
  actionId: SettingsHomeActionId
  ariaLabelKey: TranslationKey
  glyph: SettingsCardIconKey
  titleKey: TranslationKey
  trustGroup: SettingsTrustSurfaceGroupId
  valueKey: TranslationKey
}

export type SettingsHomeGroup = {
  id: SettingsHomeGroupId
  hintKey: TranslationKey
  sectionIds: readonly SettingsSectionId[]
  titleKey: TranslationKey
  actions?: readonly SettingsHomeActionEntry[]
}

export type SettingsHomeGroupId =
  | 'appearanceExperience'
  | 'companionBehavior'
  | 'memoryContext'
  | 'modelConnections'
  | 'maintenance'

export const SETTINGS_HOME_GROUPS: readonly SettingsHomeGroup[] = [
  {
    id: 'appearanceExperience',
    titleKey: 'settings.home.group.appearance_experience',
    hintKey: 'settings.home.group.appearance_experience_hint',
    sectionIds: ['chat', 'letters'],
  },
  {
    id: 'companionBehavior',
    titleKey: 'settings.home.group.companion_behavior',
    hintKey: 'settings.home.group.companion_behavior_hint',
    sectionIds: ['voice', 'window', 'autonomy'],
  },
  {
    id: 'memoryContext',
    titleKey: 'settings.home.group.memory_context',
    hintKey: 'settings.home.group.memory_context_hint',
    sectionIds: ['memory', 'lorebooks'],
  },
  {
    id: 'modelConnections',
    titleKey: 'settings.home.group.model_connections',
    hintKey: 'settings.home.group.model_connections_hint',
    sectionIds: ['model', 'integrations', 'tools'],
  },
  {
    id: 'maintenance',
    titleKey: 'settings.home.group.maintenance',
    hintKey: 'settings.home.group.maintenance_hint',
    sectionIds: ['history', 'console'],
    actions: [
      {
        actionId: 'onboarding',
        titleKey: 'settings.home.onboarding.title',
        valueKey: 'settings.home.onboarding.value',
        ariaLabelKey: 'settings.home.onboarding.aria_label',
        glyph: 'onboarding',
        trustGroup: 'appearanceInteraction',
      },
    ],
  },
]

export const SETTINGS_HOME_SECTION_ORDER = SETTINGS_HOME_GROUPS
  .flatMap((group) => group.sectionIds)

export function getSettingsHomeSectionOrder(
  sectionOrder: readonly SettingsSectionId[],
  sectionId: SettingsSectionId,
) {
  const sectionIndex = sectionOrder.indexOf(sectionId)
  return sectionIndex === -1 ? sectionOrder.length : sectionIndex
}

export function compareSettingsHomeSections(
  sectionOrder: readonly SettingsSectionId[],
  first: { sectionId: SettingsSectionId },
  second: { sectionId: SettingsSectionId },
) {
  return getSettingsHomeSectionOrder(sectionOrder, first.sectionId)
    - getSettingsHomeSectionOrder(sectionOrder, second.sectionId)
}
