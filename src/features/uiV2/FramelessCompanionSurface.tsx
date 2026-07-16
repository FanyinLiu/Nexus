import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { PetControlIcon, type PetControlIconName } from '../../components/PetControlIcon'
import { clamp, pickTranslatedUiText } from '../../lib'
import type {
  AppSettings,
  AssistantRuntimeActivity,
  PetDialogBubbleState,
  PetMood,
  PetTouchZone,
  RuntimeStateSnapshot,
  SpeechLevelSource,
  VoiceState,
} from '../../types'
import type { PetModelDefinition } from '../pet/models'
import type { GazeTarget } from '../pet/components/live2d/types'
import { useReadableCaption } from './caption'
import { buildMotionSafeModelDefinition } from './motionSafeModel'
import {
  resolveCompanionSurfaceCaption,
  resolveCompanionSurfaceBasePhase,
  useCompanionSurfacePhase,
  type CompanionSurfacePhase,
} from './state'
import './companion-v2.css'

const Live2DCanvas = lazy(async () => {
  const module = await import('../pet/components/Live2DCanvas')
  return { default: module.Live2DCanvas }
})

export type FramelessCompanionSurfaceProps = {
  settings: AppSettings
  petModel: PetModelDefinition
  pet: {
    mood: PetMood
    petTapActive: boolean
    petTouchZone: PetTouchZone | null
    gazeTarget: GazeTarget
    setGazeTarget: (target: GazeTarget) => void
    setPetHotspotActive: (active: boolean) => void
    setMascotHovered: (hovered: boolean) => void
    markPresenceActivity: (options?: { dismissAmbient?: boolean }) => void
    setPetTapActive: (active: boolean) => void
    setPetTouchZone: (zone: PetTouchZone | null) => void
  }
  voice: {
    voiceState: VoiceState
    speechLevelSource: SpeechLevelSource
    continuousVoiceActive: boolean
    toggleVoiceConversation: () => void
    stopVoiceConversation: () => void
  }
  chat: {
    assistantActivity: AssistantRuntimeActivity
    busy: boolean
    error: string | null
    petDialogBubble: PetDialogBubbleState | null
    cancelActiveTurn: () => void
  }
  isPinned: boolean
  clickThrough: boolean
  runtimeSnapshot: RuntimeStateSnapshot
  openSettingsPanel: () => void
  openChatPanelForVoice: (intent?: 'text' | 'recent') => void
  togglePinned: () => void
  toggleClickThrough: () => void
  className?: string
  /** Native close is not currently part of petView; inject it only when wired. */
  onClose?: () => void
  /** Deterministic visual-matrix hook. Production callers should omit it. */
  phaseOverride?: CompanionSurfacePhase
  captionOverride?: string | null
  paused?: boolean
}

type MenuItem = {
  id: string
  icon: PetControlIconName
  label: string
  onSelect: () => void
  pressed?: boolean
  danger?: boolean
}

const LISTENING_LABEL_DELAY_MS = 800
const THINKING_LABEL_DELAY_MS = 1500

function detectTouchZone(event: ReactPointerEvent<HTMLDivElement>): PetTouchZone {
  const bounds = event.currentTarget.getBoundingClientRect()
  const relativeY = event.clientY - bounds.top
  const normalizedX = (event.clientX - bounds.left) / Math.max(bounds.width, 1)

  if (relativeY < bounds.height * 0.34) return 'head'
  if (relativeY < bounds.height * 0.54 && normalizedX > 0.18 && normalizedX < 0.82) {
    return 'face'
  }
  return 'body'
}

export function FramelessCompanionSurface({
  settings,
  petModel,
  pet,
  voice,
  chat,
  isPinned,
  clickThrough,
  runtimeSnapshot,
  openSettingsPanel,
  openChatPanelForVoice,
  togglePinned,
  toggleClickThrough,
  className = '',
  onClose,
  phaseOverride,
  captionOverride,
  paused = false,
}: FramelessCompanionSurfaceProps) {
  const utilityTriggerRef = useRef<HTMLButtonElement | null>(null)
  const utilityMenuRef = useRef<HTMLDivElement | null>(null)
  const characterRef = useRef<HTMLDivElement | null>(null)
  const dragPointRef = useRef<{ x: number; y: number } | null>(null)
  const touchTimeoutRef = useRef<number | null>(null)
  const [utilityOpen, setUtilityOpen] = useState(false)
  const [captionPaused, setCaptionPaused] = useState(false)
  const [revealedStateLabel, setRevealedStateLabel] = useState<'listening' | 'thinking' | null>(null)

  const ti = useCallback((
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(settings.uiLanguage, key, params), [settings.uiLanguage])

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

  useEffect(() => {
    if (phase !== 'listening' && phase !== 'thinking') return undefined

    const delay = phase === 'listening' ? LISTENING_LABEL_DELAY_MS : THINKING_LABEL_DELAY_MS
    let clearId: number | null = null
    const timeoutId = window.setTimeout(() => {
      setRevealedStateLabel(phase)
      if (phase === 'listening') {
        clearId = window.setTimeout(() => setRevealedStateLabel(null), 1200)
      }
    }, delay)
    return () => {
      window.clearTimeout(timeoutId)
      if (clearId !== null) window.clearTimeout(clearId)
    }
  }, [phase])

  const visibleStateLabel = revealedStateLabel === phase ? revealedStateLabel : null

  useEffect(() => {
    if (!utilityOpen) return undefined

    const handlePointerDown = (event: PointerEvent) => {
      if (
        utilityMenuRef.current?.contains(event.target as Node)
        || utilityTriggerRef.current?.contains(event.target as Node)
      ) return
      setUtilityOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setUtilityOpen(false)
      window.requestAnimationFrame(() => utilityTriggerRef.current?.focus())
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [utilityOpen])

  useEffect(() => () => {
    if (touchTimeoutRef.current !== null) window.clearTimeout(touchTimeoutRef.current)
  }, [])

  const nextCaption = captionOverride ?? resolveCompanionSurfaceCaption({
    phase,
    assistantReply: phase === 'error' || phase === 'offline'
      ? undefined
      : chat.petDialogBubble?.content,
    chatError: chat.error,
    wakewordError: runtimeSnapshot.wakewordError,
    errorRecovery: ti('ui_v2.error_recovery'),
    offlineRecovery: ti('ui_v2.offline_recovery'),
  })
  const caption = useReadableCaption(nextCaption, phase, captionPaused)
  const showCaption = Boolean(caption)

  const voiceActionLabel = phase === 'error' || phase === 'offline'
    ? ti('ui_v2.view_settings')
    : phase === 'idle' || phase === 'done'
      ? voice.continuousVoiceActive
        ? ti('panel.voice.stop_continuous')
        : settings.continuousVoiceModeEnabled
          ? ti('panel.voice.start_continuous')
          : ti('panel.voice.start')
      : phase === 'listening'
        ? ti('panel.voice.stop_listening')
        : phase === 'thinking'
          ? ti('panel.voice.cancel_reply')
          : ti('panel.voice.interrupt_response')
  const voiceDisabled = (
    !voice.continuousVoiceActive
    && phase !== 'listening'
    && phase !== 'speaking'
    && phase !== 'thinking'
    && chat.busy
  )

  const selectMenuItem = useCallback((action: () => void) => {
    setUtilityOpen(false)
    action()
  }, [])

  const menuItems: MenuItem[] = [
    {
      id: 'text',
      icon: 'chat',
      label: ti('ui_v2.text_input'),
      onSelect: () => selectMenuItem(() => openChatPanelForVoice('text')),
    },
    {
      id: 'settings',
      icon: 'settings',
      label: ti('pet.button.settings'),
      onSelect: () => selectMenuItem(openSettingsPanel),
    },
    {
      id: 'pin',
      icon: 'pin',
      label: isPinned ? ti('pet.window.pinned') : ti('pet.window.pin'),
      onSelect: () => selectMenuItem(togglePinned),
      pressed: isPinned,
    },
    {
      id: 'pointer',
      icon: 'pointer',
      label: clickThrough ? ti('pet.window.click_through') : ti('ui_v2.ignore_clicks'),
      onSelect: () => selectMenuItem(toggleClickThrough),
      pressed: clickThrough,
    },
  ]
  if (onClose) {
    menuItems.push({
      id: 'close',
      icon: 'close',
      label: ti('common.close'),
      onSelect: () => selectMenuItem(onClose),
      danger: true,
    })
  }

  function updateGaze(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = characterRef.current?.getBoundingClientRect()
    if (!bounds) return
    pet.setGazeTarget({
      x: clamp((event.clientX - (bounds.left + bounds.width / 2)) / (bounds.width * 0.28), -1, 1),
      y: clamp(((bounds.top + bounds.height * 0.42) - event.clientY) / (bounds.height * 0.24), -1, 1),
    })
  }

  function handleCharacterPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    dragPointRef.current = { x: event.screenX, y: event.screenY }
    pet.markPresenceActivity()
    pet.setPetTapActive(true)
    pet.setPetTouchZone(detectTouchZone(event))
    if (touchTimeoutRef.current !== null) window.clearTimeout(touchTimeoutRef.current)
    touchTimeoutRef.current = window.setTimeout(() => {
      pet.setPetTapActive(false)
      pet.setPetTouchZone(null)
    }, 280)
  }

  function handleCharacterPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    updateGaze(event)
    pet.setPetTouchZone(detectTouchZone(event))
    if (!dragPointRef.current || event.buttons !== 1) return
    const delta = {
      x: event.screenX - dragPointRef.current.x,
      y: event.screenY - dragPointRef.current.y,
    }
    if (delta.x || delta.y) {
      void window.desktopPet?.dragBy?.(delta)
      dragPointRef.current = { x: event.screenX, y: event.screenY }
    }
  }

  function releaseCharacterPointer() {
    dragPointRef.current = null
    pet.setPetTouchZone(null)
  }

  function handleInteractivePointerOut(event: ReactPointerEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget
    if (
      nextTarget instanceof Element
      && event.currentTarget.contains(nextTarget)
      && nextTarget.closest('.nexus-v2-interactive')
    ) {
      return
    }
    pet.setPetHotspotActive(false)
  }

  return (
    <section
      className={`nexus-companion-v2 ${className}`.trim()}
      data-phase={phase}
      data-utility-open={utilityOpen ? 'true' : 'false'}
      aria-label={settings.companionName}
      onPointerOverCapture={() => pet.setPetHotspotActive(true)}
      onPointerOutCapture={handleInteractivePointerOut}
    >
      <div
        ref={characterRef}
        className="nexus-companion-v2__character-hit nexus-v2-interactive"
        onPointerEnter={() => {
          pet.setMascotHovered(true)
          pet.markPresenceActivity({ dismissAmbient: false })
        }}
        onPointerLeave={() => {
          pet.setMascotHovered(false)
          pet.setGazeTarget({ x: 0, y: 0 })
          releaseCharacterPointer()
        }}
        onPointerDown={handleCharacterPointerDown}
        onPointerMove={handleCharacterPointerMove}
        onPointerUp={releaseCharacterPointer}
        onPointerCancel={releaseCharacterPointer}
        onDoubleClick={voice.toggleVoiceConversation}
      >
        <Suspense fallback={null}>
          <Live2DCanvas
            modelDefinition={motionSafeModel}
            mood={phase === 'thinking' ? 'thinking' : pet.mood}
            touchZone={pet.petTapActive ? pet.petTouchZone : null}
            isListening={phase === 'listening'}
            isSpeaking={phase === 'speaking'}
            speechLevelSource={voice.speechLevelSource}
            gazeTarget={pet.gazeTarget}
            performanceCue={null}
            placement="pet-stage"
            paused={paused}
          />
        </Suspense>
      </div>

      {showCaption ? (
        <aside
          className="nexus-companion-v2__caption nexus-v2-interactive"
          aria-live="polite"
          aria-atomic="true"
          onPointerEnter={() => setCaptionPaused(true)}
          onPointerLeave={() => setCaptionPaused(false)}
          onFocusCapture={() => setCaptionPaused(true)}
          onBlurCapture={() => setCaptionPaused(false)}
          onPointerUp={() => setCaptionPaused(!document.getSelection()?.isCollapsed)}
        >
          <span>{caption}</span>
          <button
            type="button"
            className="nexus-companion-v2__caption-expand"
            onClick={() => openChatPanelForVoice('recent')}
            aria-label={ti('pet.button.chat')}
          >
            <PetControlIcon name="expand" />
          </button>
        </aside>
      ) : null}

      <button
        ref={utilityTriggerRef}
        type="button"
        className="nexus-companion-v2__utility-trigger nexus-v2-control nexus-v2-interactive"
        data-settings-opener="true"
        aria-label={ti('ui_v2.more')}
        aria-expanded={utilityOpen}
        onClick={() => setUtilityOpen((current) => !current)}
      >
        <PetControlIcon name="menu" />
      </button>

      {utilityOpen ? (
        <div
          ref={utilityMenuRef}
          className="nexus-companion-v2__utility-menu nexus-v2-interactive"
          aria-label={ti('ui_v2.more')}
        >
          {menuItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nexus-companion-v2__utility-item ${item.danger ? 'is-danger' : ''}`.trim()}
              aria-pressed={item.pressed}
              onClick={item.onSelect}
            >
              <PetControlIcon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className={`nexus-companion-v2__voice nexus-v2-control nexus-v2-interactive is-${phase}`}
        onClick={phase === 'error' || phase === 'offline'
          ? openSettingsPanel
          : phase === 'idle' || phase === 'done'
            ? voice.toggleVoiceConversation
            : phase === 'thinking'
              ? chat.cancelActiveTurn
              : voice.stopVoiceConversation}
        disabled={voiceDisabled}
        aria-label={voiceActionLabel}
      >
        {phase === 'listening' ? (
          <PetControlIcon name="mic" />
        ) : phase === 'thinking' ? (
          <PetControlIcon name="close" />
        ) : phase === 'speaking' ? (
          <PetControlIcon name="speaker" />
        ) : phase === 'error' || phase === 'offline' ? (
          <><PetControlIcon name="settings" /><span>{ti('ui_v2.view_settings')}</span></>
        ) : (
          <PetControlIcon name="mic" />
        )}
      </button>

      {visibleStateLabel ? (
        <span className="nexus-companion-v2__state-label" aria-hidden="true">
          {visibleStateLabel === 'listening' ? ti('panel.status.listening') : ti('pet.status.thinking')}
        </span>
      ) : null}
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
    </section>
  )
}
