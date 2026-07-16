import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PetControlIcon } from '../../components/PetControlIcon'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type {
  AppSettings,
  AssistantRuntimeActivity,
  ChatMessage,
  PetMood,
  PetTouchZone,
  RuntimeStateSnapshot,
  SpeechLevelSource,
  VoiceState,
} from '../../types'
import type { GazeTarget } from '../pet/components/live2d/types'
import type { PetModelDefinition } from '../pet/models'
import { SpritePetCanvas } from '../pet/components/SpritePetCanvas'
import { ChatSheetV2, type ChatSheetV2Message } from './ChatSheetV2'
import { useReadableCaption } from './caption'
import { buildMotionSafeModelDefinition } from './motionSafeModel'
import {
  resolveCompanionSurfaceBasePhase,
  resolveCompanionSurfaceCaption,
  useCompanionSurfacePhase,
} from './state'
import './companion-v2.css'
import './panel-v2.css'

const Live2DCanvas = lazy(async () => {
  const module = await import('../pet/components/Live2DCanvas')
  return { default: module.Live2DCanvas }
})

export type CompanionPanelV2Props = {
  settings: AppSettings
  petModel: PetModelDefinition
  pet: {
    mood: PetMood
    petTapActive: boolean
    petTouchZone: PetTouchZone | null
    gazeTarget: GazeTarget
  }
  voice: {
    voiceState: VoiceState
    speechLevelSource: SpeechLevelSource
    toggleVoiceConversation: () => void
    stopVoiceConversation: () => void
  }
  chat: {
    messages: ChatMessage[]
    input: string
    busy: boolean
    error: string | null
    assistantActivity: AssistantRuntimeActivity
    setInput: (value: string) => void
    sendMessage: () => Promise<unknown>
    cancelActiveTurn: () => void
  }
  runtimeSnapshot: RuntimeStateSnapshot
  panelCollapsed: boolean
  openSettingsPanel: () => void
  togglePanelCollapse: () => void
  closePanel: () => void
  settingsDrawer: ReactNode
  onboardingGuide: ReactNode
  modelSetupOverlayOpen: boolean
  safetyLayer?: ReactNode
}

function toChatSheetMessages(
  messages: ChatMessage[],
): ChatSheetV2Message[] {
  return messages.flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return []
    if (typeof message.content !== 'string' || !message.content.trim()) return []
    return [{ id: message.id, role: message.role, content: message.content }]
  })
}

export function CompanionPanelV2({
  settings,
  petModel,
  pet,
  voice,
  chat,
  runtimeSnapshot,
  panelCollapsed,
  openSettingsPanel,
  togglePanelCollapse,
  closePanel,
  settingsDrawer,
  onboardingGuide,
  modelSetupOverlayOpen,
  safetyLayer,
}: CompanionPanelV2Props) {
  const [utilityOpen, setUtilityOpen] = useState(false)
  const [chatSheetOpen, setChatSheetOpen] = useState(false)
  const [captionPaused, setCaptionPaused] = useState(false)
  const hasModalOverlay = Boolean(settingsDrawer) || Boolean(onboardingGuide) || modelSetupOverlayOpen
  const utilityButtonRef = useRef<HTMLButtonElement>(null)
  const captionButtonRef = useRef<HTMLButtonElement>(null)
  const chatReturnTargetRef = useRef<HTMLElement | null>(null)
  const utilityMenuRef = useRef<HTMLDivElement>(null)
  const previewPhase = new URLSearchParams(window.location.search).get('uiV2State')
  const phaseOverride = previewPhase === 'idle'
    || previewPhase === 'listening'
    || previewPhase === 'thinking'
    || previewPhase === 'speaking'
    || previewPhase === 'done'
    || previewPhase === 'error'
    || previewPhase === 'offline'
    ? previewPhase
    : undefined
  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(settings.uiLanguage, key, params)

  const basePhase = resolveCompanionSurfaceBasePhase({
    voiceState: voice.voiceState,
    assistantActivity: chat.assistantActivity,
    chatBusy: chat.busy,
    chatError: chat.error,
    wakewordError: runtimeSnapshot.wakewordError,
    presencePhase: runtimeSnapshot.companionPresence?.phase,
  })
  const phase = useCompanionSurfacePhase(basePhase, { phaseOverride })
  const motionSafeModel = useMemo(
    () => buildMotionSafeModelDefinition(petModel),
    [petModel],
  )
  const messages = useMemo(() => toChatSheetMessages(chat.messages), [chat.messages])
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant')
  const resolvedCaption = resolveCompanionSurfaceCaption({
    phase,
    assistantReply: latestAssistantMessage?.content,
    chatError: chat.error,
    wakewordError: runtimeSnapshot.wakewordError,
    errorRecovery: ti('ui_v2.error_recovery'),
    offlineRecovery: ti('ui_v2.offline_recovery'),
  })
  const nextCaption = resolvedCaption ?? (phaseOverride === 'speaking'
    ? ti('panel.status.speaking')
    : undefined)
  const latestCaption = useReadableCaption(nextCaption, phase, captionPaused)
  const openChatSheet = (trigger?: HTMLButtonElement | null) => {
    chatReturnTargetRef.current = trigger ?? document.activeElement as HTMLElement | null
    setChatSheetOpen(true)
  }
  const closeChatSheet = () => {
    setChatSheetOpen(false)
    requestAnimationFrame(() => {
      const target = chatReturnTargetRef.current
      if (target?.isConnected) target.focus()
      else utilityButtonRef.current?.focus()
      chatReturnTargetRef.current = null
    })
  }

  useEffect(() => {
    if (!utilityOpen) return undefined
    utilityMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const closeMenu = () => {
      setUtilityOpen(false)
      requestAnimationFrame(() => utilityButtonRef.current?.focus())
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (utilityMenuRef.current?.contains(event.target as Node) || utilityButtonRef.current?.contains(event.target as Node)) return
      closeMenu()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeMenu()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [utilityOpen])

  useEffect(() => {
    let frameId: number | null = null
    const applyIntent = ({ intent }: { intent?: 'text' | 'recent' | null }) => {
      if (intent !== 'text' && intent !== 'recent') return
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        chatReturnTargetRef.current = utilityButtonRef.current
        setChatSheetOpen(true)
      })
    }
    const unsubscribe = window.desktopPet?.subscribePanelSection?.(applyIntent)
    void window.desktopPet?.getPanelSection?.().then(applyIntent).catch(() => undefined)
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      unsubscribe?.()
    }
  }, [])

  const stage = (
    <div
      className="nexus-panel-v2__stage"
      aria-label={`${settings.companionName} Live2D`}
      aria-hidden={chatSheetOpen ? true : undefined}
      inert={chatSheetOpen ? true : undefined}
    >
      <div className="nexus-panel-v2__live2d">
        {settings.vtsEnabled ? (
          <span className="nexus-v2-sr-only">VTube Studio</span>
        ) : petModel.spriteAtlas ? (
          <SpritePetCanvas
            atlas={petModel.spriteAtlas}
            mood={pet.mood}
            touchZone={pet.petTapActive ? pet.petTouchZone : null}
            isListening={phase === 'listening'}
            isSpeaking={phase === 'speaking'}
            isBusy={phase === 'thinking'}
            speechLevelSource={voice.speechLevelSource}
            gazeTarget={pet.gazeTarget}
            performanceCue={null}
            placement="pet-stage"
            label={settings.companionName}
          />
        ) : <Suspense fallback={null}>
          <Live2DCanvas
            modelDefinition={motionSafeModel}
            mood={pet.mood}
            touchZone={pet.petTapActive ? pet.petTouchZone : null}
            isListening={phase === 'listening'}
            isSpeaking={phase === 'speaking'}
            speechLevelSource={voice.speechLevelSource}
            gazeTarget={pet.gazeTarget}
            performanceCue={null}
            placement="pet-stage"
            paused={panelCollapsed || hasModalOverlay}
          />
        </Suspense>}
      </div>
      {!chatSheetOpen && latestCaption ? (
        <button
          ref={captionButtonRef}
          type="button"
          className="nexus-panel-v2__caption"
          onClick={() => openChatSheet(captionButtonRef.current)}
          onPointerEnter={() => setCaptionPaused(true)}
          onPointerLeave={() => setCaptionPaused(false)}
          onFocus={() => setCaptionPaused(true)}
          onBlur={() => setCaptionPaused(false)}
          aria-label={ti('ui_v2.chat.open_reply', { reply: latestCaption })}
        >
          <span>{latestCaption}</span>
          <PetControlIcon name="expand" />
        </button>
      ) : null}
    </div>
  )

  return (
    <div
      className={`nexus-panel-v2${panelCollapsed ? ' nexus-panel-v2--collapsed' : ''}`}
      data-phase={phase}
      data-utility-open={utilityOpen ? 'true' : 'false'}
    >
      <div
        className={`nexus-panel-v2__experience${panelCollapsed ? ' nexus-panel-v2__experience--collapsed' : ''}`}
        aria-hidden={hasModalOverlay ? true : undefined}
        inert={hasModalOverlay ? true : undefined}
      >
        {stage}
        {!panelCollapsed && !chatSheetOpen ? <div className="nexus-panel-v2__chrome">
          <button
            ref={utilityButtonRef}
            type="button"
            className="nexus-panel-v2__utility"
            data-settings-opener="true"
            aria-label={ti('ui_v2.more')}
            aria-expanded={utilityOpen}
            aria-controls="nexus-panel-v2-utility-menu"
            onClick={() => setUtilityOpen((open) => !open)}
          >
            <PetControlIcon name="menu" />
          </button>
          {utilityOpen ? (
            <div
              ref={utilityMenuRef}
              id="nexus-panel-v2-utility-menu"
              className="nexus-panel-v2__menu"
              role="group"
              aria-label={ti('ui_v2.more')}
            >
              <button type="button" onClick={() => { setUtilityOpen(false); openChatSheet(utilityButtonRef.current) }}>
                <PetControlIcon name="chat" /><span>{ti('ui_v2.text_input')}</span>
              </button>
              <button type="button" onClick={() => { setUtilityOpen(false); openSettingsPanel() }}>
                <PetControlIcon name="settings" /><span>{ti('settings.title')}</span>
              </button>
              <button type="button" onClick={togglePanelCollapse}>
                <PetControlIcon name="collapse" /><span>{ti('ui_v2.collapse')}</span>
              </button>
              <button type="button" className="is-danger" onClick={closePanel}>
                <PetControlIcon name="close" /><span>{ti('common.close')}</span>
              </button>
            </div>
          ) : null}
        </div> : null}

        {!panelCollapsed && chatSheetOpen ? (
        <ChatSheetV2
          messages={messages}
          companionName={settings.companionName}
          inputValue={chat.input}
          labels={{
            title: ti('ui_v2.text_input'),
            backToCompanion: ti('ui_v2.back_to_companion'),
            close: ti('common.close'),
            userName: ti('ui_v2.you'),
            messageList: ti('panel.messages.aria_label'),
            messageInput: ti('ui_v2.message_input'),
            inputPlaceholder: ti('ui_v2.input_placeholder'),
            send: ti('ui_v2.send'),
            emptyHistory: ti('ui_v2.empty_history'),
            emptyGuidance: ti('ui_v2.chat.empty_guidance'),
            starterPrompts: [
              ti('ui_v2.chat.prompt_today'),
              ti('ui_v2.chat.prompt_clarify'),
            ],
            busyStatus: ti('ui_v2.chat.busy', { companionName: settings.companionName }),
            errorTitle: ti('ui_v2.chat.error_title'),
            editRetry: ti('ui_v2.chat.edit_retry'),
            viewNewMessages: ti('ui_v2.chat.view_new_messages'),
            cancel: ti('panel.voice.cancel_reply'),
          }}
          onInputChange={chat.setInput}
          onSend={() => { void chat.sendMessage() }}
          busy={chat.busy}
          error={chat.error}
          onCancel={chat.cancelActiveTurn}
          onClose={closeChatSheet}
        />
        ) : null}

      {!panelCollapsed && !chatSheetOpen ? (
        <span className="nexus-v2-sr-only" role="status" aria-live="polite" aria-atomic="true">
          {phase === 'offline'
            ? ti('pet.status.offline')
            : phase === 'error'
              ? ti('pet.status.error')
              : phase === 'thinking'
                ? ti('pet.status.thinking')
                : phase === 'listening'
                  ? ti('panel.status.listening')
                  : phase === 'speaking'
                    ? ti('panel.status.speaking')
                    : ti('pet.status.ready')}
        </span>
      ) : null}
      </div>
      {panelCollapsed ? (
        <button type="button" onClick={togglePanelCollapse} aria-label={ti('panel.button.expand')} aria-hidden={hasModalOverlay ? true : undefined} inert={hasModalOverlay ? true : undefined}>
          <span className={`nexus-panel-v2__collapsed-dot is-${phase}`} aria-hidden="true" />
          <strong>{settings.companionName}</strong>
          <PetControlIcon name="expand" />
        </button>
      ) : null}
      {!panelCollapsed && safetyLayer ? (
        <div className="nexus-panel-v2__safety-layer" aria-hidden={hasModalOverlay ? true : undefined} inert={hasModalOverlay ? true : undefined}>
          {safetyLayer}
        </div>
      ) : null}
      {settingsDrawer}
      {onboardingGuide}
    </div>
  )
}
