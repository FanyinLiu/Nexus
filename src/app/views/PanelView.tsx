import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import { CrisisHotlinePanel } from '../../features/safety'
import { modelSupportsVision } from '../../lib/modelCapabilities'
import { CompanionPanelV2 } from '../../features/uiV2/CompanionPanelV2'
import type { UseAppControllerResult } from '../controllers/useAppController'

const LegacyPanelView = lazy(() => import('./LegacyPanelView'))

type PanelViewProps = UseAppControllerResult['panelView'] & {
  settingsDrawer: ReactNode
  onboardingGuide: ReactNode
  modelSetupOverlayOpen: boolean
  replyToTelegram?: (text: string, conversationId?: number | string, messageId?: number | string) => Promise<boolean> | boolean
  replyToDiscord?: (text: string, conversationId?: string, messageId?: string) => Promise<boolean> | boolean
}

export function PanelView({
  settings,
  petModel,
  pet,
  voice,
  chat,
  memory,
  autonomyState,
  focusState,
  contextScheduler,
  runtimeSnapshot,
  petRuntimeContinuousVoiceActive,
  notificationBridge,
  panelCollapsed,
  openSettingsPanel,
  openSettingsSection,
  togglePanelCollapse,
  closePanel,
  settingsDrawer,
  onboardingGuide,
  modelSetupOverlayOpen,
  replyToTelegram,
  replyToDiscord,
}: PanelViewProps) {
  const visionEnabled = modelSupportsVision(settings.model)
  const { pendingImage, setPendingImage } = chat

  useEffect(() => {
    if (!visionEnabled && pendingImage) {
      setPendingImage(null)
    }
  }, [visionEnabled, pendingImage, setPendingImage])

  const useCompanionV2 = new URLSearchParams(window.location.search).get('uiV2') !== '0'
    && (settings.vtsEnabled || Boolean(petModel.spriteAtlas) || Boolean(petModel.modelPath))

  if (useCompanionV2) {
    return (
      <CompanionPanelV2
        settings={settings}
        petModel={petModel}
        pet={pet}
        voice={voice}
        chat={chat}
        runtimeSnapshot={runtimeSnapshot}
        panelCollapsed={panelCollapsed}
        openSettingsPanel={openSettingsPanel}
        togglePanelCollapse={togglePanelCollapse}
        closePanel={closePanel}
        settingsDrawer={settingsDrawer}
        onboardingGuide={onboardingGuide}
        modelSetupOverlayOpen={modelSetupOverlayOpen}
        safetyLayer={<CrisisHotlinePanel locale={settings.uiLanguage} />}
      />
    )
  }

  return (
    <Suspense fallback={null}>
      <LegacyPanelView
        settings={settings}
        petModel={petModel}
        pet={pet}
        voice={voice}
        chat={chat}
        memory={memory}
        autonomyState={autonomyState}
        focusState={focusState}
        contextScheduler={contextScheduler}
        runtimeSnapshot={runtimeSnapshot}
        petRuntimeContinuousVoiceActive={petRuntimeContinuousVoiceActive}
        notificationBridge={notificationBridge}
        panelCollapsed={panelCollapsed}
        openSettingsPanel={openSettingsPanel}
        openSettingsSection={openSettingsSection}
        togglePanelCollapse={togglePanelCollapse}
        closePanel={closePanel}
        settingsDrawer={settingsDrawer}
        onboardingGuide={onboardingGuide}
        modelSetupOverlayOpen={modelSetupOverlayOpen}
        replyToTelegram={replyToTelegram}
        replyToDiscord={replyToDiscord}
      />
    </Suspense>
  )
}
