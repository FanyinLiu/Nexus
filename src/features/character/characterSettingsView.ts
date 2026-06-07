import type { PetModelDefinition } from '../pet/models.ts'
import { RELATIONSHIP_OPTIONS } from '../../lib/relationshipTypes.ts'
import { pickTranslatedUiTextOrFallback } from '../../lib/uiLanguage.ts'
import type {
  AppSettings,
  CompanionRelationshipType,
} from '../../types/app.ts'
import type { TranslationKey } from '../../types/i18n.ts'

type CharacterSettingsInput = Pick<
  AppSettings,
  | 'activeCharacterProfileId'
  | 'characterProfiles'
  | 'companionName'
  | 'companionRelationshipType'
  | 'petModelId'
  | 'uiLanguage'
  | 'userName'
>

export type CharacterSettingsSummary = {
  activeProfileLabel: string
  companionName: string
  petModelLabel: string
  profileCount: number
  relationshipLabelKey: TranslationKey
  userName: string
}

export function getRelationshipLabelKey(
  relationshipType: CompanionRelationshipType,
): TranslationKey {
  return RELATIONSHIP_OPTIONS.find((option) => option.value === relationshipType)?.labelKey
    ?? 'onboarding.companion.relationship_open_ended'
}

export function resolveCharacterSettingsSummary(
  settings: CharacterSettingsInput,
  petModel: PetModelDefinition | undefined,
): CharacterSettingsSummary {
  const activeProfile = settings.characterProfiles.find(
    (profile) => profile.id === settings.activeCharacterProfileId,
  )

  return {
    activeProfileLabel: activeProfile?.label || activeProfile?.companionName || '',
    companionName: settings.companionName.trim(),
    petModelLabel: pickTranslatedUiTextOrFallback(
      settings.uiLanguage ?? 'en-US',
      petModel?.label,
    ) || settings.petModelId,
    profileCount: settings.characterProfiles.length,
    relationshipLabelKey: getRelationshipLabelKey(settings.companionRelationshipType),
    userName: settings.userName.trim(),
  }
}
