/**
 * Settings home page. Owns the appearance radiogroup's roving tab stop and
 * arrow/Home/End navigation, which only exist while the home page is mounted.
 * Card focus targets stay in the drawer ref map so back navigation can return
 * focus to the matching card.
 */

import { useRef, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from 'react'
import { SETTINGS_APPEARANCE_OPTIONS } from '../settingsDrawerSupport.ts'
import { SettingsHomeView, type SettingsHomeViewProps } from '../SettingsHomeView.tsx'
import type { AppSettings, ThemeId } from '../../types/index.ts'

export type SettingsDrawerHomePageProps = {
  groups: SettingsHomeViewProps['groups']
  presence: SettingsHomeViewProps['presence']
  settingsHomeCardRefs: SettingsHomeViewProps['settingsHomeCardRefs']
  themeId: ThemeId
  ti: SettingsHomeViewProps['ti']
  onOpenHomeAction: SettingsHomeViewProps['onOpenHomeAction']
  onOpenSettingsSection: SettingsHomeViewProps['onOpenSettingsSection']
  onPreviewTheme: (themeId: ThemeId) => void
  setDraft: Dispatch<SetStateAction<AppSettings>>
}

export function SettingsDrawerHomePage({
  groups,
  presence,
  settingsHomeCardRefs,
  themeId,
  ti,
  onOpenHomeAction,
  onOpenSettingsSection,
  onPreviewTheme,
  setDraft,
}: SettingsDrawerHomePageProps) {
  const appearanceOptionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedAppearanceIndex = Math.max(
    0,
    SETTINGS_APPEARANCE_OPTIONS.findIndex((option) => option.id === themeId),
  )

  function focusAppearanceOption(index: number) {
    window.requestAnimationFrame(() => {
      appearanceOptionRefs.current[index]?.focus()
    })
  }

  function selectAppearanceOption(index: number) {
    const option = SETTINGS_APPEARANCE_OPTIONS[index]
    if (!option) return

    setDraft((prev) => ({
      ...prev,
      themeId: option.id,
    }))
    onPreviewTheme(option.id)
  }

  function handleAppearanceOptionKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (index + 1) % SETTINGS_APPEARANCE_OPTIONS.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (index - 1 + SETTINGS_APPEARANCE_OPTIONS.length) % SETTINGS_APPEARANCE_OPTIONS.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = SETTINGS_APPEARANCE_OPTIONS.length - 1
        break
      default:
        return
    }

    event.preventDefault()
    selectAppearanceOption(nextIndex)
    focusAppearanceOption(nextIndex)
  }

  return (
    <SettingsHomeView
      appearanceOptionRefs={appearanceOptionRefs}
      groups={groups}
      presence={presence}
      selectedAppearanceIndex={selectedAppearanceIndex}
      settingsHomeCardRefs={settingsHomeCardRefs}
      ti={ti}
      onAppearanceOptionKeyDown={handleAppearanceOptionKeyDown}
      onOpenHomeAction={onOpenHomeAction}
      onOpenSettingsSection={onOpenSettingsSection}
      onSelectAppearanceOption={selectAppearanceOption}
    />
  )
}
