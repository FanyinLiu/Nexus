import { useEffect, useRef } from 'react'
import type { AppSettings } from '../types'

type UseGameIntegrationParams = {
  settingsRef: React.RefObject<AppSettings>
}

export function useGameIntegration({ settingsRef }: UseGameIntegrationParams) {
  const mcConnectedRef = useRef(false)
  const fcConnectedRef = useRef(false)

  useEffect(() => {
    const settings = settingsRef.current

    if (settings.minecraftIntegrationEnabled
      && settings.minecraftServerAddress
      && settings.minecraftServerPort
      && settings.minecraftUsername
      && !mcConnectedRef.current
    ) {
      mcConnectedRef.current = true
      window.desktopPet?.minecraftConnect({
        address: settings.minecraftServerAddress,
        port: settings.minecraftServerPort,
        username: settings.minecraftUsername,
      }).catch((err) => {
        console.warn('[game-integration] minecraft auto-connect failed:', err.message ?? err)
        mcConnectedRef.current = false
      })
    } else if (!settings.minecraftIntegrationEnabled && mcConnectedRef.current) {
      mcConnectedRef.current = false
      window.desktopPet?.minecraftDisconnect?.().catch(() => {})
    }

    if (settings.factorioIntegrationEnabled
      && settings.factorioServerAddress
      && settings.factorioServerPort
      && !fcConnectedRef.current
    ) {
      fcConnectedRef.current = true
      window.desktopPet?.factorioConnect({
        address: settings.factorioServerAddress,
        port: settings.factorioServerPort,
        password: '',
      }).catch((err) => {
        console.warn('[game-integration] factorio auto-connect failed:', err.message ?? err)
        fcConnectedRef.current = false
      })
    } else if (!settings.factorioIntegrationEnabled && fcConnectedRef.current) {
      fcConnectedRef.current = false
      window.desktopPet?.factorioDisconnect?.().catch(() => {})
    }
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
