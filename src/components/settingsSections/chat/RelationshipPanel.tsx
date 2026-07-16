import {
  getChoiceRadioId,
  getChoiceTabIndex,
  handleChoiceRadioKeyDown,
} from '../../choiceRadioNav'
import { RELATIONSHIP_OPTIONS } from '../../../lib/relationshipTypes'
import type { AppSettings, CompanionRelationshipType } from '../../../types'
import type { TranslationKey, TranslationParams } from '../../../types/i18n'

const RELATIONSHIP_RADIO_GROUP_ID = 'settings-chat-relationship'

type RelationshipPanelProps = {
  draft: AppSettings
  ti: (key: TranslationKey, params?: TranslationParams) => string
  onSelectRelationshipType: (value: CompanionRelationshipType) => void
}

export function RelationshipPanel({
  draft,
  ti,
  onSelectRelationshipType,
}: RelationshipPanelProps) {
  const relationshipChoiceIds = RELATIONSHIP_OPTIONS.map((option) => option.value)

  return (
    <div className="settings-mini-group settings-chat-relationship-card">
      <div className="settings-mini-group__head">
        <h5>{ti('settings.chat.relationship_type_label')}</h5>
        <span>{ti('settings.chat.relationship_type_hint')}</span>
      </div>
      <div
        className="settings-relationship__options"
        role="radiogroup"
        aria-label={ti('settings.chat.relationship_type_label')}
      >
        {RELATIONSHIP_OPTIONS.map((opt) => {
          const isActive = draft.companionRelationshipType === opt.value
          return (
            <button
              id={getChoiceRadioId(RELATIONSHIP_RADIO_GROUP_ID, opt.value)}
              key={opt.value}
              type="button"
              className={`settings-relationship__chip${isActive ? ' is-active' : ''}`}
              role="radio"
              aria-checked={isActive}
              tabIndex={getChoiceTabIndex(opt.value, draft.companionRelationshipType, relationshipChoiceIds)}
              onClick={() => onSelectRelationshipType(opt.value)}
              onKeyDown={(event) =>
                handleChoiceRadioKeyDown(
                  event,
                  relationshipChoiceIds,
                  opt.value,
                  RELATIONSHIP_RADIO_GROUP_ID,
                  onSelectRelationshipType,
                )}
            >
              {ti(opt.labelKey)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
