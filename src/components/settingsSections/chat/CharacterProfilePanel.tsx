import type { PetModelDefinition } from '../../../features/pet'
import {
  getChoiceRadioId,
  getChoiceTabIndex,
  handleChoiceRadioKeyDown,
} from '../../choiceRadioNav'
import { PetControlIcon } from '../../PetControlIcon'
import type { AppSettings, CharacterProfile } from '../../../types'
import type { TranslationKey, TranslationParams } from '../../../types/i18n'

const PROFILE_RADIO_GROUP_ID = 'settings-chat-profile'

type CharacterProfilePanelProps = {
  draft: AppSettings
  petModelPresets: PetModelDefinition[]
  ti: (key: TranslationKey, params?: TranslationParams) => string
  translatePetText: (value: string | undefined) => string
  onSelectProfile: (profile: CharacterProfile) => void
  onDeleteProfile: (profileId: string) => void
  onUpdateProfileLabel: (profileId: string, label: string) => void
  onUpdateProfilePreset: (profileId: string, patch: CharacterProfilePresetPatch) => void
}

type CharacterProfilePresetPatch = Pick<
  Partial<CharacterProfile>,
  | 'petModelId'
  | 'speechOutputProviderId'
  | 'speechOutputVoice'
  | 'speechOutputModel'
  | 'speechOutputInstructions'
>

export function CharacterProfilePanel({
  draft,
  petModelPresets,
  ti,
  translatePetText,
  onSelectProfile,
  onDeleteProfile,
  onUpdateProfileLabel,
  onUpdateProfilePreset,
}: CharacterProfilePanelProps) {
  const profileCount = draft.characterProfiles.length
  if (profileCount === 0) return null

  const profileCountLabel = ti('settings.chat.profiles_label', { count: profileCount })
  const profileChoiceIds = draft.characterProfiles.map((profile) => profile.id)

  function selectProfileById(profileId: string) {
    const profile = draft.characterProfiles.find((item) => item.id === profileId)
    if (profile) onSelectProfile(profile)
  }

  return (
    <div className="settings-drawer__card">
      <div className="settings-section__title-row">
        <div>
          <h5>{ti('settings.chat.profiles')}</h5>
          <p className="settings-drawer__hint">
            {ti('settings.chat.profiles_hint')}
          </p>
        </div>
        <div className="settings-page__meta">
          <span>{profileCountLabel}</span>
        </div>
      </div>

      <div
        className="settings-choice-grid"
        role="radiogroup"
        aria-label={ti('settings.chat.profiles')}
      >
        {draft.characterProfiles.map((profile) => {
          const isActive = draft.activeCharacterProfileId === profile.id
          const profileModel = petModelPresets.find((p) => p.id === profile.petModelId)
          const profileDisplayName = profile.label || profile.companionName

          return (
            <div key={profile.id} className={`settings-choice-card ${isActive ? 'is-active' : ''}`}>
              <button
                id={getChoiceRadioId(PROFILE_RADIO_GROUP_ID, profile.id)}
                type="button"
                className="settings-choice-card__body"
                role="radio"
                aria-checked={isActive}
                tabIndex={getChoiceTabIndex(profile.id, draft.activeCharacterProfileId, profileChoiceIds)}
                onClick={() => selectProfileById(profile.id)}
                onKeyDown={(event) =>
                  handleChoiceRadioKeyDown(
                    event,
                    profileChoiceIds,
                    profile.id,
                    PROFILE_RADIO_GROUP_ID,
                    selectProfileById,
                  )}
              >
                <span className="settings-choice-card__header">
                  <strong>{profileDisplayName}</strong>
                </span>
                <span className="settings-choice-card__description">
                  {translatePetText(profileModel?.label) || profile.petModelId}
                  {profile.speechOutputVoice ? ` · ${profile.speechOutputVoice}` : ''}
                </span>
              </button>
              <div className="settings-choice-card__actions">
                <input
                  className="settings-choice-card__label-input"
                  value={profile.label}
                  placeholder={profile.companionName}
                  aria-label={`${ti('settings.chat.profiles')}: ${profileDisplayName}`}
                  onChange={(event) => onUpdateProfileLabel(profile.id, event.target.value)}
                />
                <button
                  type="button"
                  className="settings-inline-delete"
                  onClick={() => onDeleteProfile(profile.id)}
                  aria-label={`${ti('settings.chat.delete_profile')}: ${profileDisplayName}`}
                  title={`${ti('settings.chat.delete_profile')}: ${profileDisplayName}`}
                >
                  <PetControlIcon name="close" />
                </button>
              </div>

              {isActive ? (
                <details className="settings-profile-preset-editor">
                  <summary>
                    <span>
                      <strong>{ti('settings.chat.profile_preset_editor')}</strong>
                      <small>{ti('settings.chat.profile_preset_editor_hint')}</small>
                    </span>
                  </summary>

                  <div className="settings-profile-preset-editor__grid">
                    <label className="settings-profile-preset-editor__field">
                      <span>{ti('settings.chat.profile_preset_pet_model')}</span>
                      <select
                        value={profile.petModelId}
                        onChange={(event) =>
                          onUpdateProfilePreset(profile.id, { petModelId: event.target.value })}
                      >
                        {profileModel ? null : (
                          <option value={profile.petModelId}>
                            {profile.petModelId || ti('settings.chat.sprite_pet_fallback_label')}
                          </option>
                        )}
                        {petModelPresets.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {translatePetText(preset.label) || preset.id}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="settings-profile-preset-editor__field">
                      <span>{ti('settings.chat.profile_preset_voice_provider')}</span>
                      <input
                        value={profile.speechOutputProviderId ?? ''}
                        placeholder={ti('settings.chat.profile_preset_voice_provider_placeholder')}
                        onChange={(event) =>
                          onUpdateProfilePreset(profile.id, { speechOutputProviderId: event.target.value })}
                      />
                    </label>

                    <label className="settings-profile-preset-editor__field">
                      <span>{ti('settings.chat.profile_preset_voice_id')}</span>
                      <input
                        value={profile.speechOutputVoice ?? ''}
                        placeholder={ti('settings.chat.voice_id_placeholder')}
                        onChange={(event) =>
                          onUpdateProfilePreset(profile.id, { speechOutputVoice: event.target.value })}
                      />
                    </label>

                    <label className="settings-profile-preset-editor__field">
                      <span>{ti('settings.chat.profile_preset_voice_model')}</span>
                      <input
                        value={profile.speechOutputModel ?? ''}
                        placeholder={ti('settings.chat.profile_preset_voice_model_placeholder')}
                        onChange={(event) =>
                          onUpdateProfilePreset(profile.id, { speechOutputModel: event.target.value })}
                      />
                    </label>

                    <label className="settings-profile-preset-editor__field settings-profile-preset-editor__field--wide">
                      <span>{ti('settings.chat.profile_preset_voice_instructions')}</span>
                      <textarea
                        rows={3}
                        value={profile.speechOutputInstructions ?? ''}
                        placeholder={ti('settings.chat.speaking_instructions_placeholder')}
                        onChange={(event) =>
                          onUpdateProfilePreset(profile.id, { speechOutputInstructions: event.target.value })}
                      />
                    </label>
                  </div>
                </details>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
