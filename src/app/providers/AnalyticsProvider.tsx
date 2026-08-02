import { useEffect, useMemo, type ReactNode } from 'react'
import { getAnalyticsConsent, track } from '../../features/analytics'
import type { AnalyticsContextValue } from '../../types/analytics.ts'
import { AnalyticsContext } from './analyticsContext.ts'

type AnalyticsProviderProps = {
  children: ReactNode
}

const disabledTrack: AnalyticsContextValue['track'] = async () => undefined

export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
  const enabled = getAnalyticsConsent()

  useEffect(() => {
    if (!enabled) {
      return
    }

    void track('app.provider_ready', {
      provider: 'analytics',
      enabled,
    })
  }, [enabled])

  const value = useMemo<AnalyticsContextValue>(() => ({
    enabled,
    track: enabled ? track : disabledTrack,
  }), [enabled])

  return (
    <AnalyticsContext.Provider value={value}>
      {children}
    </AnalyticsContext.Provider>
  )
}
