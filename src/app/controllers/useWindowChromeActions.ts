// Owns the panel/pet window chrome callbacks: collapse, close, pet menu,
// pin/click-through toggles and continuous-voice mode. Callback-only (no
// effects), extracted from useAppController without behavior change.

import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { commitSettingsUpdate } from '../store/commitSettingsUpdate.ts'
import type { AppSettings, PanelWindowState } from '../../types'

type UseWindowChromeActionsOptions = {
  applyPanelWindowState: (partialState: Partial<PanelWindowState>) => Promise<void>
  closePanelFallback: () => void
  panelWindowState: PanelWindowState
  setClickThrough: Dispatch<SetStateAction<boolean>>
  setIsPinned: Dispatch<SetStateAction<boolean>>
  setSettings: Dispatch<SetStateAction<AppSettings>>
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  settingsRef: { current: AppSettings }
}

export function useWindowChromeActions({
  applyPanelWindowState,
  closePanelFallback,
  panelWindowState,
  setClickThrough,
  setIsPinned,
  setSettings,
  setSettingsOpen,
  settingsRef,
}: UseWindowChromeActionsOptions) {
  const panelCollapsed = panelWindowState.collapsed

  const togglePanelCollapse = useCallback(() => {
    const nextCollapsed = !panelCollapsed
    if (nextCollapsed) {
      setSettingsOpen(false)
    }
    void applyPanelWindowState({ collapsed: nextCollapsed })
  }, [applyPanelWindowState, panelCollapsed, setSettingsOpen])

  const closePanel = useCallback(() => {
    const closePanelWindow = window.desktopPet?.closePanel
    if (closePanelWindow) {
      void closePanelWindow().catch(closePanelFallback)
      return
    }

    closePanelFallback()
  }, [closePanelFallback])

  const openPetMenu = useCallback(() => {
    const pending = window.desktopPet?.openPetMenu?.()
    pending?.catch(() => undefined)
  }, [])

  const togglePinned = useCallback(() => {
    setIsPinned((current) => !current)
  }, [setIsPinned])

  const toggleClickThrough = useCallback(() => {
    setClickThrough((current) => !current)
  }, [setClickThrough])

  const toggleContinuousVoiceMode = useCallback(() => {
    void commitSettingsUpdate(
      (current) => ({
        ...current,
        continuousVoiceModeEnabled: !current.continuousVoiceModeEnabled,
      }),
      (nextSettings) => {
        settingsRef.current = nextSettings
        setSettings(nextSettings)
      },
    )
  }, [setSettings, settingsRef])

  return {
    closePanel,
    openPetMenu,
    panelCollapsed,
    toggleClickThrough,
    toggleContinuousVoiceMode,
    togglePanelCollapse,
    togglePinned,
  }
}
