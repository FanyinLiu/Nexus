import { memo } from 'react'

export type ProviderChoiceItem = {
  id: string
  label: string
  meta?: string
}

type ProviderChoiceGridProps = {
  items: ProviderChoiceItem[]
  selectedId: string
  onSelect: (id: string) => void
  variant?: 'compact' | 'default'
}

export const ProviderChoiceGrid = memo(function ProviderChoiceGrid({
  items,
  selectedId,
  onSelect,
  variant = 'compact',
}: ProviderChoiceGridProps) {
  const gridClass = variant === 'compact'
    ? 'settings-choice-grid settings-choice-grid--compact'
    : 'settings-choice-grid'
  const cardClass = variant === 'compact'
    ? 'settings-choice-card settings-choice-card--compact'
    : 'settings-choice-card'

  return (
    <div className={gridClass} role="list">
      {items.map((item) => {
        const selected = selectedId === item.id

        return (
          <button
            key={item.id}
            type="button"
            className={`${cardClass} ${selected ? 'is-active' : ''}`}
            aria-pressed={selected}
            onClick={() => onSelect(item.id)}
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
