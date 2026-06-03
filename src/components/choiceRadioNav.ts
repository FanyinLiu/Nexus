import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

// Shared keyboard-nav / roving-tabindex helpers for custom radio-group choice
// controls (extracted from ChatSection). Generic over the option-id string
// type; no settings-specific state — reusable by any choice-radio group.

export function getChoiceRadioId(groupId: string, optionId: string) {
  return `${groupId}-${encodeURIComponent(optionId)}`
}

export function getChoiceTabIndex<T extends string>(
  optionId: T,
  selectedId: string | undefined,
  optionIds: readonly T[],
) {
  const tabStopId = selectedId && optionIds.includes(selectedId as T)
    ? selectedId
    : optionIds[0]
  return optionId === tabStopId ? 0 : -1
}

export function focusChoiceRadio(groupId: string, optionId: string) {
  window.requestAnimationFrame(() => {
    document.getElementById(getChoiceRadioId(groupId, optionId))?.focus()
  })
}

// Maps an arrow / Home / End key to the next roving-focus index (with wrap), or
// null for keys to ignore. Shared by radio-group and tab-list keyboard nav so
// the index math lives in one place.
export function getRovingNextIndex(key: string, currentIndex: number, length: number): number | null {
  if (length === 0) return null

  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (currentIndex + 1) % length
    case 'ArrowLeft':
    case 'ArrowUp':
      return (currentIndex - 1 + length) % length
    case 'Home':
      return 0
    case 'End':
      return length - 1
    default:
      return null
  }
}

export function handleChoiceRadioKeyDown<T extends string>(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  optionIds: readonly T[],
  currentId: T,
  groupId: string,
  onSelect: (optionId: T) => void,
) {
  const currentIndex = Math.max(optionIds.indexOf(currentId), 0)
  const nextIndex = getRovingNextIndex(event.key, currentIndex, optionIds.length)
  if (nextIndex === null) return

  event.preventDefault()
  const nextId = optionIds[nextIndex]
  onSelect(nextId)
  focusChoiceRadio(groupId, nextId)
}
