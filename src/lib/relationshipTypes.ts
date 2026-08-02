import type { CompanionRelationshipType } from '../types'
import type { TranslationKey } from '../types/i18n.ts'

export const RELATIONSHIP_OPTIONS: ReadonlyArray<{
  value: CompanionRelationshipType
  labelKey: TranslationKey
}> = [
  { value: 'open_ended', labelKey: 'onboarding.companion.relationship_open_ended' },
  { value: 'friend', labelKey: 'onboarding.companion.relationship_friend' },
  { value: 'mentor', labelKey: 'onboarding.companion.relationship_mentor' },
  { value: 'quiet_companion', labelKey: 'onboarding.companion.relationship_quiet_companion' },
]
