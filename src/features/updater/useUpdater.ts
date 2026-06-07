import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation.ts'
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
    if (!window.desktopPet?.updaterInstall) return
    await window.desktopPet.updaterInstall()
  }, [])

  return {
    ...state,
    checkForUpdates,
    installAndRestart,
  }
}
