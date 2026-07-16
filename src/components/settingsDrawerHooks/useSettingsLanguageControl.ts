import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ensureLocaleLoaded, isLocaleLoaded } from '../../i18n/index.ts'
import { UI_LANGUAGE_OPTIONS } from '../../lib/index.ts'
import type { AppSettings } from '../../types/index.ts'
import { createLanguageSelectionCoordinator } from '../settingsLanguageSelection.ts'

export type UseSettingsLanguageControlOptions = {
  open: boolean
  language: AppSettings['uiLanguage']
  applyDraftLanguage: (language: AppSettings['uiLanguage']) => void
  onLocaleLoadFailure?: (locale: AppSettings['uiLanguage'], error: unknown) => void
}

export function useSettingsLanguageControl({
  open,
  language,
  applyDraftLanguage,
  onLocaleLoadFailure,
}: UseSettingsLanguageControlOptions) {
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false)
  const [, setLocaleLoadTick] = useState(0)
  const selectedLanguageIndex = Math.max(
    0,
    UI_LANGUAGE_OPTIONS.findIndex((option) => option.value === language),
  )
  const languageMenuId = 'settings-language-menu'
  const languageButtonRef = useRef<HTMLButtonElement | null>(null)
  const languageMenuRef = useRef<HTMLDivElement | null>(null)
  const languageOptionRefs = useRef<Array<HTMLButtonElement | null>>([])
  /** Tracks drawer open without stale closures in async locale loads. */
  const drawerOpenRef = useRef(open)
  /** Latest-wins generation invalidated whenever the drawer closes. */
  const languageLoadGenerationRef = useRef(0)
  const applyDraftLanguageRef = useRef(applyDraftLanguage)
  const onLocaleLoadFailureRef = useRef(onLocaleLoadFailure)
  const languageSelectionRef = useRef<ReturnType<typeof createLanguageSelectionCoordinator<AppSettings['uiLanguage']>> | null>(null)

  useLayoutEffect(() => {
    drawerOpenRef.current = open
    applyDraftLanguageRef.current = applyDraftLanguage
    onLocaleLoadFailureRef.current = onLocaleLoadFailure
  }, [applyDraftLanguage, onLocaleLoadFailure, open])

  // The coordinator is intentionally created once so async selections share one generation.
  if (languageSelectionRef.current === null) {
    // eslint-disable-next-line react-hooks/refs
    languageSelectionRef.current = createLanguageSelectionCoordinator<AppSettings['uiLanguage']>({
      isLocaleLoaded,
      ensureLocaleLoaded,
      applyLanguage: (locale) => {
        applyDraftLanguageRef.current(locale)
      },
      isActive: () => drawerOpenRef.current,
      onLoadFailure: (locale, error) => {
        onLocaleLoadFailureRef.current?.(locale, error)
      },
    })
  }

  function focusLanguageOption(index: number) {
    window.requestAnimationFrame(() => {
      languageOptionRefs.current[index]?.focus()
    })
  }

  function openLanguageMenuAt(index: number) {
    setLanguageMenuOpen(true)
    focusLanguageOption(index)
  }

  function closeLanguageMenuAndRestoreFocus() {
    setLanguageMenuOpen(false)
    window.requestAnimationFrame(() => {
      languageButtonRef.current?.focus()
    })
  }

  function handleLanguageButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      openLanguageMenuAt(selectedLanguageIndex)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      openLanguageMenuAt(UI_LANGUAGE_OPTIONS.length - 1)
    }
  }

  function handleLanguageMenuItemKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusLanguageOption((index + 1) % UI_LANGUAGE_OPTIONS.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusLanguageOption((index - 1 + UI_LANGUAGE_OPTIONS.length) % UI_LANGUAGE_OPTIONS.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusLanguageOption(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusLanguageOption(UI_LANGUAGE_OPTIONS.length - 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeLanguageMenuAndRestoreFocus()
    }
  }

  function handleSelectLanguage(nextLanguage: AppSettings['uiLanguage']) {
    closeLanguageMenuAndRestoreFocus()
    const coordinator = languageSelectionRef.current
    if (!coordinator) return
    void coordinator.selectLanguage(nextLanguage).then(() => {
      languageLoadGenerationRef.current = coordinator.getGeneration()
    })
    languageLoadGenerationRef.current = coordinator.getGeneration()
  }

  useEffect(() => {
    if (!open) {
      languageSelectionRef.current?.invalidate()
      languageLoadGenerationRef.current = languageSelectionRef.current?.getGeneration()
        ?? languageLoadGenerationRef.current + 1
    }
  }, [open])

  useEffect(() => {
    if (!languageMenuOpen) return undefined
    function handlePointerDown(event: MouseEvent) {
      if (!languageMenuRef.current) return
      if (!languageMenuRef.current.contains(event.target as Node)) {
        setLanguageMenuOpen(false)
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closeLanguageMenuAndRestoreFocus()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [languageMenuOpen])

  useEffect(() => {
    if (!open || isLocaleLoaded(language)) return undefined
    let canceled = false
    void ensureLocaleLoaded(language)
      .then(() => {
        if (!canceled) setLocaleLoadTick((tick) => tick + 1)
      })
      .catch((error) => {
        onLocaleLoadFailureRef.current?.(language, error)
      })

    return () => {
      canceled = true
    }
  }, [language, open])

  return {
    languageMenuOpen,
    selectedLanguageIndex,
    languageMenuId,
    languageButtonRef,
    languageMenuRef,
    languageOptionRefs,
    openLanguageMenuAt,
    closeLanguageMenuAndRestoreFocus,
    handleLanguageButtonKeyDown,
    handleLanguageMenuItemKeyDown,
    handleSelectLanguage,
  }
}
