import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation.ts'
import type { UpdaterEvent } from './types'

type UpdaterState = {
  /** Latest event seen from the main process. */
  event: UpdaterEvent
  /** True while a manual check or download is in progress. */
  busy: boolean
  /** Current installed version, populated on mount via updaterStatus(). */
  currentVersion: string | null
  /** True only when running in a packaged build (auto-update is a no-op in dev). */
  isPackaged: boolean
}

export function useUpdater(): UpdaterState & {
  checkForUpdates: () => Promise<void>
  installAndRestart: () => Promise<void>
} {
  const { t } = useTranslation()
  const [state, setState] = useState<UpdaterState>({
    event: { type: 'idle' },
    busy: false,
    currentVersion: null,
    isPackaged: false,
  })
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
        setState((prev) => ({
          ...prev,
          currentVersion: status.currentVersion,
          isPackaged: status.isPackaged,
          event: status.last ?? prev.event,
        }))
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
      setState((prev) => ({
        ...prev,
        event,
        busy: event.type === 'checking' || event.type === 'progress',
      }))
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
      if (!result.ok) {
        setState((prev) => ({
          ...prev,
          busy: false,
          event: { type: 'error', message: result.reason ?? t('updater.error.check_failed') },
        }))
      } else if (!result.latestVersion || result.latestVersion === result.currentVersion) {
        setState((prev) => ({
          ...prev,
          busy: false,
          event: { type: 'not-available', version: result.currentVersion },
        }))
      }
      // 'available' / 'progress' / 'downloaded' will arrive via subscription.
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
