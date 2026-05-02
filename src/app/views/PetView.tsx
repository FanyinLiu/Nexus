import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { getVoiceStateLabel, pickHoverReaction } from '../appSupport'
import { MusicPopupCard } from '../../components/MusicPopupCard'
import { PetControlIcon } from '../../components/PetControlIcon'
import { PetDialogBubble } from '../../components/PetDialogBubble'
import { PetThoughtBubble } from '../../components/PetThoughtBubble'
import { resolveCharacterPreset } from '../../features/character/presets'
import {
  classifyWeatherCondition,
  getTimeOfDayBand,
  getTimeOfDayBlend,
  PET_TIME_PREVIEW_BANDS,
  SceneBackdrop,
  SunlightTint,
  WeatherAmbient,
} from '../../features/panelScene'
import { useAmbientWeather } from '../../hooks/useAmbientWeather'
import { clamp } from '../../lib'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { PetTouchZone } from '../../types'
import { useVTSBridge } from '../../features/pet/vts/useVTSBridge'
import { resolveExpressionSlot } from '../../features/pet/components/live2d/expressions'
import type { UseAppControllerResult } from '../controllers/useAppController'

const Live2DCanvas = lazy(async () => {
  const module = await import('../../features/pet/components/Live2DCanvas')
  return { default: module.Live2DCanvas }
})

type PetViewProps = UseAppControllerResult['petView'] & {
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
  remotePanelSettingsOpen,
  openSettingsPanel,
  openChatPanelForVoice,
  openPetMenu,
  togglePinned,
  toggleClickThrough,
  toggleContinuousVoiceMode,
  handleMediaSessionControl,
  dismissCurrentMediaSession,
  onboardingGuide,
}: PetViewProps) {
  const interactiveZoneRef = useRef<HTMLDivElement | null>(null)
  const mascotRef = useRef<HTMLDivElement | null>(null)
  const tapTimerRef = useRef<number | null>(null)
  const dragStateRef = useRef<{ x: number; y: number } | null>(null)

  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(settings.uiLanguage, key, params)
  const characterPreset = useMemo(() => resolveCharacterPreset(), [])
  const vtsBridge = useVTSBridge(settings.vtsEnabled, settings.vtsPort)
  const vtsActive = settings.vtsEnabled && vtsBridge.state === 'ready'

  useEffect(() => {
    if (!settings.vtsEnabled) return
    const slot = resolveExpressionSlot(
      pet.mood,
      pet.petTapActive ? pet.petTouchZone : null,
      voice.voiceState === 'listening',
      voice.voiceState === 'speaking',
      pet.petPerformanceCue?.expressionSlot,
    )
    vtsBridge.updateInput({
      expressionSlot: slot,
      speechLevel: voice.speechLevel,
      gazeTarget: pet.gazeTarget,
      isSpeaking: voice.voiceState === 'speaking',
      isListening: voice.voiceState === 'listening',
    })
  }, [
    settings.vtsEnabled, pet.mood, pet.petTapActive, pet.petTouchZone,
    voice.voiceState, voice.speechLevel, pet.gazeTarget, pet.petPerformanceCue,
    vtsBridge,
  ])
  const ambientWeather = useAmbientWeather(
    settings.toolWeatherDefaultLocation,
    settings.ambientWeatherEnabled,
  )
  const weatherCondition = useMemo(
    () => {
      if (settings.petWeatherPreview !== 'auto') return settings.petWeatherPreview
      if (!ambientWeather) return null
      return classifyWeatherCondition(ambientWeather.weatherCode, ambientWeather.windSpeedKmh)
    },
    [ambientWeather, settings.petWeatherPreview],
  )
  const [autoTimeBand, setAutoTimeBand] = useState(() => getTimeOfDayBand())
  const [autoTimeBlend, setAutoTimeBlend] = useState(() => getTimeOfDayBlend())
  useEffect(() => {
    const update = () => {
      setAutoTimeBand(getTimeOfDayBand())
      setAutoTimeBlend(getTimeOfDayBlend())
    }
    // 1-minute cadence so the 2-hour blend windows render smoothly
    // instead of stair-stepping every 5 minutes.
    const intervalId = window.setInterval(update, 60 * 1000)
    return () => window.clearInterval(intervalId)
  }, [])
  const timeBand = settings.petTimePreview !== 'auto'
    ? PET_TIME_PREVIEW_BANDS[settings.petTimePreview]
    : autoTimeBand
  const timeBlend = settings.petTimePreview !== 'auto' ? undefined : autoTimeBlend
  const voiceStateLabel = getVoiceStateLabel(voice.voiceState, ti)
  const petSignalLabel = voice.voiceState !== 'idle'
    ? voiceStateLabel
    : settings.continuousVoiceModeEnabled
      ? ti('pet.chip.standby')
      : ti('pet.chip.voice')
  const activeMediaSessionKey = mediaSession?.sessionKey
    ?? [mediaSession?.sourceAppUserModelId, mediaSession?.title, mediaSession?.artist]
      .filter((value): value is string => Boolean(value))
      .join('|')
  const visibleMediaSession = mediaSession?.hasSession && activeMediaSessionKey !== dismissedMusicSessionKey
    ? mediaSession
    : null
  const shouldShowMusicPopup = Boolean(visibleMediaSession) && !remotePanelSettingsOpen
  const voiceActionDisabled = (
    !voice.continuousVoiceActive
    && voice.voiceState !== 'listening'
    && voice.voiceState !== 'speaking'
    && (chat.busy || voice.voiceState === 'processing')
  )
  const petSignalArmed = settings.continuousVoiceModeEnabled || voice.continuousVoiceActive

  // ── Interrupt detection (was in TalkModeOverlay) ──
  // When voice moves speaking → listening we set `interrupted` true and bump
  // `interruptEpoch`. A second effect arms a 900 ms timer that clears the flag.
  const [interrupted, setInterrupted] = useState(false)
  const [interruptEpoch, setInterruptEpoch] = useState(0)
  const [prevVoiceState, setPrevVoiceState] = useState(voice.voiceState)

  // Store previous voiceState via the React-recommended render-time pattern.
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  if (voice.voiceState !== prevVoiceState) {
    setPrevVoiceState(voice.voiceState)
    if (prevVoiceState === 'speaking' && voice.voiceState === 'listening') {
      setInterrupted(true)
      setInterruptEpoch((epoch) => epoch + 1)
    }
  }

  useEffect(() => {
    if (interruptEpoch === 0) return
    const timerId = window.setTimeout(() => setInterrupted(false), 900)
    return () => window.clearTimeout(timerId)
  }, [interruptEpoch])

  const micDisplayState: 'idle' | 'listening' | 'thinking' | 'speaking' | 'interrupted' =
    voice.voiceState === 'idle' ? 'idle'
    : voice.voiceState === 'listening' && interrupted ? 'interrupted'
    : voice.voiceState === 'listening' ? 'listening'
    : voice.voiceState === 'processing' ? 'thinking'
    : 'speaking'

  const WAVE_SHAPE = [0.6, 0.9, 1.0, 0.9, 0.6]

  const [railExpanded, setRailExpanded] = useState(false)
  const railCollapseTimerRef = useRef<number | null>(null)

  const clearRailTimer = useCallback(() => {
    if (railCollapseTimerRef.current) {
      window.clearTimeout(railCollapseTimerRef.current)
      railCollapseTimerRef.current = null
    }
  }, [])

  const startRailCollapseTimer = useCallback(() => {
    clearRailTimer()
    railCollapseTimerRef.current = window.setTimeout(() => {
      setRailExpanded(false)
    }, 1500)
  }, [clearRailTimer])

  function handleRailToggle() {
    if (railExpanded) {
      setRailExpanded(false)
      clearRailTimer()
    } else {
      setRailExpanded(true)
      startRailCollapseTimer()
    }
  }

  function handleRailEnter() {
    clearRailTimer()
  }

  function handleRailLeave() {
    if (railExpanded) {
      startRailCollapseTimer()
    }
  }

  function updateMascotGaze(clientX: number, clientY: number) {
    const bounds = mascotRef.current?.getBoundingClientRect()
    if (!bounds) {
      return
    }

    const centerX = bounds.left + bounds.width / 2
    const centerY = bounds.top + bounds.height * 0.42
    const nextTarget = {
      x: clamp((clientX - centerX) / (bounds.width * 0.28), -1, 1),
      y: clamp((centerY - clientY) / (bounds.height * 0.24), -1, 1),
    }

    pet.setGazeTarget((current) => (
      Math.abs(current.x - nextTarget.x) < 0.08 && Math.abs(current.y - nextTarget.y) < 0.08
        ? current
        : nextTarget
    ))
  }

  function detectTouchZone(event: ReactPointerEvent<HTMLDivElement>): PetTouchZone {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds) {
      return 'body'
    }

    const relativeX = event.clientX - bounds.left
    const relativeY = event.clientY - bounds.top
    const normalizedX = relativeX / bounds.width

    if (relativeY < bounds.height * 0.34) {
      return 'head'
    }

    if (relativeY < bounds.height * 0.54 && normalizedX > 0.18 && normalizedX < 0.82) {
      return 'face'
    }

    return 'body'
  }

  function handleInteractiveZonePointerLeave() {
    pet.setPetHotspotActive(false)
    pet.setMascotHovered(false)
    pet.setPetTouchZone(null)
    pet.setGazeTarget({ x: 0, y: 0 })
  }

  function handleInteractiveZonePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    updateMascotGaze(event.clientX, event.clientY)
  }

  function handleMascotPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    updateMascotGaze(event.clientX, event.clientY)
    const zone = detectTouchZone(event)
    if (pet.petTouchZone !== zone) {
      pet.setPetTouchZone(zone)
    }

    if (!dragStateRef.current || event.buttons !== 1) {
      return
    }

    const deltaX = event.screenX - dragStateRef.current.x
    const deltaY = event.screenY - dragStateRef.current.y
    if (deltaX || deltaY) {
      void window.desktopPet?.dragBy({ x: deltaX, y: deltaY })
      dragStateRef.current = { x: event.screenX, y: event.screenY }
    }
  }

  function handleMascotPointerUp() {
    dragStateRef.current = null
  }

  function handleMascotPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return
    }

    pet.markPresenceActivity()
    dragStateRef.current = { x: event.screenX, y: event.screenY }
    const touchZone = detectTouchZone(event)

    pet.setPetTapActive(true)
    pet.setPetTouchZone(touchZone)
    pet.updatePetStatus(pickHoverReaction(touchZone, ti))

    if (tapTimerRef.current) {
      window.clearTimeout(tapTimerRef.current)
    }

    tapTimerRef.current = window.setTimeout(() => {
      pet.setPetTapActive(false)
      pet.setPetTouchZone(null)
    }, 280)
  }

  useEffect(() => {
    return () => {
      if (tapTimerRef.current) {
        window.clearTimeout(tapTimerRef.current)
      }
      if (railCollapseTimerRef.current) {
        window.clearTimeout(railCollapseTimerRef.current)
      }
    }
  }, [])

  return (
    <div className={`desktop-pet-root desktop-pet-root--pet ${characterPreset.themeClassName}`}>
      <section className="pet-window">
        <div
          ref={interactiveZoneRef}
          className="pet-window__interactive-zone"
          onPointerEnter={() => {
            pet.setPetHotspotActive(true)
            pet.markPresenceActivity({ dismissAmbient: false })
          }}
          onPointerMove={handleInteractiveZonePointerMove}
          onPointerLeave={handleInteractiveZonePointerLeave}
          onContextMenu={(event) => {
            event.preventDefault()
            openPetMenu()
          }}
        >
          <div className="pet-window__stage-shell">
            <div className="pet-window__stage-backdrop" aria-hidden="true" />
            <SunlightTint timePreview={settings.petTimePreview}>
              <SceneBackdrop location={settings.petSceneLocation} timeBand={timeBand} timeBlend={timeBlend} />
              <WeatherAmbient condition={weatherCondition} />
            </SunlightTint>
            <div className="pet-window__stage-orbit pet-window__stage-orbit--large" aria-hidden="true" />
            <div className="pet-window__stage-orbit pet-window__stage-orbit--small" aria-hidden="true" />

            {/* stage-copy removed to avoid blocking Live2D character */}

            {shouldShowMusicPopup && visibleMediaSession ? (
              <div className="pet-window__music-layer">
                <MusicPopupCard
                  session={visibleMediaSession}
                  busy={musicActionBusy}
                  onControl={handleMediaSessionControl}
                  onDismiss={dismissCurrentMediaSession}
                />
              </div>
            ) : null}

            {chat.petDialogBubble ? (
              <div className="pet-window__dialog-layer">
                <PetDialogBubble
                  bubble={chat.petDialogBubble}
                  assistantName={settings.companionName}
                />
              </div>
            ) : null}

            {chat.petThoughtBubble && !chat.petDialogBubble ? (
              <div className="pet-window__thought-layer">
                <PetThoughtBubble bubble={chat.petThoughtBubble} />
              </div>
            ) : null}

            <div
              className={`pet-window__status-indicator ${
                voice.voiceState !== 'idle' ? 'is-active'
                : chat.busy ? 'is-busy'
                : settings.continuousVoiceModeEnabled ? 'is-armed'
                : ''
              }`}
              title={
                voice.voiceState !== 'idle' ? voiceStateLabel
                : chat.busy ? ti('pet.status.thinking')
                : settings.continuousVoiceModeEnabled ? ti('pet.status.standby')
                : ti('pet.status.ready')
              }
            >
              <span className="pet-window__status-dot" aria-hidden="true" />
            </div>

            <div
              className="pet-window__controls-island"
              onPointerEnter={handleRailEnter}
              onPointerLeave={handleRailLeave}
            >
              {railExpanded ? (
                <div className="pet-window__island-panel">
                  <div className="pet-window__island-grid">
                    <button className="pet-window__island-btn" type="button" onClick={openSettingsPanel} title={ti('pet.button.settings')}>
                      <PetControlIcon name="tuning" className="pet-window__island-btn-icon" />
                    </button>
                    <button className="pet-window__island-btn" type="button" onClick={openChatPanelForVoice} title={ti('pet.button.chat')}>
                      <PetControlIcon name="chat" className="pet-window__island-btn-icon" />
                    </button>
                    <button
                      className={`pet-window__island-btn ${settings.continuousVoiceModeEnabled ? 'is-active' : ''}`}
                      type="button"
                      onClick={toggleContinuousVoiceMode}
                      title={settings.continuousVoiceModeEnabled ? ti('pet.voice.continuous_on') : ti('pet.voice.single')}
                    >
                      <PetControlIcon name={settings.continuousVoiceModeEnabled ? 'continuous' : 'single-shot'} className="pet-window__island-btn-icon" />
                    </button>
                    <button
                      className={`pet-window__island-btn ${isPinned ? 'is-active' : ''}`}
                      type="button"
                      onClick={togglePinned}
                      title={isPinned ? ti('pet.window.pinned') : ti('pet.window.pin')}
                    >
                      <PetControlIcon name="pin" className="pet-window__island-btn-icon" />
                    </button>
                    <button
                      className={`pet-window__island-btn ${clickThrough ? 'is-active' : ''}`}
                      type="button"
                      onClick={toggleClickThrough}
                      title={clickThrough ? ti('pet.window.click_through') : ti('pet.window.interactive')}
                    >
                      <PetControlIcon name="pointer" className="pet-window__island-btn-icon" />
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="pet-window__island-anchors">
                <button
                  className={`pet-window__anchor-btn pet-window__anchor-btn--expand ${railExpanded ? 'is-open' : ''}`}
                  type="button"
                  onClick={handleRailToggle}
                  title={railExpanded ? ti('pet.rail.collapse') : ti('pet.rail.expand')}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="pet-window__anchor-icon">
                    <path fill="currentColor" d="M4 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5Zm10 0a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5ZM4 15a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4Zm10 0a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4Z" />
                  </svg>
                </button>

                <button
                  className={`pet-window__anchor-btn pet-window__anchor-btn--mic ${voice.voiceState !== 'idle' ? 'is-live' : ''} ${chat.busy ? 'is-busy' : ''} ${petSignalArmed && voice.voiceState === 'idle' && !chat.busy ? 'is-armed' : ''} ${micDisplayState !== 'idle' ? `is-${micDisplayState}` : ''}`}
                  type="button"
                  onClick={voice.toggleVoiceConversation}
                  disabled={voiceActionDisabled}
                  title={petSignalLabel}
                  aria-label={voice.voiceState !== 'idle' ? 'Stop voice input' : 'Start voice input'}
                  aria-pressed={voice.voiceState !== 'idle'}
                >
                  {micDisplayState === 'idle' ? (
                    <PetControlIcon name="mic" className="pet-window__anchor-icon" />
                  ) : micDisplayState === 'listening' ? (
                    <div className="mic-btn__pulse-ring" />
                  ) : micDisplayState === 'thinking' ? (
                    <div className="mic-btn__dots">
                      <span className="mic-btn__dot" />
                      <span className="mic-btn__dot" />
                      <span className="mic-btn__dot" />
                    </div>
                  ) : micDisplayState === 'speaking' ? (
                    <div className="mic-btn__bars">
                      {WAVE_SHAPE.map((weight, i) => (
                        <span
                          key={i}
                          className="mic-btn__bar"
                          style={{ '--bar-scale': 0.3 + voice.speechLevel * 0.7 * weight } as React.CSSProperties}
                        />
                      ))}
                    </div>
                  ) : (
                    <span className="mic-btn__interrupted">✋</span>
                  )}
                  <span className="pet-window__anchor-ring" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="pet-window__mascot-frame">
              <div className="pet-window__floor-shadow" aria-hidden="true" />
              <div
                ref={mascotRef}
                className={`pet-window__mascot ${pet.mascotHovered ? 'is-hovered' : ''} ${pet.petTapActive ? 'is-tapped' : ''}`}
                onPointerEnter={() => {
                  pet.setMascotHovered(true)
                  pet.markPresenceActivity({ dismissAmbient: false })
                  pet.updatePetStatus(ti('pet.touch_hint'))
                }}
                onPointerLeave={() => {
                  pet.setMascotHovered(false)
                  handleMascotPointerUp()
                }}
                onPointerDown={handleMascotPointerDown}
                onPointerMove={handleMascotPointerMove}
                onPointerUp={handleMascotPointerUp}
                onDoubleClick={voice.toggleVoiceConversation}
              >
                {vtsActive ? (
                  <div className="pet-window__vts-indicator">
                    VTS: {vtsBridge.modelName || 'Connected'}
                  </div>
                ) : (
                  <Suspense fallback={null}>
                    <Live2DCanvas
                      modelDefinition={petModel}
                      mood={pet.mood}
                      touchZone={pet.petTapActive ? pet.petTouchZone : null}
                      isListening={voice.voiceState === 'listening'}
                      isSpeaking={voice.voiceState === 'speaking'}
                      speechLevel={voice.speechLevel}
                      gazeTarget={pet.gazeTarget}
                      performanceCue={pet.petPerformanceCue}
                      placement="pet-stage"
                    />
                  </Suspense>
                )}
              </div>
            </div>

            {/* dock removed to avoid blocking Live2D character */}
          </div>
        </div>
      </section>
      {onboardingGuide}
    </div>
  )
}
