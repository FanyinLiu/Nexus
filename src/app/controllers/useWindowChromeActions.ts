// Owns the panel/pet window chrome callbacks: collapse, close, pet menu,
// pin/click-through toggles and continuous-voice mode. Callback-only (no
// effects), extracted from useAppController without behavior change.
//
// The pet menu callback waits for the main-process choice and opens the inbox
// overlay only for the Messages row. The overlay controller itself lives in
// PetView (one per pet window); PetView registers its opener here.

import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { createPetMenuOpenHandler } from '../../features/proactive/petMenuOpen.ts'
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
  const inboxOverlayOpenRef = useRef<(() => void) | null>(null)

  const registerInboxOverlayOpen = useCallback((open: (() => void) | null) => {
    inboxOverlayOpenRef.current = open
  }, [])

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
    void createPetMenuOpenHandler({
      openPetMenu: () => window.desktopPet?.openPetMenu?.(),
      openInboxOverlay: () => inboxOverlayOpenRef.current?.(),
    })()
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
    registerInboxOverlayOpen,
    toggleClickThrough,
    toggleContinuousVoiceMode,
    togglePanelCollapse,
    togglePinned,
  }
}
