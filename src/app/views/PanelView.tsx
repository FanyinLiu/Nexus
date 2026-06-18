import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { getLiveTranscriptLabel, getTimeGreeting, getTimeGreetingEmoji } from '../appSupport'
import { ActivePlanStrip } from '../../components/ActivePlanStrip'
import { MessageBubble } from '../../components/MessageBubble'
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
import { CrisisHotlinePanel, useCrisisPanelState } from '../../features/safety'
import type { CrisisSignal } from '../../features/safety'
import { resolveCompanionPresenceStatus } from '../../features/presence/companionPresenceStatus'
import { buildM1FirstRunConversationGuide } from '../../features/onboarding/firstRunAuditInput'
import { useAmbientWeather } from '../../hooks/useAmbientWeather'
import { shorten } from '../../lib'
import { modelSupportsVision } from '../../lib/modelCapabilities'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import { PetControlIcon, type PetControlIconName } from '../../components/PetControlIcon'
import type { UseAppControllerResult } from '../controllers/useAppController'
import type { NotificationMessage } from '../../types'

// Maximum number of messages rendered at once. Older messages are hidden
// behind a "load earlier" button to keep the DOM lean on long conversations.
const MESSAGE_PAGE_SIZE = 100

type PanelViewProps = UseAppControllerResult['panelView'] & {
  settingsDrawer: ReactNode
  onboardingGuide: ReactNode
  replyToTelegram?: (text: string, conversationId?: number | string, messageId?: number | string) => Promise<boolean> | boolean
  replyToDiscord?: (text: string, conversationId?: string, messageId?: string) => Promise<boolean> | boolean
}

type NotificationReplyTarget = {
  source: 'telegram' | 'discord'
  conversationId?: string
  messageId?: string
  notificationMessageId: string
}

type PanelToolbarButtonProps = {
  icon: PetControlIconName
  label: string
  onClick: () => void
  tone?: 'default' | 'danger'
}

function PanelToolbarButton({ icon, label, onClick, tone = 'default' }: PanelToolbarButtonProps) {
  return (
    <button
      className={`panel-window__icon-button${tone === 'danger' ? ' panel-window__icon-button--danger' : ''}`}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <PetControlIcon name={icon} />
    </button>
  )
}

export function PanelView({
  settings,
  memory,
  pet,
  voice,
  chat,
  runtimeSnapshot,
  petRuntimeContinuousVoiceActive,
  focusState,
  notificationBridge,
  panelCollapsed,
  openSettingsPanel,
  togglePanelCollapse,
  closePanel,
  settingsDrawer,
  onboardingGuide,
  replyToTelegram,
  replyToDiscord,
}: PanelViewProps) {
  const messageListRef = useRef<HTMLDivElement | null>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const lastCrisisSignalRef = useRef<CrisisSignal | null>(null)
  const [showAllMessages, setShowAllMessages] = useState(false)
  const [activeNotificationReply, setActiveNotificationReply] = useState<NotificationReplyTarget | null>(null)
  const crisisSignal = useCrisisPanelState()

  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(settings.uiLanguage, key, params)
  const characterPreset = useMemo(() => resolveCharacterPreset(), [])
  const timeGreeting = getTimeGreeting(ti)
  const timeGreetingEmoji = getTimeGreetingEmoji()
  const visionEnabled = modelSupportsVision(settings.model)

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
    const intervalId = window.setInterval(update, 60 * 1000)
    return () => window.clearInterval(intervalId)
  }, [])
  const timeBand = settings.petTimePreview !== 'auto'
    ? PET_TIME_PREVIEW_BANDS[settings.petTimePreview]
    : autoTimeBand
  const timeBlend = settings.petTimePreview !== 'auto' ? undefined : autoTimeBlend
  const panelSceneLocation = settings.petSceneLocation === 'off' ? 'fields' : settings.petSceneLocation
  const nextSchedulerStatusLabel = runtimeSnapshot.schedulerArmed
    ? runtimeSnapshot.activeTaskLabel
      ? ti('panel.next_task_prefix', { name: runtimeSnapshot.activeTaskLabel })
      : ti('panel.timer_suspended')
    : ''
  const companionPresenceStatus = resolveCompanionPresenceStatus({
    assistantActivity: chat.assistantActivity,
    chatBusy: chat.busy,
    focusState,
    quietHoursEnd: settings.autonomyQuietHoursEnd,
    quietHoursStart: settings.autonomyQuietHoursStart,
    voiceState: voice.voiceState,
  }, ti)
  const companionStatusChipLabel = companionPresenceStatus.chipLabel
  const activeCompanionStatusLabel = companionPresenceStatus.state === 'resting'
    ? ''
    : companionPresenceStatus.statusLabel
  // Pane-session scoping: hide everything the archive already had when
  // useChat mounted. useChat keeps the snapshot at app-root scope so it
  // survives PanelView remounts (earlier attempts at 2b9134c / 8574360
  // re-seeded on every remount and ended up eating freshly appended
  // STT transcripts). Anything append()ed after boot — voice, text,
  // tool result, system notice — has a fresh id and passes through.
  const visibleMessages = chat.messages
  const hiddenMessageCount = Math.max(0, visibleMessages.length - MESSAGE_PAGE_SIZE)
  const loadEarlierLabel = ti('panel.messages.load_earlier', { count: hiddenMessageCount })
  const chatMessageCount = visibleMessages.filter((message) => message.role !== 'system').length
  const welcomeTitle = `${timeGreeting}，${settings.userName}`
  const welcomeBody = memory.memories[0]?.content
    ? ti('panel.greeting.remembered', { memory: shorten(memory.memories[0].content, 24) })
    : ti('panel.greeting.welcome', { companionName: settings.companionName })
  const liveTranscriptLabel = getLiveTranscriptLabel(voice.voiceState, ti)
  const liveStatusLine = voice.liveTranscript
    ? `${liveTranscriptLabel}：${shorten(voice.liveTranscript, 34)}`
    : activeCompanionStatusLabel
      ? activeCompanionStatusLabel
      : nextSchedulerStatusLabel
        ? nextSchedulerStatusLabel
        : companionPresenceStatus.statusLabel || pet.petStatusText
  const panelHeroStatusText = chat.error
    ? ti('panel.audio_smoke_test_hint')
    : activeCompanionStatusLabel
      ? activeCompanionStatusLabel
      : nextSchedulerStatusLabel
        ? nextSchedulerStatusLabel
        : pet.ambientPresence?.text
          ? shorten(pet.ambientPresence.text, 64)
          : companionPresenceStatus.statusLabel || ti(characterPreset.motionLabel)

  const unreadNotifications = useMemo(() => {
    if (!notificationBridge) return []
    return [...notificationBridge.messages]
      .filter((message) => !message.read && !message.snoozedUntil)
      .slice(0, 3)
  }, [notificationBridge])

  const pendingNotificationCount = unreadNotifications.length
  const unreadNotificationCountLabel = ti('panel.notification.unread_count', {
    count: pendingNotificationCount,
  })
  const collapsedUnreadLabel = pendingNotificationCount > 0
    ? `${unreadNotificationCountLabel} · ${ti('panel.notification.compact_label')}`
    : null

  const hasUnreadNotifications = pendingNotificationCount > 0

  function getNotificationSummary(message: NotificationMessage): string {
    const rawSummary = message.summary || message.body || ''
    return shorten(rawSummary || ti('panel.notification.no_preview'), 120)
  }

  function formatNotificationPriority(message: NotificationMessage): string {
    if (message.importance === 'critical' || message.isImportant) return '!!!'
    if (message.importance === 'high') return '!!'
    return ''
  }

  function formatNotificationTime(timestamp: string): string {
    const date = new Date(timestamp)
    if (Number.isNaN(date.valueOf())) return ''
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  async function handleMarkAllRead() {
    await notificationBridge?.markAllRead()
  }

  async function handleClearNotifications() {
    await notificationBridge?.clearMessages()
  }

  function handleMarkNotificationRead(messageId: string) {
    notificationBridge?.markRead(messageId)
  }

  function getNotificationSourceLabel(message: NotificationMessage): string {
    if (message.sender) {
      return `${message.sender} · ${message.sourceName || message.channelName || message.title || message.sourceId || ''}`.trim()
    }
    return message.sourceName || message.channelName || message.title || 'Unknown source'
  }

  function getNotificationReplySource(message: NotificationMessage): 'telegram' | 'discord' | null {
    const raw = (message.sourceId || message.sourceName || '').trim().toLowerCase()
    if (raw === 'telegram') return 'telegram'
    if (raw === 'discord') return 'discord'
    if (raw === 'tg') return 'telegram'
    return null
  }

  function canReplyToNotification(message: NotificationMessage) {
    if (message.kind !== 'message') {
      return false
    }

    const source = getNotificationReplySource(message)
    if (source === 'telegram') {
      return Boolean(replyToTelegram)
    }
    if (source === 'discord') {
      return Boolean(replyToDiscord)
    }
    return false
  }

  async function handleSendNotificationReply(message: NotificationReplyTarget, text: string) {
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }

    const source = message.source
    if (source === 'telegram' && replyToTelegram) {
      // replyTo reports whether the message actually went out (permission
      // gate, missing target and API failures all return false) — only a
      // real send may mark the notification read and clear the composer.
      const sent = await replyToTelegram(trimmed, message.conversationId ?? undefined, message.messageId ?? undefined)
      if (!sent) {
        chat.setError(ti('panel.notification.reply_failed'))
        return
      }
      handleMarkNotificationRead(message.notificationMessageId)
      setActiveNotificationReply(null)
      chat.setInput('')
      return
    }
    if (source === 'discord' && replyToDiscord) {
      const sent = await replyToDiscord(trimmed, message.conversationId ?? undefined, message.messageId ?? undefined)
      if (!sent) {
        chat.setError(ti('panel.notification.reply_failed'))
        return
      }
      handleMarkNotificationRead(message.notificationMessageId)
      setActiveNotificationReply(null)
      chat.setInput('')
      return
    }

    chat.setError(ti('panel.notification.reply_not_supported'))
  }

  function handleReplyToNotification(message: NotificationMessage) {
    const source = getNotificationReplySource(message)
    if (!source) return

    const conversationId = message.conversationId?.trim() || undefined
    const messageId = message.messageId?.trim() || undefined
    setActiveNotificationReply({
      source,
      conversationId,
      messageId,
      notificationMessageId: message.id,
    })

    const sourceName = getNotificationSourceLabel(message)
    const mention = sourceName
      ? `${ti('panel.notification.reply_to', { source: sourceName })}：`
      : ti('panel.notification.reply')
    chat.setInput(`${mention} `)

    window.requestAnimationFrame(() => {
      const composer = composerTextareaRef.current
      if (!composer) {
        return
      }
      composer.focus()
      const cursorPosition = composer.value.length
      composer.setSelectionRange(cursorPosition, cursorPosition)
    })
  }

  function handleCancelNotificationReply() {
    setActiveNotificationReply(null)
  }

  function handleNotificationDraft(message: NotificationMessage) {
    const sourceName = getNotificationSourceLabel(message)
    const summary = getNotificationSummary(message)
    chat.setInput(`${ti('panel.notification.draft_reply', { source: sourceName })}${summary}`)

    window.requestAnimationFrame(() => {
      const composer = composerTextareaRef.current
      if (!composer) {
        return
      }
      composer.focus()
      const cursorPosition = composer.value.length
      composer.setSelectionRange(cursorPosition, cursorPosition)
    })
  }

  function handleMarkImportant(messageId: string) {
    notificationBridge?.markImportant?.(messageId)
  }

  function handleSnoozeNotification(messageId: string, delayMinutes: number) {
    notificationBridge?.snoozeMessage?.(messageId, delayMinutes)
    notificationBridge?.markRead(messageId)
  }

  function isNotificationReplying() {
    return activeNotificationReply !== null
  }

  function getNotificationTitle(message: { sender?: string; channelName: string; title: string }): string {
    if (message.sender) {
      return `${message.sender} · ${message.title}`
    }

    return message.title || message.channelName
  }
  const panelQuickPrompts = useMemo(() => ([
    {
      label: memory.memories[0]?.content
        ? ti('panel.quickstart.continue_label')
        : ti('panel.quickstart.wrap_today_label'),
      prompt: memory.memories[0]?.content
        ? ti('panel.quickstart.continue_prompt', { topic: shorten(memory.memories[0].content, 18) })
        : ti('panel.quickstart.wrap_today_prompt'),
    },
    {
      label: ti('panel.quickstart.desktop_ctx_label'),
      prompt: ti('panel.quickstart.desktop_ctx_prompt'),
    },
    {
      label: ti('panel.quickstart.light_plan_label'),
      prompt: ti('panel.quickstart.light_plan_prompt'),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ti is stable per render via the pickTranslatedUiText call
  ]), [memory.memories, settings.uiLanguage])
  const firstRunConversationGuide = useMemo(
    () => buildM1FirstRunConversationGuide(
      visibleMessages.map(({ createdAt, role, tone }) => ({ createdAt, role, tone })),
    ),
    [visibleMessages],
  )
  const voiceActionLabel = voice.continuousVoiceActive
    ? ti('panel.voice.stop_continuous')
    : petRuntimeContinuousVoiceActive
      ? ti('panel.voice.pet_continuous_active')
      : voice.voiceState === 'speaking'
        ? ti('panel.voice.barge_in')
        : voice.voiceState === 'listening'
          ? ti('panel.voice.stop')
          : settings.continuousVoiceModeEnabled
            ? ti('panel.voice.start_continuous')
            : ti('panel.voice.start')
  const voiceActionDisabled = (
    !petRuntimeContinuousVoiceActive
    && !voice.continuousVoiceActive
    && voice.voiceState !== 'listening'
    && voice.voiceState !== 'speaking'
    && (chat.busy || voice.voiceState === 'processing')
  )
  const sendButtonLabel = chat.busy
    ? ti('panel.composer.send_busy', { companionName: settings.companionName })
    : isNotificationReplying()
      ? ti('panel.notification.send_reply')
      : ti('panel.composer.send_message')
  const notificationReplyHintLabel = activeNotificationReply
    ? ti('panel.notification.replying_to')
    : null
  const composerPlaceholder = ti('panel.composer.placeholder', { companionName: settings.companionName })

  const hasNotificationReply = isNotificationReplying() && Boolean(activeNotificationReply)
  const canSendNotificationReply = hasNotificationReply
    && !chat.busy
    && Boolean(chat.input.trim())
    && !chat.pendingImage

  async function handleComposerSend() {
    if (hasNotificationReply && activeNotificationReply) {
      await handleSendNotificationReply(activeNotificationReply, chat.input)
      return
    }

    await chat.sendMessage()
  }

  function handleApplyQuickPrompt(prompt: string) {
    chat.setInput(prompt)
    window.requestAnimationFrame(() => {
      const composer = composerTextareaRef.current
      if (!composer) {
        return
      }

      composer.focus()
      const cursorPosition = composer.value.length
      composer.setSelectionRange(cursorPosition, cursorPosition)
    })
  }

  function handleFirstRunConversationPrompt() {
    if (!firstRunConversationGuide.promptKey) return
    handleApplyQuickPrompt(ti(firstRunConversationGuide.promptKey))
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) {
      return
    }
    if (event.nativeEvent.isComposing) {
      return
    }

    event.preventDefault()
    void handleComposerSend()
  }

  // ── Image attach helpers ────────────────────────────────────────────────
  // Single image at a time, max 8MB. Larger files or unsupported MIME types
  // surface a chat error so the user understands why nothing happened.
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024
  const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

  function readImageFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error(ti('panel.image.read_failed')))
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result)
        } else {
          reject(new Error(ti('panel.image.read_failed')))
        }
      }
      reader.readAsDataURL(file)
    })
  }

  async function attachImageFromFile(file: File | null | undefined) {
    if (!file) return
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      chat.setError(ti('panel.image.only_supported'))
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      chat.setError(ti('panel.image.too_large'))
      return
    }
    try {
      const dataUrl = await readImageFileAsDataUrl(file)
      chat.setPendingImage(dataUrl)
    } catch (error) {
      chat.setError(error instanceof Error ? error.message : ti('panel.image.read_failed'))
    }
  }

  function handleComposerPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    if (!visionEnabled) return
    const items = event.clipboardData?.items
    if (!items || !items.length) return
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          event.preventDefault()
          void attachImageFromFile(file)
          return
        }
      }
    }
  }

  function handleComposerDragOver(event: ReactDragEvent<HTMLTextAreaElement>) {
    if (!visionEnabled) return
    if (event.dataTransfer?.types?.includes('Files')) {
      event.preventDefault()
    }
  }

  function handleComposerDrop(event: ReactDragEvent<HTMLTextAreaElement>) {
    if (!visionEnabled) return
    const files = event.dataTransfer?.files
    if (!files || !files.length) return
    const file = files[0]
    if (file.type.startsWith('image/')) {
      event.preventDefault()
      void attachImageFromFile(file)
    }
  }

  function handleFilePickerChange(event: ReactChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    void attachImageFromFile(file)
    // Reset so picking the same file twice in a row still fires onChange.
    event.target.value = ''
  }

  function openFilePicker() {
    fileInputRef.current?.click()
  }

  function clearPendingImage() {
    chat.setPendingImage(null)
  }

  // Reset "show all" when the conversation is cleared. Doing this during
  // render (rather than in an effect) avoids a cascading re-render and
  // satisfies react-hooks/set-state-in-effect.
  if (visibleMessages.length === 0 && showAllMessages) {
    setShowAllMessages(false)
  }

  useEffect(() => {
    const crisisBecameVisible = Boolean(crisisSignal && lastCrisisSignalRef.current !== crisisSignal)
    lastCrisisSignalRef.current = crisisSignal

    if (crisisSignal && !crisisBecameVisible) {
      return undefined
    }

    if (visibleMessages.length === 0 && !crisisBecameVisible) {
      return undefined
    }

    const frameId = window.requestAnimationFrame(() => {
      const messageList = messageListRef.current
      if (!messageList) {
        return
      }

      messageList.scrollTo({
        top: crisisBecameVisible ? 0 : messageList.scrollHeight,
        behavior: crisisBecameVisible ? 'auto' : 'smooth',
      })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [crisisSignal, visibleMessages])

  // Destructure stable refs so the deps array doesn't need the parent `chat`
  // object, which would force the effect to re-run on every chat update.
  const { pendingImage, setPendingImage } = chat
  useEffect(() => {
    if (!visionEnabled && pendingImage) {
      setPendingImage(null)
    }
  }, [visionEnabled, pendingImage, setPendingImage])

  const hasModalOverlay = Boolean(settingsDrawer) || Boolean(onboardingGuide)

  return (
    <div className={`desktop-pet-root desktop-pet-root--panel ${characterPreset.themeClassName} ${panelCollapsed ? 'desktop-pet-root--panel-collapsed' : ''} ${hasModalOverlay ? 'desktop-pet-root--panel-modal-open' : ''}`}>
      <div className="panel-scene-layer" aria-hidden="true">
        <SunlightTint timePreview={settings.petTimePreview}>
          <SceneBackdrop location={panelSceneLocation} timeBand={timeBand} timeBlend={timeBlend} />
          <WeatherAmbient condition={weatherCondition} />
        </SunlightTint>
        <div className="panel-scene-layer__veil" />
      </div>
      <section
        className={`panel-window panel-window--simple panel-window--companion ${panelCollapsed ? 'is-collapsed' : ''}`}
        aria-hidden={hasModalOverlay ? true : undefined}
        inert={hasModalOverlay ? true : undefined}
      >
        {panelCollapsed ? (
          <>
            <div className="panel-window__simple-header">
              <div className="panel-window__simple-copy">
                <p className="eyebrow">{ti(characterPreset.heroEyebrow)}</p>
                <strong>{settings.companionName}</strong>
                <p>{panelHeroStatusText}</p>
              </div>

              <div className="panel-window__header-actions panel-window__header-actions--simple">
                <span className={`connection-dot ${runtimeSnapshot.petOnline || runtimeSnapshot.panelOnline ? 'is-online' : ''}`} title={companionStatusChipLabel} />
                <PanelToolbarButton
                  icon="expand"
                  label={ti('panel.button.expand')}
                  onClick={togglePanelCollapse}
                />
                <PanelToolbarButton
                  icon="settings"
                  label={ti('panel.button.settings')}
                  onClick={openSettingsPanel}
                />
                <PanelToolbarButton
                  icon="close"
                  label={ti('panel.button.close')}
                  onClick={closePanel}
                  tone="danger"
                />
              </div>
            </div>

              <div className="panel-window__collapsed-bar">
              <span>{ti('panel.collapsed.session_count', { count: chatMessageCount })}</span>
              <span>{chat.error ? shorten(chat.error, 26) : collapsedUnreadLabel ?? liveStatusLine}</span>
            </div>
          </>
        ) : (
          <div className="panel-window__shell">
            <div className="companion-chat__toolbar">
              <div className="companion-chat__toolbar-left">
                {ambientWeather ? (
                  <span
                    className="ambient-weather-chip"
                    title={ambientWeather.fullSummary || ambientWeather.resolvedName}
                  >
                    <span className="ambient-weather-chip__top">
                      <span className="ambient-weather-chip__condition">
                        {ambientWeather.conditionLabel || ti('panel.weather.fallback_label')}
                      </span>
                      {ambientWeather.temperatureC !== null ? (
                        <span className="ambient-weather-chip__temp">
                          {Math.round(ambientWeather.temperatureC)}°
                        </span>
                      ) : null}
                    </span>
                    <span className="ambient-weather-chip__place">{ambientWeather.resolvedName}</span>
                  </span>
                ) : null}
              </div>
              <div className="panel-window__header-actions panel-window__header-actions--hero">
                <PanelToolbarButton
                  icon="settings"
                  label={ti('panel.button.settings')}
                  onClick={openSettingsPanel}
                />
                <PanelToolbarButton
                  icon="collapse"
                  label={ti('panel.button.collapse')}
                  onClick={togglePanelCollapse}
                />
                <PanelToolbarButton
                  icon="close"
                  label={ti('panel.button.close')}
                  onClick={closePanel}
                  tone="danger"
                />
              </div>
            </div>

            {notificationBridge ? (
              <section className="panel-notification-summary" aria-live="polite">
                <div className="panel-notification-summary__header">
                  <div>
                    <p className="panel-notification-summary__title">
                      {ti('panel.notification.title')}
                    </p>
                    <p className="panel-notification-summary__hint">
                      {hasUnreadNotifications ? unreadNotificationCountLabel : ti('panel.notification.none')}
                    </p>
                  </div>
                  <div className="panel-notification-summary__actions">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={handleMarkAllRead}
                      disabled={!hasUnreadNotifications}
                    >
                      {ti('panel.notification.mark_all_read')}
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={handleClearNotifications}
                      disabled={!notificationBridge.messages.length}
                    >
                      {ti('panel.notification.clear')}
                    </button>
                  </div>
                </div>

                {hasUnreadNotifications ? (
                  <ul className="panel-notification-summary__list">
                    {unreadNotifications.map((message) => (
                      <li key={message.id} className="panel-notification-summary__item">
                        <p className="panel-notification-summary__item-title">
                          <span className="panel-notification-summary__item-priority">{formatNotificationPriority(message)}</span>
                          <strong>{getNotificationTitle(message)}</strong>
                          <small>{formatNotificationTime(message.receivedAt)}</small>
                        </p>
                        <p className="panel-notification-summary__item-body">
                          {getNotificationSummary(message)}
                        </p>
                        <div className="panel-notification-summary__item-actions">
                          <button
                            type="button"
                            className="ghost-button ghost-button--compact"
                            onClick={() => handleNotificationDraft(message)}
                          >
                            {ti('panel.notification.draft_reply')}
                          </button>
                          <button
                            type="button"
                            className="ghost-button ghost-button--compact"
                            onClick={() => handleMarkImportant(message.id)}
                          >
                            {message.isImportant ? ti('panel.notification.unmark_important') : ti('panel.notification.mark_important')}
                          </button>
                          <button
                            type="button"
                            className="ghost-button ghost-button--compact"
                            onClick={() => handleSnoozeNotification(message.id, 10)}
                            title={ti('panel.notification.snooze_10m')}
                          >
                            {ti('panel.notification.snooze_10m')}
                          </button>
                          <button
                            type="button"
                            className="ghost-button ghost-button--compact"
                            onClick={() => handleSnoozeNotification(message.id, 30)}
                            title={ti('panel.notification.snooze_30m')}
                          >
                            {ti('panel.notification.snooze_30m')}
                          </button>
                          {canReplyToNotification(message) ? (
                            <button
                              type="button"
                              className="ghost-button ghost-button--compact"
                              onClick={() => handleReplyToNotification(message)}
                            >
                              {ti('panel.notification.reply')}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="ghost-button ghost-button--compact"
                            onClick={() => handleMarkNotificationRead(message.id)}
                          >
                            {ti('panel.notification.mark_read')}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="panel-notification-summary__empty">{ti('panel.notification.summary_empty')}</p>
                )}
              </section>
            ) : null}

            <ActivePlanStrip />

            <section className="companion-chat">

              <div ref={messageListRef} className="message-list companion-chat__messages" aria-live="polite" aria-label={ti('panel.messages.aria_label')}>
                <CrisisHotlinePanel locale={settings.uiLanguage} />
                {visibleMessages.length ? (
                  <>
                    {!showAllMessages && hiddenMessageCount > 0 && (
                      <div className="message-list__load-earlier">
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => setShowAllMessages(true)}
                          aria-label={loadEarlierLabel}
                          title={loadEarlierLabel}
                        >
                          {loadEarlierLabel}
                        </button>
                      </div>
                    )}
                    {(showAllMessages ? visibleMessages : visibleMessages.slice(-MESSAGE_PAGE_SIZE)).map((message) => (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        assistantName={settings.companionName}
                      />
                    ))}
                  </>
                ) : (
                  <div className="empty-chat empty-chat--nexus">
                    <div className="empty-chat__copy">
                      <strong>
                        <span className="empty-chat__greeting-emoji" aria-hidden="true">
                          {timeGreetingEmoji}
                        </span>
                        {welcomeTitle}
                      </strong>
                      <p>{welcomeBody} <span className="empty-chat__sparkle" aria-hidden="true">✨</span></p>
                      <div className="empty-chat__prompt-grid">
                        {panelQuickPrompts.map((item) => {
                          const quickPromptLabel = `${item.label}: ${item.prompt}`
                          return (
                            <button
                              key={item.label}
                              className="empty-chat__prompt"
                              type="button"
                              onClick={() => handleApplyQuickPrompt(item.prompt)}
                              aria-label={quickPromptLabel}
                              title={quickPromptLabel}
                            >
                              <span>{item.label}</span>
                              <small>{item.prompt}</small>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {chat.error ? (
                <div className="error-banner" role="alert" aria-live="assertive" aria-atomic="true">
                  {chat.error}
                </div>
              ) : null}

              {firstRunConversationGuide.visible && !activeNotificationReply ? (
                <div
                  className={`first-run-conversation-guide first-run-conversation-guide--${firstRunConversationGuide.tone}`}
                  role="status"
                  aria-live="polite"
                >
                  <div>
                    <strong>{ti('panel.first_run.title')}</strong>
                    <p>{ti(firstRunConversationGuide.messageKey)}</p>
                  </div>
                  {firstRunConversationGuide.actionLabelKey && firstRunConversationGuide.promptKey ? (
                    <button
                      type="button"
                      className="ghost-button ghost-button--compact"
                      onClick={handleFirstRunConversationPrompt}
                    >
                      {ti(firstRunConversationGuide.actionLabelKey)}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="composer composer--minimal companion-chat__composer">
                {visionEnabled && chat.pendingImage ? (
                  <div className="composer__attachments">
                    <div className="composer__attachment-chip">
                      <img
                        src={chat.pendingImage}
                        alt={ti('panel.composer.preview_alt')}
                        className="composer__attachment-thumb"
                      />
                      <span className="composer__attachment-label">{ti('panel.composer.image_ready')}</span>
                      <button
                        type="button"
                        className="composer__attachment-remove"
                        onClick={clearPendingImage}
                        aria-label={ti('panel.composer.remove_image')}
                        title={ti('panel.composer.remove_image')}
                      >
                        <PetControlIcon name="close" className="composer__attachment-remove-icon" />
                      </button>
                    </div>
                  </div>
                ) : null}

                <textarea
                  ref={composerTextareaRef}
                  rows={3}
                  value={chat.input}
                  placeholder={composerPlaceholder}
                  aria-label={composerPlaceholder}
                  onChange={(event) => chat.setInput(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  onPaste={handleComposerPaste}
                  onDragOver={handleComposerDragOver}
                  onDrop={handleComposerDrop}
                />

                {visionEnabled ? (
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="composer__file-input"
                    aria-label={ti('panel.composer.attach_title')}
                    onChange={handleFilePickerChange}
                  />
                ) : null}

                <div className="companion-chat__composer-meta">
                  <div className="composer__hint">
                    {activeNotificationReply ? (
                      <span className="composer__hint-note">
                        {notificationReplyHintLabel}
                        <button
                          type="button"
                          className="ghost-button ghost-button--compact composer__hint-action"
                          onClick={handleCancelNotificationReply}
                        >
                          {ti('common.cancel')}
                        </button>
                      </span>
                    ) : null}
                    {ti('panel.composer.enter_hint')}
                  </div>
                </div>

                <div className="composer__actions">
                  {visionEnabled ? (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={openFilePicker}
                      aria-label={ti('panel.composer.attach_title')}
                      title={ti('panel.composer.attach_title')}
                    >
                      <PetControlIcon name="image" className="composer__action-icon" />
                      <span>{ti('panel.composer.image_button')}</span>
                    </button>
                  ) : null}
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={voice.toggleVoiceConversation}
                    disabled={voiceActionDisabled}
                    aria-label={voiceActionLabel}
                    title={voiceActionLabel}
                  >
                    <PetControlIcon name="mic" className="composer__action-icon" />
                    <span>{voiceActionLabel}</span>
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void handleComposerSend()}
                    disabled={hasNotificationReply ? !canSendNotificationReply : (chat.busy || (!chat.input.trim() && !chat.pendingImage))}
                    aria-label={sendButtonLabel}
                    title={sendButtonLabel}
                  >
                    <PetControlIcon name="send" className="composer__action-icon" />
                    <span>
                      {chat.busy
                        ? `${sendButtonLabel}...`
                        : hasNotificationReply
                          ? ti('panel.notification.send_reply')
                          : ti('panel.composer.send')}
                    </span>
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}
      </section>
      {settingsDrawer}
      {onboardingGuide}
    </div>
  )
}
