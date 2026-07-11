import { useEffect, useState } from 'react'
import type { TranslationKey, TranslationParams } from '../../../types/i18n'
import { SettingsToggle } from '../../settingsFields'

type PetMotionModeToggleProps = {
  isSpriteAvatar: boolean
  ti: (key: TranslationKey, params?: TranslationParams) => string
}

// Free mode lives in per-pet-window state (pet-prefs.json), not AppSettings, so
// this is a live control rather than a draft field: it reads the current mode
// over IPC and writes through setPetFreeMode (which routes via the locomotion
// controller to persist + reset locomotion, exactly like the right-click menu).
// It also subscribes so the toggle reflects mode changes made from the
// right-click menu while the settings drawer is open.
export function PetMotionModeToggle({ isSpriteAvatar, ti }: PetMotionModeToggleProps) {
  const [freeMode, setFreeMode] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    window.desktopPet?.getPetWindowState?.()
      ?.then((state) => {
        if (active && state) setFreeMode(Boolean(state.freeMode))
      })
      ?.catch(() => undefined)
    const unsubscribe = window.desktopPet?.subscribePetWindowState?.((state) => {
      if (state) setFreeMode(Boolean(state.freeMode))
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  // Free mode only affects sprite pets; Live2D avatars always keep their backdrop.
  if (!isSpriteAvatar) return null

  return (
    <div className="settings-mini-group">
      <div className="settings-control-card settings-chat-advanced-control">
        <SettingsToggle
          label={ti('settings.pet.free_mode')}
          checked={freeMode === true}
          disabled={freeMode === null}
          onChange={(next) => {
            setFreeMode(next)
            window.desktopPet?.setPetFreeMode?.(next)?.catch(() => undefined)
          }}
        />
        <p className="settings-drawer__hint">{ti('settings.pet.free_mode_hint')}</p>
      </div>
    </div>
  )
}
