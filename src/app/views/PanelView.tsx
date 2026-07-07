import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import {
  getImage4PreviewModeSync,
  getImage4RhythmGridModeSync,
  getImage4SnapshotModeSync,
  getImage4StatePreviewSync,
  getTimeGreeting,
  getTimeGreetingEmoji,
  getVoiceStateLabel,
} from '../appSupport'
import { Image4Dial, Image4PresenceHeader } from './Image4CompanionField'
import { Image4RhythmGrid } from './Image4RhythmGrid'
import {
  buildImage4ChatPreviewMessages,
  getImage4ChatPreviewModeSync,
  getImage4ChatPreviewVariantSync,
} from './image4ChatPreview'
import { resolveImage4ActivityLabelKey } from './image4ActivityLabel'
import { deriveImage4CompanionState } from './image4CompanionState'
import { deriveImage4ComposerState } from './image4ComposerState'
import { PanelNotificationSummary } from './PanelNotificationSummary'
import { PanelToolbarButton } from './PanelToolbarButton'
import { ActivePlanStrip } from '../../components/ActivePlanStrip'
import { MessageBubble } from '../../components/MessageBubble'
import { resolveCharacterPreset } from '../../features/character/presets'
import {
  buildChatMemoryTraceFocus,
  resolveChatMemoryTraceDetails,
  type ChatMemoryTraceDetails,
} from '../../features/memory/traceDetails'
import type { NotificationCardPrimaryActionId } from '../../features/notifications/notificationCardActions'
import {
  formatCompanionElapsedBucket,
  type CompanionElapsedBucket,
} from '../../features/context/companionTimeLanguage'
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
import { useAmbientWeather } from '../../hooks/useAmbientWeather'
import { shorten } from '../../lib'
import { modelSupportsVision } from '../../lib/modelCapabilities'
import { buildNotificationReplyDraftText } from '../../lib/privacy/notificationPrivacy'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import { PetControlIcon, type PetControlIconName } from '../../components/PetControlIcon'
import type { UseAppControllerResult } from '../controllers/useAppController'
import type { NotificationMessage } from '../../types'

// Maximum number of messages rendered at once. Older messages are hidden
// behind a "load earlier" button to keep the DOM lean on long conversations.
const MESSAGE_PAGE_SIZE = 100
const PANEL_QUICK_PROMPT_ICONS: readonly PetControlIconName[] = ['clipboard', 'chat', 'calendar-clock']

function getPanelElapsedBucket(startedAtMs: number, nowMs: number): CompanionElapsedBucket {
  const elapsedMinutes = Math.max(0, Math.floor((nowMs - startedAtMs) / 60000))
  if (elapsedMinutes < 5) return 'just_started'
  if (elapsedMinutes < 24) return 'a_while'
  if (elapsedMinutes < 55) return 'about_half_hour'
  if (elapsedMinutes < 110) return 'about_hour'
  return 'two_hours_or_more'
}

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

export function PanelView({
  settings,
  memory,
  pet,
  voice,
  chat,
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
  replyToTelegram,
  replyToDiscord,
}: PanelViewProps) {
  const messageListRef = useRef<HTMLDivElement | null>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const lastCrisisSignalRef = useRef<CrisisSignal | null>(null)
  const panelSessionStartedAtRef = useRef(Date.now())
  const [showAllMessages, setShowAllMessages] = useState(false)
  const [activeNotificationReply, setActiveNotificationReply] = useState<NotificationReplyTarget | null>(null)
  const crisisSignal = useCrisisPanelState()

  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(settings.uiLanguage, key, params)
  const characterPreset = useMemo(() => resolveCharacterPreset(), [])
  const image4PreviewMode = useMemo(() => getImage4PreviewModeSync(), [])
  const image4RhythmGridMode = useMemo(() => getImage4RhythmGridModeSync(), [])
  const image4SnapshotMode = useMemo(() => getImage4SnapshotModeSync(), [])
  const image4StatePreview = useMemo(() => getImage4StatePreviewSync(), [])
  const image4ChatPreviewMode = useMemo(() => getImage4ChatPreviewModeSync(), [])
  const image4ChatPreviewVariant = useMemo(() => getImage4ChatPreviewVariantSync(), [])
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
  const [panelClock, setPanelClock] = useState(() => new Date())
  useEffect(() => {
    const update = () => {
      setPanelClock(new Date())
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
  const voiceStateLabel = getVoiceStateLabel(voice.voiceState, ti)
  const nextSchedulerStatusLabel = runtimeSnapshot.schedulerArmed
    ? runtimeSnapshot.activeTaskLabel
      ? ti('panel.next_task_prefix', { name: runtimeSnapshot.activeTaskLabel })
      : ti('panel.timer_suspended')
    : ''
  const assistantActivityLabel = voice.voiceState === 'speaking'
    ? ti('panel.status.speaking')
    : voice.voiceState === 'listening'
      ? ti('panel.status.listening')
      : chat.assistantActivity === 'searching'
        ? ti('panel.status.searching')
        : chat.assistantActivity === 'summarizing'
          ? ti('panel.status.summarizing')
          : chat.assistantActivity === 'scheduling'
            ? ti('panel.status.scheduling')
            : chat.busy
              ? ti('panel.status.thinking')
              : ''
  const companionStatusChipLabel = voice.voiceState !== 'idle'
    ? voiceStateLabel
    : chat.assistantActivity === 'searching'
      ? ti('panel.chip.searching')
      : chat.assistantActivity === 'summarizing'
        ? ti('panel.chip.summarizing')
        : chat.assistantActivity === 'scheduling'
          ? ti('panel.chip.scheduling')
          : chat.busy
            ? ti('panel.chip.thinking')
            : runtimeSnapshot.petOnline || runtimeSnapshot.panelOnline
              ? ti('panel.chip.online')
              : voiceStateLabel
  // Pane-session scoping: hide everything the archive already had when
  // useChat mounted. useChat keeps the snapshot at app-root scope so it
  // survives PanelView remounts (earlier attempts at 2b9134c / 8574360
  // re-seeded on every remount and ended up eating freshly appended
  // STT transcripts). Anything append()ed after boot — voice, text,
  // tool result, system notice — has a fresh id and passes through.
  const visibleMessages = image4PreviewMode && image4ChatPreviewMode
    ? buildImage4ChatPreviewMessages(panelClock, image4ChatPreviewVariant)
    : chat.messages
  const hiddenMessageCount = Math.max(0, visibleMessages.length - MESSAGE_PAGE_SIZE)
  const loadEarlierLabel = ti('panel.messages.load_earlier', { count: hiddenMessageCount })
  const chatMessageCount = visibleMessages.filter((message) => message.role !== 'system').length
  const messageMemoryTraceDetails = useMemo(() => {
    const detailsByMessageId = new Map<string, ChatMemoryTraceDetails>()
    for (const message of visibleMessages) {
      const details = resolveChatMemoryTraceDetails({
        trace: message.memoryTrace,
        memories: memory.memories,
        dailyMemories: memory.dailyMemories,
      })
      if (details) {
        detailsByMessageId.set(message.id, details)
      }
    }
    return detailsByMessageId
  }, [memory.dailyMemories, memory.memories, visibleMessages])
  const welcomeTitle = `${timeGreeting}，${settings.userName}`
  const welcomeBody = image4PreviewMode
    ? `${settings.companionName}在这儿陪着你。哪怕只是说句今天怎么样，我也想听。`
    : memory.memories[0]?.content
    ? ti('panel.greeting.remembered', { memory: shorten(memory.memories[0].content, 24) })
    : ti('panel.greeting.welcome', { companionName: settings.companionName })
  const panelHeroStatusText = chat.error
    ? ti('panel.audio_smoke_test_hint')
    : assistantActivityLabel
      ? assistantActivityLabel
      : nextSchedulerStatusLabel
        ? nextSchedulerStatusLabel
    : pet.ambientPresence?.text
      ? shorten(pet.ambientPresence.text, 64)
      : ti(characterPreset.motionLabel)
  const panelClockLabel = panelClock.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const panelDateLabel = panelClock.toLocaleDateString(settings.uiLanguage, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const image4ElapsedBucket = image4PreviewMode
    ? 'about_half_hour'
    : getPanelElapsedBucket(panelSessionStartedAtRef.current, panelClock.getTime())
  const panelElapsedLabel = image4PreviewMode
    ? '刚刚过了半小时'
    : formatCompanionElapsedBucket(image4ElapsedBucket, settings.uiLanguage)
  const image4HeaderTitle = settings.companionName
  const image4CompanionState = deriveImage4CompanionState({
    voiceState: voice.voiceState,
    assistantActivity: chat.assistantActivity,
    chatBusy: chat.busy,
    elapsedBucket: image4ElapsedBucket,
    statePreview: image4StatePreview,
  })
  const image4TopStatusLabel = ti(resolveImage4ActivityLabelKey(image4CompanionState))
  const image4CompanionStateStyle = {
    '--image4-companion-intensity': image4CompanionState.intensity.toFixed(2),
    '--image4-dial-emphasis': image4CompanionState.dialEmphasis.toFixed(2),
    '--image4-presence-pulse': image4CompanionState.presencePulse.toFixed(2),
  } as CSSProperties
  const image4WeatherCanSync = settings.ambientWeatherEnabled && settings.toolWeatherDefaultLocation.trim().length > 0
  const image4WeatherLabel = ambientWeather
    ? [
        ambientWeather.conditionLabel || ti('panel.weather.fallback_label'),
        ambientWeather.temperatureC !== null ? `${Math.round(ambientWeather.temperatureC)}°` : '',
      ].filter(Boolean).join(' · ')
    : image4WeatherCanSync
      ? ti('panel.weather.syncing_label')
      : ti('panel.weather.disabled_label')

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
  const collapsedPanelStatusLabel = chat.error
    ? shorten(chat.error, 26)
    : collapsedUnreadLabel ?? `${panelElapsedLabel} · ${companionStatusChipLabel}`

  const hasUnreadNotifications = pendingNotificationCount > 0

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
    chat.setInput(buildNotificationReplyDraftText(message, ti))

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

  function handleNotificationPrimaryAction(actionId: NotificationCardPrimaryActionId, message: NotificationMessage) {
    if (actionId === 'draft_reply') {
      handleNotificationDraft(message)
      return
    }

    if (actionId === 'mark_important') {
      handleMarkImportant(message.id)
      return
    }

    handleSnoozeNotification(message.id, 30)
  }

  function isNotificationReplying() {
    return activeNotificationReply !== null
  }

  const panelQuickPrompts = useMemo(() => {
    if (image4PreviewMode) {
      return [
        {
          label: '整理今日重点',
          prompt: '帮我整理今天最重要的三件事，并告诉我现在第一步先做什么。',
        },
        {
          label: '简单聊聊',
          prompt: '先和我简单聊两句，帮我把现在脑子里最乱的一件事说清楚。',
        },
        {
          label: '做个轻计划',
          prompt: '根据我现在的状态，给我一个 20 分钟可执行的小计划，语气轻一点。',
        },
      ]
    }

    return [
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
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ti is stable per render via the pickTranslatedUiText call
  }, [image4PreviewMode, memory.memories, settings.uiLanguage])
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
  const composerPlaceholder = image4PreviewMode
    ? `想和${settings.companionName}说什么？`
    : ti('panel.composer.placeholder_short', { companionName: settings.companionName })
  const image4SuggestionText = image4PreviewMode
    ? `✦ 和${settings.companionName} 说点什么，比如：帮我整理今天待办 / 记一下刚才的灵感 / 给我一句放松的提醒。`
    : `✦ 和${settings.companionName}说点什么，比如：帮我整理今天待办 / 记一下刚才的灵感 / 给我一句放松的提醒。`

  const hasNotificationReply = isNotificationReplying() && Boolean(activeNotificationReply)
  const canSendNotificationReply = hasNotificationReply
    && !chat.busy
    && Boolean(chat.input.trim())
    && !chat.pendingImage
  const image4ComposerState = deriveImage4ComposerState({
    busy: chat.busy,
    input: chat.input,
    hasPendingImage: Boolean(chat.pendingImage),
    hasNotificationReply,
    canSendNotificationReply,
    voiceState: voice.voiceState,
  })

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

  function handleImageAttachmentAction() {
    if (visionEnabled) {
      openFilePicker()
      return
    }
    openSettingsSection('model')
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
        className={`panel-window panel-window--simple panel-window--companion ${panelCollapsed ? 'is-collapsed' : 'panel-window--image4'}`}
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
              <span>{collapsedPanelStatusLabel}</span>
            </div>
          </>
        ) : (
          <div className="panel-window__shell panel-window__shell--image4 image4-layout">
            <div className="companion-chat__toolbar image4-header-controls">
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
              <div className="panel-window__header-actions panel-window__header-actions--hero panel-window__header-actions--image4">
                <PanelToolbarButton
                  icon="settings"
                  label={ti('panel.button.settings')}
                  onClick={openSettingsPanel}
                  tone="settings"
                />
                <PanelToolbarButton
                  icon="collapse"
                  label={ti('panel.button.collapse')}
                  onClick={togglePanelCollapse}
                  tone="collapse"
                />
                <PanelToolbarButton
                  icon="close"
                  label={ti('panel.button.close')}
                  onClick={closePanel}
                  tone="danger"
                />
              </div>
            </div>

            {notificationBridge && hasUnreadNotifications ? (
              <PanelNotificationSummary
                canReplyToNotification={canReplyToNotification}
                getNotificationSourceLabel={getNotificationSourceLabel}
                messages={unreadNotifications}
                onClearNotifications={handleClearNotifications}
                onMarkAllRead={handleMarkAllRead}
                onMarkNotificationRead={handleMarkNotificationRead}
                onNotificationPrimaryAction={handleNotificationPrimaryAction}
                onReplyToNotification={handleReplyToNotification}
                totalMessageCount={notificationBridge.messages.length}
                translate={ti}
              />
            ) : null}

            <ActivePlanStrip />

            <section
              className={`companion-chat image4-chat ${image4SnapshotMode ? 'is-image4-snapshot' : ''}`}
              data-companion-activity={image4CompanionState.activityState}
              data-companion-mode={image4CompanionState.mode}
              data-companion-tone={image4CompanionState.contextTone}
              style={image4CompanionStateStyle}
            >
              {image4RhythmGridMode ? <Image4RhythmGrid /> : null}
              <Image4PresenceHeader
                body={welcomeBody}
                signalActive={image4CompanionState.signalActive}
                statusLabel={image4TopStatusLabel}
                title={image4HeaderTitle}
              />
              <Image4Dial
                clockLabel={panelClockLabel}
                dateLabel={panelDateLabel}
                greeting={timeGreeting}
                speaking={image4CompanionState.mode === 'speaking'}
                weatherLabel={image4WeatherLabel}
              />

              <div
                ref={messageListRef}
                className={`message-list companion-chat__messages image4-message-list ${visibleMessages.length ? '' : 'is-empty'}`}
                aria-live="polite"
                aria-label={ti('panel.messages.aria_label')}
              >
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
                        memoryTraceDetails={messageMemoryTraceDetails.get(message.id)}
                        onOpenMemorySettings={() => openSettingsSection('memory', buildChatMemoryTraceFocus(message.memoryTrace))}
                      />
                    ))}
                  </>
                ) : null}
              </div>

              {!visibleMessages.length ? (
                <>
                  <section className="empty-chat empty-chat--nexus image4-greeting">
                    <div className="empty-chat__copy">
                      <strong>
                        <span className="empty-chat__greeting-emoji" aria-hidden="true">
                          {timeGreetingEmoji}
                        </span>
                        {welcomeTitle}
                      </strong>
                      <p>{welcomeBody} <span className="empty-chat__sparkle" aria-hidden="true">✨</span></p>
                    </div>
                  </section>

                  <div className="empty-chat__prompt-grid image4-action-list">
                    {panelQuickPrompts.map((item, index) => {
                      const quickPromptLabel = `${item.label}: ${item.prompt}`
                      const promptIconName = PANEL_QUICK_PROMPT_ICONS[index] ?? 'sparkles'
                      return (
                        <button
                          key={item.label}
                          className="empty-chat__prompt image4-action"
                          type="button"
                          onClick={() => handleApplyQuickPrompt(item.prompt)}
                          aria-label={quickPromptLabel}
                          title={quickPromptLabel}
                        >
                          <span className="empty-chat__prompt-icon" aria-hidden="true">
                            <PetControlIcon name={promptIconName} />
                          </span>
                          <span className="empty-chat__prompt-copy">
                            <span>{item.label}</span>
                            <small>{item.prompt}</small>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : null}

              {chat.error ? (
                <div className="error-banner" role="alert" aria-live="assertive" aria-atomic="true">
                  {chat.error}
                </div>
              ) : null}

              <div className="composer composer--minimal companion-chat__composer image4-composer">
                <div className="image4-composer__suggestion" aria-hidden="true">
                  {image4SuggestionText}
                </div>

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

                <div
                  className="image4-composer__field"
                  data-composer-state={image4ComposerState.mode}
                  data-send-state={image4ComposerState.sendState}
                  data-has-attachment={image4ComposerState.hasAttachment ? 'true' : 'false'}
                  data-voice-state={image4ComposerState.voiceMode}
                >
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

                  <button
                    className="image4-attachment-pill"
                    type="button"
                    onClick={handleImageAttachmentAction}
                    aria-label={ti('panel.composer.attach_title')}
                    title={ti('panel.composer.attach_title')}
                  >
                    <PetControlIcon name="plus" className="image4-attachment-pill__plus" />
                  </button>

                  <div className="composer__actions">
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
                      disabled={image4ComposerState.sendDisabled}
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
