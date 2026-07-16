import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  'iframe',
  'object',
  'embed',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function isHiddenFromKeyboard(element: HTMLElement): boolean {
  if (element.tabIndex < 0) return true
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return true

  let current: HTMLElement | null = element
  while (current) {
    const style = window.getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return true
    }
    current = current.parentElement
  }

  return false
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => !isHiddenFromKeyboard(element))
}

/**
 * Pure Tab-boundary decision for a modal focus trap.
 *
 * - `activeIndex` is the index within the focusable list, or `-1` when the
 *   active element is not one of those tab stops.
 * - `focusInsideContainer` is true when focus is inside the modal root
 *   (including non-tabbable programmatically focused nodes such as a
 *   section heading with `tabIndex={-1}`).
 * - Returns which edge control must receive focus after preventDefault, or
 *   `null` to leave the browser's sequential focus navigation alone.
 *
 * Interior Tab (including Cancel → Confirm on a two-button dialog) is
 * intentionally native. Synthetic KeyboardEvents do not move focus the way a
 * real Tab key does; automation that only dispatches keydown will observe a
 * no-op on interior Tab even when this decision is correct.
 */
export function resolveModalTabFocusDecision(options: {
  focusableCount: number
  activeIndex: number
  shiftKey: boolean
  focusInsideContainer: boolean
}): 'container' | 'first' | 'last' | null {
  const { focusableCount, activeIndex, shiftKey, focusInsideContainer } = options

  if (focusableCount <= 0) {
    return 'container'
  }

  if (!focusInsideContainer) {
    return shiftKey ? 'last' : 'first'
  }

  // Focus is inside the modal but not on a tab stop (e.g. tabIndex={-1}
  // section heading). Leave sequential focus navigation alone.
  if (activeIndex < 0 || activeIndex >= focusableCount) {
    return null
  }

  if (shiftKey && activeIndex === 0) {
    return 'last'
  }

  if (!shiftKey && activeIndex === focusableCount - 1) {
    return 'first'
  }

  return null
}

function resolveModalTabFocusTarget(options: {
  focusableElements: readonly HTMLElement[]
  activeElement: Element | null
  shiftKey: boolean
  container: HTMLElement
}): HTMLElement | null {
  const { focusableElements, activeElement, shiftKey, container } = options
  const focusInsideContainer = activeElement instanceof Node && container.contains(activeElement)
  const activeIndex = activeElement instanceof HTMLElement
    ? focusableElements.indexOf(activeElement)
    : -1

  const decision = resolveModalTabFocusDecision({
    focusableCount: focusableElements.length,
    activeIndex,
    shiftKey,
    focusInsideContainer,
  })

  if (decision === 'container') return container
  if (decision === 'first') return focusableElements[0] ?? container
  if (decision === 'last') return focusableElements[focusableElements.length - 1] ?? container
  return null
}

export function useModalFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return undefined

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || event.defaultPrevented) return

      const container = containerRef.current
      if (!container) return

      const focusableElements = getFocusableElements(container)
      const target = resolveModalTabFocusTarget({
        focusableElements,
        activeElement: document.activeElement,
        shiftKey: event.shiftKey,
        container,
      })

      if (!target) return

      event.preventDefault()
      target.focus()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [containerRef, enabled])
}
