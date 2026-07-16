import { Suspense, lazy, useEffect, useMemo, type ReactNode } from 'react'
import { resolveCharacterPreset } from '../../features/character/presets'
import { FramelessCompanionSurface } from '../../features/uiV2/FramelessCompanionSurface'
import type { UseAppControllerResult } from '../controllers/useAppController'

const LegacyPetView = lazy(() => import('./LegacyPetView'))

type PetViewProps = UseAppControllerResult['petView'] & {
  settingsDrawer: ReactNode
  onboardingGuide: ReactNode
}

export function PetView({
  settings,
  petModel,
  pet,
  voice,
  chat,
  isPinned,
  clickThrough,
  mediaSession,
  musicActionBusy,
  dismissedMusicSessionKey,
  startMediaPolling,
  autonomyState,
  focusState,
  runtimeSnapshot,
  remotePanelSettingsOpen,
  openSettingsPanel,
  openChatPanelForVoice,
  openPetMenu,
  togglePinned,
  toggleClickThrough,
  toggleContinuousVoiceMode,
  notificationUnreadCount,
  handleMediaSessionControl,
  dismissCurrentMediaSession,
  settingsDrawer,
  onboardingGuide,
}: PetViewProps) {
  const characterPreset = useMemo(() => resolveCharacterPreset(), [])
  const roamCapable = !settings.vtsEnabled && Boolean(petModel.spriteAtlas)

  useEffect(() => {
    const pending = window.desktopPet?.updatePetWindowState?.({ roamCapable })
    pending?.catch(() => undefined)
  }, [roamCapable])

  const hasModalOverlay = Boolean(settingsDrawer) || Boolean(onboardingGuide)
  const useCompanionV2 = new URLSearchParams(window.location.search).get('uiV2') !== '0'
    && !settings.vtsEnabled
    && !petModel.spriteAtlas
    && Boolean(petModel.modelPath)

  return (
    <div className={`desktop-pet-root desktop-pet-root--pet ${useCompanionV2 ? 'nexus-ui-v2' : ''} ${characterPreset.themeClassName} ${hasModalOverlay ? 'desktop-pet-root--pet-modal-open' : ''}`}>
      <div aria-hidden={hasModalOverlay ? true : undefined} inert={hasModalOverlay ? true : undefined}>
        {useCompanionV2 ? (
          <FramelessCompanionSurface
            settings={settings}
            petModel={petModel}
            pet={pet}
            voice={voice}
            chat={chat}
            isPinned={isPinned}
            clickThrough={clickThrough}
            runtimeSnapshot={runtimeSnapshot}
            openSettingsPanel={openSettingsPanel}
            openChatPanelForVoice={openChatPanelForVoice}
            togglePinned={togglePinned}
            toggleClickThrough={toggleClickThrough}
            paused={hasModalOverlay}
          />
        ) : (
          <Suspense fallback={null}>
            <LegacyPetView
              settings={settings}
              petModel={petModel}
              pet={pet}
              voice={voice}
              chat={chat}
              isPinned={isPinned}
              clickThrough={clickThrough}
              mediaSession={mediaSession}
              musicActionBusy={musicActionBusy}
              dismissedMusicSessionKey={dismissedMusicSessionKey}
              startMediaPolling={startMediaPolling}
              autonomyState={autonomyState}
              focusState={focusState}
              runtimeSnapshot={runtimeSnapshot}
              remotePanelSettingsOpen={remotePanelSettingsOpen}
              openSettingsPanel={openSettingsPanel}
              openChatPanelForVoice={openChatPanelForVoice}
              openPetMenu={openPetMenu}
              togglePinned={togglePinned}
              toggleClickThrough={toggleClickThrough}
              toggleContinuousVoiceMode={toggleContinuousVoiceMode}
              notificationUnreadCount={notificationUnreadCount}
              handleMediaSessionControl={handleMediaSessionControl}
              dismissCurrentMediaSession={dismissCurrentMediaSession}
              modalOpen={hasModalOverlay}
            />
          </Suspense>
        )}
      </div>
      {settingsDrawer}
      {onboardingGuide}
    </div>
  )
}
