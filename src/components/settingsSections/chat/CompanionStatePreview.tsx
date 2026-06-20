import { useState } from 'react'
import type {
  CompanionActivityMotion,
  CompanionActivityPhase,
  PetModelDefinition,
} from '../../../features/pet'
import {
  COMPANION_ACTIVITY_PHASES,
  resolveCompanionActivityPreviewState,
} from '../../../features/pet'
import { SpritePetCanvas } from '../../../features/pet/components/SpritePetCanvas'
import type { TranslationKey, TranslationParams } from '../../../types/i18n'
import {
  getChoiceRadioId,
  getChoiceTabIndex,
  handleChoiceRadioKeyDown,
} from '../../choiceRadioNav'

const COMPANION_STATE_PREVIEW_GROUP_ID = 'settings-chat-companion-state-preview'

const MOTION_LABEL_KEYS: Record<CompanionActivityMotion, TranslationKey> = {
  breathe: 'settings.chat.companion_state_preview.motion.breathe',
  think: 'settings.chat.companion_state_preview.motion.think',
  listen: 'settings.chat.companion_state_preview.motion.listen',
  speak: 'settings.chat.companion_state_preview.motion.speak',
  wait: 'settings.chat.companion_state_preview.motion.wait',
  error: 'settings.chat.companion_state_preview.motion.error',
  offline: 'settings.chat.companion_state_preview.motion.offline',
}

const DEFAULT_PREVIEW_STATE = resolveCompanionActivityPreviewState('idle')
const PREVIEW_ROWS = COMPANION_ACTIVITY_PHASES.map((phase) => ({
  phase,
  state: phase === 'idle' ? DEFAULT_PREVIEW_STATE : resolveCompanionActivityPreviewState(phase),
}))

type CompanionStatePreviewProps = {
  petModel: PetModelDefinition | undefined
  spritePetLabel: string
  ti: (key: TranslationKey, params?: TranslationParams) => string
}

export function CompanionStatePreview({
  petModel,
  spritePetLabel,
  ti,
}: CompanionStatePreviewProps) {
  const [previewPhase, setPreviewPhase] = useState<CompanionActivityPhase>('idle')
  const previewState = PREVIEW_ROWS.find((row) => row.phase === previewPhase)?.state ?? DEFAULT_PREVIEW_STATE
  const spritePreviewState = previewState.spriteState ?? 'idle'

  return (
    <div className="settings-mini-group settings-companion-state-preview settings-pet-preview-card">
      <div className="settings-mini-group__head">
        <h5>{ti('settings.chat.companion_state_preview.title')}</h5>
        <span>{ti('settings.chat.companion_state_preview.hint')}</span>
      </div>

      <div className="settings-companion-state-preview__body">
        {petModel?.spriteAtlas ? (
          <div className="settings-sprite-preview__stage settings-companion-state-preview__stage">
            <SpritePetCanvas
              atlas={petModel.spriteAtlas}
              mood={previewState.mood}
              overrideState={spritePreviewState}
              placement="panel-card"
              label={spritePetLabel}
            />
          </div>
        ) : null}

        <div className="settings-companion-state-preview__readout">
          <strong>{ti(previewState.statusKey)}</strong>
          <span>
            {ti('settings.chat.companion_state_preview.motion_label', {
              motion: ti(MOTION_LABEL_KEYS[previewState.motionToken]),
            })}
          </span>
        </div>

        <div
          className="settings-companion-state-preview__states"
          role="radiogroup"
          aria-label={ti('settings.chat.companion_state_preview.title')}
        >
          {PREVIEW_ROWS.map(({ phase, state }) => {
            const selected = phase === previewPhase

            return (
              <button
                id={getChoiceRadioId(COMPANION_STATE_PREVIEW_GROUP_ID, phase)}
                key={phase}
                type="button"
                className={selected ? 'is-active' : ''}
                role="radio"
                aria-checked={selected}
                tabIndex={getChoiceTabIndex(phase, previewPhase, COMPANION_ACTIVITY_PHASES)}
                title={ti(state.statusKey)}
                onClick={() => setPreviewPhase(phase)}
                onKeyDown={(event) =>
                  handleChoiceRadioKeyDown(
                    event,
                    COMPANION_ACTIVITY_PHASES,
                    phase,
                    COMPANION_STATE_PREVIEW_GROUP_ID,
                    setPreviewPhase,
                  )}
              >
                <span>{ti(state.statusKey)}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
