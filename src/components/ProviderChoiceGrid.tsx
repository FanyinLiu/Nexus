import { memo } from 'react'
import {
  getChoiceRadioId,
  getChoiceTabIndex,
  handleChoiceRadioKeyDown,
} from './choiceRadioNav'

export type ProviderChoiceItem = {
  id: string
  label: string
  meta?: string
}

type ProviderChoiceGridProps = {
  items: ProviderChoiceItem[]
  selectedId: string
  onSelect: (id: string) => void
  ariaLabel: string
  variant?: 'compact' | 'default'
}

const PROVIDER_CHOICE_GROUP_ID = 'provider-choice'

export const ProviderChoiceGrid = memo(function ProviderChoiceGrid({
  items,
  selectedId,
  onSelect,
  ariaLabel,
  variant = 'compact',
}: ProviderChoiceGridProps) {
  const gridClass = variant === 'compact'
    ? 'settings-choice-grid settings-choice-grid--compact'
    : 'settings-choice-grid'
  const cardClass = variant === 'compact'
    ? 'settings-choice-card settings-choice-card--compact'
    : 'settings-choice-card'
  const itemIds = items.map((item) => item.id)

  return (
    <div className={gridClass} role="radiogroup" aria-label={ariaLabel}>
      {items.map((item) => {
        const selected = selectedId === item.id

        return (
          <button
            id={getChoiceRadioId(PROVIDER_CHOICE_GROUP_ID, item.id)}
            key={item.id}
            type="button"
            className={`${cardClass} ${selected ? 'is-active' : ''}`}
            role="radio"
            aria-checked={selected}
            tabIndex={getChoiceTabIndex(item.id, selectedId, itemIds)}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => handleChoiceRadioKeyDown(event, itemIds, item.id, PROVIDER_CHOICE_GROUP_ID, onSelect)}
          >
            <span className="settings-choice-card__header">
              <strong>{item.label}</strong>
            </span>
            {item.meta ? (
              <span className="settings-choice-card__meta">{item.meta}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
})
