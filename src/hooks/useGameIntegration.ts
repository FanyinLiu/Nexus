import { useEffect, useRef } from 'react'
import { syncGameConnections } from '../features/integrations/gameCompanion.ts'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'
import type { AppSettings } from '../types'

type UseGameIntegrationParams = {
  settingsRef: React.RefObject<AppSettings>
}

export function useGameIntegration({ settingsRef }: UseGameIntegrationParams) {
  const mcConnectedRef = useRef(false)
  const fcConnectedRef = useRef(false)

  useEffect(() => {
    const settings = settingsRef.current
    const next = syncGameConnections({
      settings,
      connected: {
        minecraft: mcConnectedRef.current,
        factorio: fcConnectedRef.current,
      },
      client: window.desktopPet,
      onMinecraftError: (err) => {
        console.warn('[game-integration] minecraft auto-connect failed:', getRedactedLogErrorMessage(err))
        mcConnectedRef.current = false
      },
      onFactorioError: (err) => {
        console.warn('[game-integration] factorio auto-connect failed:', getRedactedLogErrorMessage(err))
        fcConnectedRef.current = false
      },
    })
    mcConnectedRef.current = next.minecraft
    fcConnectedRef.current = next.factorio
  })

  useEffect(() => {
    return () => {
      if (mcConnectedRef.current) {
        window.desktopPet?.minecraftDisconnect?.().catch(() => {})
      }
      if (fcConnectedRef.current) {
        window.desktopPet?.factorioDisconnect?.().catch(() => {})
      }
    }
  }, [])
}
