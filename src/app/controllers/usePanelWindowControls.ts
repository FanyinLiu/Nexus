// Owns the panel window state (collapsed flag, pin, click-through) plus the
// IPC-backed writer for it. Extracted from useAppController without behavior
// change.

import { useCallback, useState } from 'react'
import { loadPetWindowPreferences } from '../../lib'
import type { PanelWindowState } from '../../types'

export function usePanelWindowControls() {
  const [panelWindowState, setPanelWindowState] = useState<PanelWindowState>({ collapsed: false })
  const [isPinned, setIsPinned] = useState(() => loadPetWindowPreferences().isPinned)
  const [clickThrough, setClickThrough] = useState(() => loadPetWindowPreferences().clickThrough)

  const applyPanelWindowState = useCallback(async (partialState: Partial<PanelWindowState>) => {
    if (!window.desktopPet?.setPanelWindowState) {
      setPanelWindowState((current) => ({ ...current, ...partialState }))
      return
    }

    try {
      const nextState = await window.desktopPet.setPanelWindowState(partialState)
      setPanelWindowState(nextState)
    } catch {
      setPanelWindowState((current) => ({ ...current, ...partialState }))
    }
  }, [])

  return {
    applyPanelWindowState,
    clickThrough,
    isPinned,
    panelWindowState,
    setClickThrough,
    setIsPinned,
    setPanelWindowState,
  }
}
