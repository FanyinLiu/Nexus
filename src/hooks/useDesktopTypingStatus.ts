// Settings-side subscription for the typing-hook status. The panel translates
// messageKey; this hook only keeps the latest main-process snapshot.

import { useCallback, useEffect, useState } from 'react'
import {
  readTypingStatus,
  type DesktopTypingStatus,
} from '../features/desktopPresence/typingPresence.ts'

export function useDesktopTypingStatus() {
  const [status, setStatus] = useState<DesktopTypingStatus | null>(null)

  useEffect(() => {
    const api = window.desktopPet
    if (!api?.getDesktopTypingStatus) return
    let cancelled = false
    void api.getDesktopTypingStatus().then((value) => {
      if (!cancelled) setStatus(readTypingStatus(value))
    }).catch(() => {
      // Status is optional. A missing hook leaves the toggle usable.
    })
    const unsubscribe = api.subscribeDesktopTypingStatus?.((value) => {
      setStatus(readTypingStatus(value))
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const openTypingPermission = useCallback(() => {
    const open = window.desktopPet?.openDesktopTypingPermission
    if (!open) return
    // The main process broadcasts a fresh status after the prompt. Applying
    // the invoke result here would race that broadcast with a smaller payload.
    void open().catch(() => {
      // Opening System Settings can fail off macOS. The status subscription
      // still reflects whether the hook is running.
    })
  }, [])

  return { status, openTypingPermission }
}
