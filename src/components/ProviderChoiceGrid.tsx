import { memo } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

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

function getProviderChoiceId(itemId: string) {
  return `provider-choice-${encodeURIComponent(itemId)}`
}

function getProviderChoiceTabIndex(itemId: string, selectedId: string, items: ProviderChoiceItem[]) {
  const tabStopId = items.some((item) => item.id === selectedId)
    ? selectedId
    : items[0]?.id
  return itemId === tabStopId ? 0 : -1
}

function focusProviderChoice(itemId: string) {
  window.requestAnimationFrame(() => {
    document.getElementById(getProviderChoiceId(itemId))?.focus()
  })
}

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

  function handleChoiceKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentId: string) {
    if (!items.length) return

    const currentIndex = Math.max(items.findIndex((item) => item.id === currentId), 0)
    let nextIndex: number | null = null

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (currentIndex + 1) % items.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (currentIndex - 1 + items.length) % items.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = items.length - 1
        break
      default:
        return
    }

    event.preventDefault()
    const nextId = items[nextIndex]?.id
    if (!nextId) return

    onSelect(nextId)
    focusProviderChoice(nextId)
  }

  return (
    <div className={gridClass} role="radiogroup" aria-label={ariaLabel}>
      {items.map((item) => {
        const selected = selectedId === item.id

        return (
          <button
            id={getProviderChoiceId(item.id)}
            key={item.id}
            type="button"
            className={`${cardClass} ${selected ? 'is-active' : ''}`}
            role="radio"
            aria-checked={selected}
            tabIndex={getProviderChoiceTabIndex(item.id, selectedId, items)}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => handleChoiceKeyDown(event, item.id)}
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
