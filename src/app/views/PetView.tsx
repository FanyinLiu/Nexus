import { Suspense, lazy, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { ProactiveInboxHost } from '../../components/ProactiveInboxHost.tsx'
import { resolveCharacterPreset } from '../../features/character/presets.ts'
import type { ProactiveNoteStageBinding } from '../../features/proactive/proactiveNote.ts'
import { FramelessCompanionSurface } from '../../features/uiV2/FramelessCompanionSurface.tsx'
import { useProactiveInboxOverlay } from '../../hooks/useProactiveInboxOverlay.ts'
import { useProactiveNoteContext } from '../../hooks/useProactiveNoteContext.ts'
import { useProactiveNotebookArrival } from '../../hooks/useProactiveNotebookArrival.ts'
import { useProactiveNotebookNarration } from '../../hooks/useProactiveNotebookNarration.ts'
import { useProactivePresentation } from '../../hooks/useProactivePresentation.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage.ts'
import type { TranslationKey } from '../../types/i18n.ts'
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
  registerInboxOverlayOpen,
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
  useProactivePresentation(chat.presentPetDialogBubble)
  // One controller per pet window, shared by the badge and the context menu.
  const inboxOverlay = useProactiveInboxOverlay({
    settings,
    focusState,
    openConversation: openChatPanelForVoice,
  })
  useEffect(() => {
    registerInboxOverlayOpen(inboxOverlay.open)
    return () => registerInboxOverlayOpen(null)
  }, [inboxOverlay.open, registerInboxOverlayOpen])

  const view = inboxOverlay.view
  // The notebook and its arrival line both need the environment: speech rules
  // while the notebook is open, quiet-hour rules before a new batch speaks.
  const noteContext = useProactiveNoteContext({
    settings,
    focusState,
    active: view.note.state !== 'none' || view.open,
  })
  const unseenIds = useMemo(
    () => view.rows.filter((row) => row.unseen).map((row) => row.id),
    [view.rows],
  )
  const presentPetDialogBubble = chat.presentPetDialogBubble
  const announceNotebookArrival = useCallback((key: TranslationKey) => {
    const content = pickTranslatedUiText(settings.uiLanguage, key).trim()
    if (!content) return
    presentPetDialogBubble({ content }, { autoHideMs: 9_000 })
  }, [presentPetDialogBubble, settings.uiLanguage])
  useProactiveNotebookArrival({
    unseenIds,
    open: view.open,
    context: noteContext,
    focusState,
    settings,
    announce: announceNotebookArrival,
  })
  const narration = useProactiveNotebookNarration({
    open: view.open,
    rows: view.rows,
    openingUnseenIds: view.openingUnseenIds,
    openingText: pickTranslatedUiText(settings.uiLanguage, view.openingKey),
    letterText: pickTranslatedUiText(settings.uiLanguage, 'pet.proactive.notebook_letter'),
    restText: pickTranslatedUiText(settings.uiLanguage, 'pet.proactive.notebook_rest'),
    settings,
    context: noteContext,
    speak: (text) => voice.speakAssistantReply(text, false),
    stop: voice.speechStop.interrupt,
    setSpeakingId: inboxOverlay.setSpeakingId,
  })
  const note: ProactiveNoteStageBinding = {
    view: view.note,
    onToggleNotebook: () => {
      narration.interrupt()
      inboxOverlay.toggle()
    },
  }

  const hasModalOverlay = Boolean(settingsDrawer) || Boolean(onboardingGuide)
  const useCompanionV2 = new URLSearchParams(window.location.search).get('uiV2') !== '0'
    && petModelSelectionResolved
    && !settings.vtsEnabled
    && Boolean(petModel.modelPath)

  return (
    <div className={`desktop-pet-root desktop-pet-root--pet ${useCompanionV2 ? 'nexus-ui-v2' : ''} ${characterPreset.themeClassName} ${hasModalOverlay ? 'desktop-pet-root--pet-modal-open' : ''}`}>
      <div aria-hidden={hasModalOverlay ? true : undefined} inert={hasModalOverlay ? true : undefined}>
        <ProactiveInboxHost
          settings={settings}
          view={inboxOverlay.view}
          onClose={() => {
            narration.interrupt()
            inboxOverlay.close()
          }}
          onToggleRow={inboxOverlay.toggleRow}
          onAction={inboxOverlay.runAction}
          onSeen={inboxOverlay.markSeen}
          onInteract={narration.interrupt}
        />
        {!petModelSelectionResolved ? null : useCompanionV2 ? (
          <FramelessCompanionSurface
            settings={settings}
            petModel={petModel}
            pet={pet}
            voice={voice}
            chat={chat}
            note={note}
            isPinned={isPinned}
            clickThrough={clickThrough}
            runtimeSnapshot={runtimeSnapshot}
            openSettingsPanel={openSettingsPanel}
            openChatPanelForVoice={openChatPanelForVoice}
            openPetMenu={openPetMenu}
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
