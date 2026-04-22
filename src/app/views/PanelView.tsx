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
import { getLiveTranscriptLabel, getTimeGreeting, getVoiceStateLabel } from '../appSupport'
import { ActivePlanStrip, MessageBubble, SubagentTaskStrip } from '../../components'
import { resolveCharacterPreset } from '../../features/character/presets'
import { useAmbientWeather } from '../../hooks/useAmbientWeather'
import { shorten } from '../../lib'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { UseAppControllerResult } from '../controllers/useAppController'

// Maximum number of messages rendered at once. Older messages are hidden
// behind a "load earlier" button to keep the DOM lean on long conversations.
const MESSAGE_PAGE_SIZE = 100

type PanelViewProps = UseAppControllerResult['panelView'] & {
  settingsDrawer: ReactNode
  onboardingGuide: ReactNode
}

export function PanelView({
  settings,
  memory,
  pet,
  voice,
  chat,
  runtimeSnapshot,
  petRuntimeContinuousVoiceActive,
  panelCollapsed,
  openSettingsPanel,
  togglePanelCollapse,
  closePanel,
  subagentTasks,
  settingsDrawer,
  onboardingGuide,
}: PanelViewProps) {
  const messageListRef = useRef<HTMLDivElement | null>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [showAllMessages, setShowAllMessages] = useState(false)

  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(settings.uiLanguage, key, params)
  const characterPreset = useMemo(() => resolveCharacterPreset(), [])
  const timeGreeting = getTimeGreeting(ti)

  const ambientWeather = useAmbientWeather(
    settings.toolWeatherDefaultLocation,
    settings.ambientWeatherEnabled,
  )
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
  const visibleMessages = chat.messages
  const chatMessageCount = visibleMessages.filter((message) => message.role !== 'system').length
  const welcomeTitle = `${timeGreeting}，${settings.userName}`
  const welcomeBody = memory.memories[0]?.content
    ? ti('panel.greeting.remembered', { memory: shorten(memory.memories[0].content, 24) })
    : ti('panel.greeting.welcome', { companionName: settings.companionName })
  const liveTranscriptLabel = getLiveTranscriptLabel(voice.voiceState, ti)
  const liveStatusLine = voice.liveTranscript
    ? `${liveTranscriptLabel}：${shorten(voice.liveTranscript, 34)}`
    : assistantActivityLabel
      ? assistantActivityLabel
      : nextSchedulerStatusLabel
        ? nextSchedulerStatusLabel
        : pet.petStatusText
  const panelHeroStatusText = chat.error
    ? ti('panel.audio_smoke_test_hint')
    : assistantActivityLabel
      ? assistantActivityLabel
      : nextSchedulerStatusLabel
        ? nextSchedulerStatusLabel
        : pet.ambientPresence?.text
          ? shorten(pet.ambientPresence.text, 64)
          : ti(characterPreset.motionLabel)
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
    void chat.sendMessage()
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
    if (event.dataTransfer?.types?.includes('Files')) {
      event.preventDefault()
    }
  }

  function handleComposerDrop(event: ReactDragEvent<HTMLTextAreaElement>) {
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
    const frameId = window.requestAnimationFrame(() => {
      const messageList = messageListRef.current
      if (!messageList) {
        return
      }

      messageList.scrollTo({
        top: messageList.scrollHeight,
        behavior: 'smooth',
      })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [visibleMessages])

  return (
    <div className={`desktop-pet-root desktop-pet-root--panel ${characterPreset.themeClassName} ${panelCollapsed ? 'desktop-pet-root--panel-collapsed' : ''}`}>
      <section className={`panel-window panel-window--simple panel-window--companion ${panelCollapsed ? 'is-collapsed' : ''}`}>
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
                <button className="ghost-button" type="button" onClick={togglePanelCollapse}>
                  {ti('panel.button.expand')}
                </button>
                <button className="ghost-button" type="button" onClick={openSettingsPanel}>
                  {ti('panel.button.settings')}
                </button>
                <button className="ghost-button" type="button" onClick={closePanel}>
                  {ti('panel.button.close')}
                </button>
              </div>
            </div>

            <div className="panel-window__collapsed-bar">
              <span>{ti('panel.collapsed.session_count', { count: chatMessageCount })}</span>
              <span>{chat.error ? shorten(chat.error, 26) : liveStatusLine}</span>
            </div>
          </>
        ) : (
          <div className="panel-window__shell">
            <div className="panel-window__ambient panel-window__ambient--primary" aria-hidden="true" />
            <div className="panel-window__ambient panel-window__ambient--secondary" aria-hidden="true" />

            <div className="companion-chat__toolbar">
              <div className="companion-chat__toolbar-left">
                <span className={`connection-dot ${runtimeSnapshot.petOnline || runtimeSnapshot.panelOnline ? 'is-online' : ''}`} title={companionStatusChipLabel} />
                <span className="companion-chat__toolbar-status">{liveStatusLine || companionStatusChipLabel}</span>
              </div>
              <div className="panel-window__header-actions panel-window__header-actions--hero">
                {ambientWeather ? (
                  <span
                    className="ambient-weather-chip"
                    title={ambientWeather.fullSummary || ambientWeather.resolvedName}
                  >
                    <span className="ambient-weather-chip__condition">
                      {ambientWeather.conditionLabel || ti('panel.weather.fallback_label')}
                    </span>
                    {ambientWeather.temperatureC !== null ? (
                      <span className="ambient-weather-chip__temp">
                        {Math.round(ambientWeather.temperatureC)}°
                      </span>
                    ) : null}
                    <span className="ambient-weather-chip__place">{ambientWeather.resolvedName}</span>
                  </span>
                ) : null}
                <button className="ghost-button" type="button" onClick={openSettingsPanel}>
                  {ti('panel.button.settings')}
                </button>
                <button className="ghost-button" type="button" onClick={togglePanelCollapse}>
                  {ti('panel.button.collapse')}
                </button>
                <button className="ghost-button" type="button" onClick={closePanel}>
                  {ti('panel.button.close')}
                </button>
              </div>
            </div>

            <ActivePlanStrip />

            <SubagentTaskStrip tasks={subagentTasks} />

            <section className="companion-chat">

              <div ref={messageListRef} className="message-list companion-chat__messages" aria-live="polite" aria-label={ti('panel.messages.aria_label')}>
                {visibleMessages.length ? (
                  <>
                    {!showAllMessages && visibleMessages.length > MESSAGE_PAGE_SIZE && (
                      <div className="message-list__load-earlier">
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => setShowAllMessages(true)}
                        >
                          {ti('panel.messages.load_earlier', { count: visibleMessages.length - MESSAGE_PAGE_SIZE })}
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
                      <strong>{welcomeTitle}</strong>
                      <p>{welcomeBody}</p>
                      <div className="empty-chat__prompt-grid">
                        {panelQuickPrompts.map((item) => (
                          <button
                            key={item.label}
                            className="empty-chat__prompt"
                            type="button"
                            onClick={() => handleApplyQuickPrompt(item.prompt)}
                          >
                            <span>{item.label}</span>
                            <small>{item.prompt}</small>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {chat.error ? <div className="error-banner">{chat.error}</div> : null}

              <div className="composer composer--minimal companion-chat__composer">
                {chat.pendingImage ? (
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
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ) : null}

                <textarea
                  ref={composerTextareaRef}
                  rows={5}
                  value={chat.input}
                  placeholder={ti('panel.composer.placeholder', { companionName: settings.companionName })}
                  onChange={(event) => chat.setInput(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  onPaste={handleComposerPaste}
                  onDragOver={handleComposerDragOver}
                  onDrop={handleComposerDrop}
                />

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  style={{ display: 'none' }}
                  onChange={handleFilePickerChange}
                />

                <div className="companion-chat__composer-meta">
                  <div className="composer__hint">
                    {ti('panel.composer.enter_hint')}
                  </div>
                </div>

                <div className="composer__actions">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={openFilePicker}
                    title={ti('panel.composer.attach_title')}
                  >
                    {ti('panel.composer.image_button')}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={voice.toggleVoiceConversation}
                    disabled={voiceActionDisabled}
                  >
                    {voiceActionLabel}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void chat.sendMessage()}
                    disabled={chat.busy || (!chat.input.trim() && !chat.pendingImage)}
                    aria-label={chat.busy ? ti('panel.composer.send_busy', { companionName: settings.companionName }) : ti('panel.composer.send_message')}
                  >
                    {chat.busy ? `${ti('panel.composer.send_busy', { companionName: settings.companionName })}...` : ti('panel.composer.send')}
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
