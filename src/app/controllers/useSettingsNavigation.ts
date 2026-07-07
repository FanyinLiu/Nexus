import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { ChatMemoryTraceFocusTarget } from '../../features/memory/traceDetails.ts'
import type { PanelWindowState, WindowView } from '../../types'
import type { SettingsSectionId } from '../../components/settingsDrawerSupport.ts'
import { getWindowView, syncWindowViewToUrl } from '../appSupport.ts'
import {
  getInitialPreferredSettingsSectionId,
  shouldOpenInitialSettingsPanel,
} from './settingsNavigationSupport'

type ApplyPanelWindowState = (partialState: Partial<PanelWindowState>) => Promise<void> | void

interface UseSettingsNavigationOptions {
  applyPanelWindowState: ApplyPanelWindowState
  setView: Dispatch<SetStateAction<WindowView>>
  view: WindowView
}

export function useSettingsNavigation({
  applyPanelWindowState,
  setView,
  view,
}: UseSettingsNavigationOptions) {
  const [settingsOpen, setSettingsOpen] = useState(() => shouldOpenInitialSettingsPanel(view))
  const [preferredSettingsSectionId, setPreferredSettingsSectionId] = useState<SettingsSectionId | null>(
    () => getInitialPreferredSettingsSectionId(),
  )
  const [preferredMemoryFocus, setPreferredMemoryFocus] = useState<ChatMemoryTraceFocusTarget | null>(null)

  useEffect(() => {
    void getWindowView().then((resolved) => {
      if (resolved !== view) setView(resolved)
      if (shouldOpenInitialSettingsPanel(resolved)) {
        setSettingsOpen(true)
        setPreferredSettingsSectionId(getInitialPreferredSettingsSectionId())
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openSettingsFallback = useCallback(() => {
    syncWindowViewToUrl('panel', 'settings')
    void applyPanelWindowState({ collapsed: false })
    setView('panel')
    setSettingsOpen(true)
  }, [applyPanelWindowState, setView])

  const openSettingsSectionFallback = useCallback((sectionId: SettingsSectionId) => {
    syncWindowViewToUrl('panel', 'settings', sectionId)
    void applyPanelWindowState({ collapsed: false })
    setView('panel')
    setSettingsOpen(true)
  }, [applyPanelWindowState, setView])

  const openChatFallback = useCallback(() => {
    setSettingsOpen(false)
    void applyPanelWindowState({ collapsed: false })
    syncWindowViewToUrl('panel', 'chat')
    setView('panel')
  }, [applyPanelWindowState, setView])

  const closePanelFallback = useCallback(() => {
    setSettingsOpen(false)
    syncWindowViewToUrl('pet')
    setView('pet')
  }, [setView])

  const openSettingsPanel = useCallback(() => {
    setPreferredSettingsSectionId(null)
    setPreferredMemoryFocus(null)
    if (view === 'pet') {
      const openPanel = window.desktopPet?.openPanel
      if (openPanel) {
        void openPanel('settings').catch(openSettingsFallback)
        return
      }

      openSettingsFallback()
      return
    }

    openSettingsFallback()
  }, [openSettingsFallback, view])

  const openSettingsSection = useCallback((sectionId: SettingsSectionId, memoryFocus?: ChatMemoryTraceFocusTarget | null) => {
    setPreferredSettingsSectionId(sectionId)
    setPreferredMemoryFocus(sectionId === 'memory' ? memoryFocus ?? null : null)
    if (view === 'pet') {
      const openPanel = window.desktopPet?.openPanel
      if (openPanel) {
        void openPanel('settings').catch(() => openSettingsSectionFallback(sectionId))
        return
      }

      openSettingsSectionFallback(sectionId)
      return
    }

    openSettingsSectionFallback(sectionId)
  }, [openSettingsSectionFallback, view])

  const openChatPanelForVoice = useCallback(() => {
    if (view === 'panel') {
      setSettingsOpen(false)
      return
    }

    const openPanel = window.desktopPet?.openPanel
    if (openPanel) {
      void openPanel('chat').catch(openChatFallback)
      return
    }

    openChatFallback()
  }, [openChatFallback, view])

  return {
    closePanelFallback,
    openChatPanelForVoice,
    openSettingsPanel,
    openSettingsSection,
    preferredMemoryFocus,
    preferredSettingsSectionId,
    setSettingsOpen,
    settingsOpen,
  }
}
