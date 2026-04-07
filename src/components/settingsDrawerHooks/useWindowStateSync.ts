import { useEffect, useRef, useState } from 'react'
import type { PetWindowState } from '../../types'

export type UseWindowStateSyncOptions = {
  open: boolean
}

export function useWindowStateSync({ open }: UseWindowStateSyncOptions) {
  const [petWindowState, setPetWindowState] = useState<PetWindowState>({
    isPinned: true,
    clickThrough: false,
    petHotspotActive: false,
  })
  const [windowStatusMessage, setWindowStatusMessage] = useState<string | null>(null)
  const windowStateSnapshotRef = useRef<PetWindowState | null>(null)
  const windowStateTouchedRef = useRef(false)

  // Subscribe to pet window state from the desktop shell
  useEffect(() => {
    let alive = true

    const syncState = (state?: PetWindowState) => {
      if (!alive || !state) return
      setPetWindowState(state)
    }

    window.desktopPet?.getPetWindowState?.()
      .then(syncState)
      .catch(() => {})

    const unsubscribe = window.desktopPet?.subscribePetWindowState?.((state: PetWindowState) => {
      syncState(state)
    })

    return () => {
      alive = false
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [])

  // Snapshot on open, clear on close
  useEffect(() => {
    if (!open) {
      windowStateSnapshotRef.current = null
      windowStateTouchedRef.current = false
      return
    }

    if (!windowStateTouchedRef.current) {
      windowStateSnapshotRef.current = petWindowState
    }
  }, [open, petWindowState])

  async function updateWindowState(partial: Partial<PetWindowState>) {
    const nextState = {
      ...petWindowState,
      ...partial,
    }

    windowStateTouchedRef.current = true
    setWindowStatusMessage('正在同步桌面状态…')
    try {
      await window.desktopPet?.updatePetWindowState?.(nextState)
      setPetWindowState(nextState)
      setWindowStatusMessage('桌面行为已同步')
    } catch {
      setWindowStatusMessage('桌面行为同步失败，请重试')
    }
  }

  /** Restore window state to snapshot if user changed it without saving. */
  function rollbackWindowState() {
    const snapshot = windowStateSnapshotRef.current
    const hasPendingWindowChanges = snapshot && (
      snapshot.isPinned !== petWindowState.isPinned
      || snapshot.clickThrough !== petWindowState.clickThrough
      || snapshot.petHotspotActive !== petWindowState.petHotspotActive
    )

    if (hasPendingWindowChanges) {
      void window.desktopPet?.updatePetWindowState?.(snapshot).catch(() => undefined)
    }
  }

  function resetWindowState() {
    setWindowStatusMessage(null)
  }

  return {
    petWindowState,
    windowStatusMessage,
    updateWindowState,
    rollbackWindowState,
    resetWindowState,
  }
}
