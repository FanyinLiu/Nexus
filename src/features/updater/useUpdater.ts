import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { captureDurableUpdateSnapshot } from '../../lib/storage/core.ts'
import {
  applyUpdaterStatus,
  createInitialUpdaterState,
  reduceUpdaterCheckResult,
  reduceUpdaterEvent,
  type UpdaterState,
} from './state.ts'

export function useUpdater(): UpdaterState & {
  checkForUpdates: () => Promise<void>
  installAndRestart: () => Promise<void>
} {
  const { t } = useTranslation()
  const [state, setState] = useState<UpdaterState>(() => createInitialUpdaterState())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Pull initial status (current version + last event) when the hook mounts.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const status = await window.desktopPet?.updaterStatus?.()
        if (cancelled || !status) return
        setState((prev) => applyUpdaterStatus(prev, status))
      } catch {
        // Updater unavailable in some environments — leave default state.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Subscribe to push events from the main process.
  useEffect(() => {
    const unsubscribe = window.desktopPet?.subscribeUpdaterEvent?.((event) => {
      if (!mountedRef.current) return
      setState((prev) => reduceUpdaterEvent(prev, event))
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  const checkForUpdates = useCallback(async () => {
    if (!window.desktopPet?.updaterCheck) return
    setState((prev) => ({ ...prev, busy: true }))
    try {
      const result = await window.desktopPet.updaterCheck()
      if (!mountedRef.current) return
      setState((prev) => reduceUpdaterCheckResult(prev, result, t('updater.error.check_failed')))
      // Push events still win for download progress and completion.
    } catch (error) {
      if (!mountedRef.current) return
      setState((prev) => ({
        ...prev,
        busy: false,
        event: {
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      }))
    }
  }, [t])

  const installAndRestart = useCallback(async () => {
    // Flush this window before IPC. Main repeats the flush across every
    // renderer and aborts install if that still fails. A renderer failure
    // must not block the unsigned macOS release-page path.
    try {
      captureDurableUpdateSnapshot()
    } catch {
      // The main process reports the durable-flush error on the install path.
    }
    if (!window.desktopPet?.updaterInstall) return
    await window.desktopPet.updaterInstall()
  }, [])

  return {
    ...state,
    checkForUpdates,
    installAndRestart,
  }
}
