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

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => !isHiddenFromKeyboard(element))
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
      if (!focusableElements.length) {
        event.preventDefault()
        container.focus()
        return
      }

      const firstFocusable = focusableElements[0]
      const lastFocusable = focusableElements[focusableElements.length - 1]
      const activeElement = document.activeElement
      const focusIsInsideModal = activeElement instanceof Node && container.contains(activeElement)

      if (!focusIsInsideModal) {
        event.preventDefault()
        const targetElement = event.shiftKey ? lastFocusable : firstFocusable
        targetElement.focus()
        return
      }

      if (event.shiftKey && activeElement === firstFocusable) {
        event.preventDefault()
        lastFocusable.focus()
      } else if (!event.shiftKey && activeElement === lastFocusable) {
        event.preventDefault()
        firstFocusable.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [containerRef, enabled])
}
