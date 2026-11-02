import { Suspense, lazy, useMemo, type ReactNode } from 'react'
import { ProactiveUnreadBadge } from '../../components/ProactiveUnreadBadge.tsx'
import { resolveCharacterPreset } from '../../features/character/presets.ts'
import { FramelessCompanionSurface } from '../../features/uiV2/FramelessCompanionSurface.tsx'
import { useProactivePresentation } from '../../hooks/useProactivePresentation.ts'
import { useProactiveUnreadCount } from '../../hooks/useProactiveUnreadCount.ts'
import type { UseAppControllerResult } from '../controllers/useAppController.ts'

const LegacyPetView = lazy(() => import('./LegacyPetView'))

type PetViewProps = UseAppControllerResult['petView'] & {
  settingsDrawer: ReactNode
  onboardingGuide: ReactNode
}

export function PetView({
  settings,
  petModel,
  petModelSelectionResolved,
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
  const proactiveUnreadCount = useProactiveUnreadCount()
  useProactivePresentation(chat.presentPetDialogBubble)

  const hasModalOverlay = Boolean(settingsDrawer) || Boolean(onboardingGuide)
  const useCompanionV2 = new URLSearchParams(window.location.search).get('uiV2') !== '0'
    && petModelSelectionResolved
    && !settings.vtsEnabled
    && Boolean(petModel.modelPath)

  return (
    <div className={`desktop-pet-root desktop-pet-root--pet ${useCompanionV2 ? 'nexus-ui-v2' : ''} ${characterPreset.themeClassName} ${hasModalOverlay ? 'desktop-pet-root--pet-modal-open' : ''}`}>
      <div aria-hidden={hasModalOverlay ? true : undefined} inert={hasModalOverlay ? true : undefined}>
        <ProactiveUnreadBadge unreadCount={proactiveUnreadCount} uiLanguage={settings.uiLanguage} />
        {!petModelSelectionResolved ? null : useCompanionV2 ? (
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
              petModelSelectionResolved={petModelSelectionResolved}
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
