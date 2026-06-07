import type { Dispatch, SetStateAction } from 'react'
import type {
  PetModelDefinition,
  SpritePetAnimationState,
} from '../../../features/pet'
import { SPRITE_PET_ANIMATION_STATES } from '../../../features/pet'
import { SpritePetCanvas } from '../../../features/pet/components/SpritePetCanvas'
import {
  getChoiceRadioId,
  getChoiceTabIndex,
  handleChoiceRadioKeyDown,
} from '../../choiceRadioNav'
import type { AppSettings } from '../../../types'
import type { TranslationKey, TranslationParams } from '../../../types/i18n'
import { getSpritePreviewStateLabel } from './spritePreviewLabels'

const PET_MODEL_RADIO_GROUP_ID = 'settings-chat-pet-model'
const SPRITE_PREVIEW_RADIO_GROUP_ID = 'settings-chat-sprite-preview'

type PetModelPickerProps = {
  draft: AppSettings
  petModel: PetModelDefinition | undefined
  petModelPresets: PetModelDefinition[]
  spritePreviewState: SpritePetAnimationState
  setSpritePreviewState: Dispatch<SetStateAction<SpritePetAnimationState>>
  spritePetLabel: string
  ti: (key: TranslationKey, params?: TranslationParams) => string
  translatePetText: (value: string | undefined) => string
  onSelectPetModel: (petModelId: string) => void
}

export function PetModelPicker({
  draft,
  petModel,
  petModelPresets,
  spritePreviewState,
  setSpritePreviewState,
  spritePetLabel,
  ti,
  translatePetText,
  onSelectPetModel,
}: PetModelPickerProps) {
  const petModelChoiceIds = petModelPresets.map((preset) => preset.id)
  const spritePreviewChoiceIds = SPRITE_PET_ANIMATION_STATES

  return (
    <div className="settings-pet-studio__top">
      <div className="settings-mini-group settings-choice-field settings-choice-field--pet-model settings-pet-model-card">
        <div className="settings-mini-group__head">
          <h5>{ti('settings.chat.live2d_model')}</h5>
          <span>{translatePetText(petModel?.description)}</span>
        </div>
        <div
          className="settings-choice-grid"
          role="radiogroup"
          aria-label={ti('settings.chat.live2d_model')}
        >
          {petModelPresets.map((preset) => {
            const selected = draft.petModelId === preset.id

            return (
              <button
                id={getChoiceRadioId(PET_MODEL_RADIO_GROUP_ID, preset.id)}
                key={preset.id}
                type="button"
                className={`settings-choice-card ${selected ? 'is-active' : ''}`}
                role="radio"
                aria-checked={selected}
                tabIndex={getChoiceTabIndex(preset.id, draft.petModelId, petModelChoiceIds)}
                onClick={() => onSelectPetModel(preset.id)}
                onKeyDown={(event) =>
                  handleChoiceRadioKeyDown(
                    event,
                    petModelChoiceIds,
                    preset.id,
                    PET_MODEL_RADIO_GROUP_ID,
                    onSelectPetModel,
                  )}
              >
                <span className="settings-choice-card__header">
                  <strong>{translatePetText(preset.label)}</strong>
                </span>
                <span className="settings-choice-card__description">
                  {translatePetText(preset.description)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {petModel?.spriteAtlas ? (
        <div className="settings-mini-group settings-sprite-preview settings-pet-preview-card">
          <div className="settings-mini-group__head">
            <h5>{ti('settings.chat.codex_pet_runtime_preview')}</h5>
            <span>{ti('settings.chat.codex_pet_runtime_preview_hint')}</span>
          </div>
          <div className="settings-sprite-preview__body">
            <div className="settings-sprite-preview__stage">
              <SpritePetCanvas
                atlas={petModel.spriteAtlas}
                mood="idle"
                overrideState={spritePreviewState}
                placement="panel-card"
                label={spritePetLabel}
              />
            </div>
            <div
              className="settings-sprite-preview__states"
              role="radiogroup"
              aria-label={ti('settings.chat.codex_pet_runtime_preview')}
            >
              {SPRITE_PET_ANIMATION_STATES.map((state) => {
                const stateLabel = getSpritePreviewStateLabel(state, draft.uiLanguage)

                return (
                  <button
                    id={getChoiceRadioId(SPRITE_PREVIEW_RADIO_GROUP_ID, state)}
                    key={state}
                    type="button"
                    className={state === spritePreviewState ? 'is-active' : ''}
                    role="radio"
                    aria-checked={state === spritePreviewState}
                    tabIndex={getChoiceTabIndex(state, spritePreviewState, spritePreviewChoiceIds)}
                    title={state}
                    onClick={() => setSpritePreviewState(state)}
                    onKeyDown={(event) =>
                      handleChoiceRadioKeyDown(
                        event,
                        spritePreviewChoiceIds,
                        state,
                        SPRITE_PREVIEW_RADIO_GROUP_ID,
                        setSpritePreviewState,
                      )}
                  >
                    <span className="settings-sprite-preview__state-label">{stateLabel}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
