import { useEffect, useState } from 'react'

import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'
import type { MediaPermissionStatusSnapshot } from '../types/permissions.ts'

type MediaPermissionStatusOptions = {
  microphoneEnabled: boolean
  screenContextEnabled: boolean
}

/**
 * Read-only OS media-permission status for the Settings lines.
 *
 * The main process is the only owner of permission state. This hook refreshes
 * on mount, when the relevant switches change, and when the window regains
 * focus (for example after the user returns from System Settings). It never
 * prompts by itself.
 */
export function useMediaPermissionStatus({
  microphoneEnabled,
  screenContextEnabled,
}: MediaPermissionStatusOptions): MediaPermissionStatusSnapshot | null {
  const [status, setStatus] = useState<MediaPermissionStatusSnapshot | null>(null)
  const enabled = microphoneEnabled || screenContextEnabled

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    let cancelled = false
    const load = () => {
      const readStatus = window.desktopPet?.externalActionPolicyGet
      if (!readStatus) return
      void readStatus()
        .then((next) => {
          if (!cancelled && next?.mediaPermissionStatus) setStatus(next.mediaPermissionStatus)
        })
        .catch((error) => {
          console.warn('[permission] status read failed:', getRedactedLogErrorMessage(error))
        })
    }

    load()
    window.addEventListener('focus', load)
    return () => {
      cancelled = true
      window.removeEventListener('focus', load)
    }
  }, [enabled, microphoneEnabled, screenContextEnabled])

  return status
}
