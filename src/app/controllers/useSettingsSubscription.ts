import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { initializeSettingsWithVault, subscribeToSettings } from '../store/settingsStore.ts'
import type { AppSettings } from '../../types'

/**
 * Wire the React settings state to the background store:
 *   - On mount, hydrate from the encrypted vault (async; swallows errors so
 *     a missing vault just falls back to the plain-text snapshot).
 *   - Subscribe to settings changes (from save-on-commit or external sync)
 *     and mirror them into the React state.
 */
export function useSettingsSubscription(
  setSettings: Dispatch<SetStateAction<AppSettings>>,
): void {
  useEffect(() => {
    return subscribeToSettings((updated) => {
      setSettings(updated)
    })
    // setSettings from useState is stable; keep deps empty to avoid churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    initializeSettingsWithVault()
      .then((hydrated) => setSettings(hydrated))
      .catch(() => { /* vault unavailable — settings loaded without keys */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
