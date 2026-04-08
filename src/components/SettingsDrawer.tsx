import { useEffect, useState } from 'react'
import {
  getMemorySearchModeOptions,
  getSettingsSectionOptions,
  type ConnectionResult,
  type SettingsSectionId,
} from './settingsDrawerSupport'
import {
  getApiProviderPreset,
  getVoiceCloneProviderPreset,
  switchSpeechOutputProvider,
  switchTextProvider,
  clampPresenceIntervalMinutes,
  resolveLocalizedText,
  UI_LANGUAGE_OPTIONS,
} from '../lib'
import { MEMORY_EMBEDDING_MODEL_OPTIONS } from '../features/memory'
import type { PetModelDefinition } from '../features/pet'
import type { ReminderTaskDraftInput } from '../features/reminders'
import {
  AutonomySection,
  ChatSection,
  CloneSection,
  ConsoleSection,
  ContextSection,
  HistorySection,
  IntegrationsSection,
  MemorySection,
  ModelSection,
  SpeechInputSection,
  SpeechOutputSection,
  VoiceSection,
  WindowSection,
} from './settingsSections'
import {
  useConnectionTests,
  useSpeechVoiceManagement,
  useVoiceCloneActions,
  useChatHistoryActions,
  useMemoryArchiveActions,
  useWindowStateSync,
  usePetModelImport,
} from './settingsDrawerHooks'
import type {
  AppSettings,
  DailyMemoryEntry,
  DebugConsoleEvent,
  MemoryItem,
  ReminderTask,
  ServiceConnectionCapability,
  SpeechVoiceListResponse,
  VoicePipelineState,
  VoiceState,
  VoiceTraceEntry,
} from '../types'

export type CloneVoicePayload = {
  settings: AppSettings
  name: string
  description: string
  files: File[]
  removeBackgroundNoise: boolean
}

export type SettingsDrawerProps = {
  open: boolean
  settings: AppSettings
  chatMessageCount: number
  chatBusy: boolean
  memories: MemoryItem[]
  dailyMemoryEntries: DailyMemoryEntry[]
  petModelPresets: PetModelDefinition[]
  reminderTasks: ReminderTask[]
  voiceState: VoiceState
  continuousVoiceActive: boolean
  liveTranscript: string
  speechLevel: number
  voicePipeline: VoicePipelineState
  voiceTrace: VoiceTraceEntry[]
  debugConsoleEvents: DebugConsoleEvent[]
  onClose: () => void
  onSave: (settings: AppSettings) => void
  onExportChatHistory: () => Promise<{
    canceled: boolean
    filePath?: string
    message: string
  }>
  onImportChatHistory: () => Promise<{
    canceled: boolean
    filePath?: string
    message: string
  }>
  onClearChatHistory: () => Promise<{
    canceled: boolean
    message: string
  }>
  onExportMemoryArchive: () => Promise<{
    canceled: boolean
    filePath?: string
    message: string
  }>
  onImportMemoryArchive: () => Promise<{
    canceled: boolean
    filePath?: string
    message: string
  }>
  onClearMemoryArchive: () => Promise<{
    canceled: boolean
    message: string
  }>
  onAddManualMemory: (content: string) => void
  onUpdateMemory: (id: string, content: string) => void
  onRemoveMemory: (id: string) => void
  onClearDailyMemory: () => void
  onUpdateDailyEntry?: (id: string, day: string, content: string) => void
  onRemoveDailyEntry?: (id: string, day: string) => void
  onAddReminderTask: (input: ReminderTaskDraftInput) => void
  onUpdateReminderTask: (
    id: string,
    updates: Partial<Omit<ReminderTask, 'id' | 'createdAt'>>,
  ) => void
  onRemoveReminderTask: (id: string) => void
  onImportPetModel: () => Promise<{
    model: PetModelDefinition
    message: string
  } | null>
  onTestConnection: (
    capability: ServiceConnectionCapability,
    settings: AppSettings,
  ) => Promise<ConnectionResult>
  onLoadSpeechVoices: (settings: AppSettings) => Promise<SpeechVoiceListResponse>
  onPreviewSpeech: (settings: AppSettings, text: string) => Promise<{
    message: string
  }>
  onRunAudioSmokeTest: (settings: AppSettings) => Promise<ConnectionResult>
  onClearDebugConsole: () => void
  onCloneVoice: (payload: CloneVoicePayload) => Promise<{
    voiceId: string
    message: string
  }>
  // Notification channels (optional — only present when autonomy is wired)
  notificationChannels?: import('../types').NotificationChannel[]
  notificationChannelsLoading?: boolean
  onAddNotificationChannel?: (draft: Omit<import('../types').NotificationChannel, 'id'>) => Promise<void>
  onUpdateNotificationChannel?: (id: string, patch: Partial<import('../types').NotificationChannel>) => Promise<void>
  onRemoveNotificationChannel?: (id: string) => Promise<void>
}

function renderSettingsCardIcon(iconKey: string) {
  switch (iconKey) {
    case 'console':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M4 8a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Zm6.3 3.3a1 1 0 0 0-1.4 1.4L12.2 16l-3.3 3.3a1 1 0 0 0 1.4 1.4l4-4a1 1 0 0 0 0-1.4l-4-4ZM16 19a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-6Z" />
        </svg>
      )
    case 'model':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M16 4a1.5 1.5 0 0 1 1.3.76l2.38 4.12 4.62 1.1a1.5 1.5 0 0 1 .83 2.46L21.8 16l1.02 4.72a1.5 1.5 0 0 1-2.17 1.58L16 19.8l-4.65 2.5a1.5 1.5 0 0 1-2.17-1.58L10.2 16l-3.33-3.56a1.5 1.5 0 0 1 .83-2.46l4.62-1.1 2.38-4.12A1.5 1.5 0 0 1 16 4Z" />
        </svg>
      )
    case 'chat':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M7 6a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h2v4a1 1 0 0 0 1.6.8L16 24h9a4 4 0 0 0 4-4V10a4 4 0 0 0-4-4H7Zm4 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
        </svg>
      )
    case 'history':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M16 4C9.37 4 4 9.37 4 16s5.37 12 12 12 12-5.37 12-12S22.63 4 16 4Zm1 5a1 1 0 1 0-2 0v7a1 1 0 0 0 .45.83l4 2.67a1 1 0 0 0 1.1-1.67L17 15.56V9Z" />
        </svg>
      )
    case 'memory':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M16 4a1 1 0 0 1 .86.5C18.5 7.5 22 11.24 22 15a6 6 0 0 1-5 5.91V24h3a1 1 0 1 1 0 2h-3v2a1 1 0 1 1-2 0v-2h-3a1 1 0 1 1 0-2h3v-3.09A6 6 0 0 1 10 15c0-3.76 3.5-7.5 5.14-10.5A1 1 0 0 1 16 4Z" />
        </svg>
      )
    case 'voice':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect fill="currentColor" x="11" y="4" width="10" height="14" rx="5" />
          <path fill="currentColor" d="M7 15a1 1 0 0 1 2 0 7 7 0 0 0 14 0 1 1 0 1 1 2 0 9 9 0 0 1-8 8.94V27h3a1 1 0 1 1 0 2h-8a1 1 0 1 1 0-2h3v-3.06A9 9 0 0 1 7 15Z" />
        </svg>
      )
    case 'window':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M4 8a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Zm4-1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM4 12h24v12a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V12Z" />
        </svg>
      )
    case 'integrations':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M14 4a1 1 0 0 0-1 1v4.05A3.5 3.5 0 0 1 9.05 13H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4.05A3.5 3.5 0 0 1 13 22.95V27a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-4.05A3.5 3.5 0 0 1 22.95 19H27a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-4.05A3.5 3.5 0 0 1 19 9.05V5a1 1 0 0 0-1-1h-4Z" />
        </svg>
      )
    case 'autonomy':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M16 3a1 1 0 0 1 .87.5l2.5 4.33 4.96 1.17a1 1 0 0 1 .58 1.62L21.5 14.5l.78 5.13a1 1 0 0 1-1.45 1.05L16 18l-4.83 2.68a1 1 0 0 1-1.45-1.05l.78-5.13-3.41-3.88a1 1 0 0 1 .58-1.62l4.96-1.17 2.5-4.33A1 1 0 0 1 16 3ZM8 24a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2H8Zm2 4a1 1 0 1 0 0 2h12a1 1 0 1 0 0-2H10Z" />
        </svg>
      )
    default:
      return null
  }
}

export function SettingsDrawer({
  open,
  settings,
  chatMessageCount,
  chatBusy,
  memories,
  dailyMemoryEntries,
  petModelPresets,
  reminderTasks,
  voiceState,
  continuousVoiceActive,
  liveTranscript,
  speechLevel,
  voicePipeline,
  voiceTrace,
  debugConsoleEvents,
  onClose,
  onSave,
  onExportChatHistory,
  onImportChatHistory,
  onClearChatHistory,
  onExportMemoryArchive,
  onImportMemoryArchive,
  onClearMemoryArchive,
  onAddManualMemory,
  onUpdateMemory,
  onRemoveMemory,
  onClearDailyMemory,
  onUpdateDailyEntry,
  onRemoveDailyEntry,
  onAddReminderTask,
  onUpdateReminderTask,
  onRemoveReminderTask,
  onImportPetModel,
  onTestConnection,
  onLoadSpeechVoices,
  onPreviewSpeech,
  onRunAudioSmokeTest,
  onClearDebugConsole,
  onCloneVoice,
  notificationChannels,
  notificationChannelsLoading,
  onAddNotificationChannel,
  onUpdateNotificationChannel,
  onRemoveNotificationChannel,
}: SettingsDrawerProps) {
  const [draft, setDraft] = useState(settings)
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>('console')
  const [settingsView, setSettingsView] = useState<'home' | 'section'>('home')

  const speechVoices = useSpeechVoiceManagement({
    draft,
    settings,
    open,
    onLoadSpeechVoices,
    onPreviewSpeech,
    onRunAudioSmokeTest,
  })

  const connectionTests = useConnectionTests({
    draft,
    onTestConnection,
    handleLoadSpeechVoices: speechVoices.handleLoadSpeechVoices,
  })

  const voiceClone = useVoiceCloneActions({
    draft,
    settings,
    onCloneVoice,
    setDraft,
  })

  const chatHistory = useChatHistoryActions({
    chatMessageCount,
    onExportChatHistory,
    onImportChatHistory,
    onClearChatHistory,
  })

  const memoryArchive = useMemoryArchiveActions({
    memories,
    dailyMemoryEntries,
    onExportMemoryArchive,
    onImportMemoryArchive,
    onClearMemoryArchive,
  })

  const windowState = useWindowStateSync({ open })

  const petModel_ = usePetModelImport({
    onImportPetModel,
    setDraft,
  })

  const textProvider = getApiProviderPreset(draft.apiProviderId)
  const petModel = petModelPresets.find((preset) => preset.id === draft.petModelId) ?? petModelPresets[0]
  const voiceCloneProvider = getVoiceCloneProviderPreset(draft.voiceCloneProviderId)

  const uiLanguage = draft.uiLanguage
  const t = (zhCN: string, enUS: string) => resolveLocalizedText(uiLanguage, {
    'zh-CN': zhCN,
    'en-US': enUS,
  })
  const getProviderRegionLabel = (region: 'global' | 'china' | 'custom') => {
    if (region === 'china') return t('\u4e2d\u56fd', 'China')
    if (region === 'custom') return t('\u81ea\u5b9a\u4e49', 'Custom')
    return t('\u5168\u7403', 'Global')
  }
  const memorySearchModeOptions = getMemorySearchModeOptions(uiLanguage)
  const settingsSectionOptions = getSettingsSectionOptions(uiLanguage)
  const selectedMemorySearchMode = memorySearchModeOptions.find((option) => option.value === draft.memorySearchMode)
    ?? memorySearchModeOptions[1]
  const selectedMemoryEmbeddingModel = MEMORY_EMBEDDING_MODEL_OPTIONS.find((option) => (
    option.value === draft.memoryEmbeddingModel
  ))
  const activeSectionLabel = settingsSectionOptions.find((section) => section.id === activeSectionId)?.label
    ?? settingsSectionOptions[0].label
  const activeSectionDescriptionById: Record<SettingsSectionId, string> = {
    console: t('查看当前运行链路、日志、转写和后台任务状态。', 'Review the live pipeline, logs, transcripts, and background tasks.'),
    model: t('单独管理大模型提供商、模型名称和主链路故障切换。', 'Manage the primary LLM provider, model id, and failover in one place.'),
    chat: t('调整角色名称、用户称呼、系统提示词和 Live2D 角色。', 'Tune the companion identity, user name, system prompt, and Live2D character.'),
    history: t('管理当前会话聊天记录的导入、导出与清理。', 'Manage import, export, and cleanup for the current chat history.'),
    memory: t('整理长期记忆、日记和向量检索策略。', 'Manage long-term memory, diary entries, and retrieval strategy.'),
    voice: t('统一配置连续对话、输入输出链路和语音体验。', 'Configure continuous talk mode plus the input and output voice pipeline.'),
    window: t('控制桌宠、面板和桌面交互方式。', 'Control the desktop pet, panel, and on-screen behavior.'),
    integrations: t('集中管理 MCP、Minecraft 与 Factorio 等模块接入。', 'Manage MCP, Minecraft, and Factorio module integrations.'),
    autonomy: t('配置自治引擎：焦点感知、主动智能、记忆整理和通知桥。', 'Configure autonomy: focus awareness, proactive intelligence, memory dream, and notification bridge.'),
  }
  const settingsSectionMetaById: Record<SettingsSectionId, {
    eyebrow: string
    glyph: string
    description: string
    preview: string[]
  }> = {
    console: {
      eyebrow: t('运行态观察', 'Runtime Monitor'),
      glyph: 'console',
      description: activeSectionDescriptionById.console,
      preview: [
        liveTranscript ? t('实时转写中', 'Live transcript') : t('等待语音输入', 'Waiting for voice'),
        `${debugConsoleEvents.length} ${t('条事件', 'events')}`,
      ],
    },
    model: {
      eyebrow: t('主对话模型', 'Primary LLM'),
      glyph: 'model',
      description: activeSectionDescriptionById.model,
      preview: [
        textProvider.label,
        draft.model || t('未填写模型', 'No model set'),
      ],
    },
    chat: {
      eyebrow: t('角色与设定', 'Companion Profile'),
      glyph: 'chat',
      description: activeSectionDescriptionById.chat,
      preview: [
        draft.companionName || t('未命名角色', 'Unnamed companion'),
        petModel?.label ?? t('未选择 Live2D', 'No Live2D selected'),
        draft.characterProfiles.length
          ? t(`${draft.characterProfiles.length} 个角色档案`, `${draft.characterProfiles.length} profile(s)`)
          : '',
      ].filter(Boolean),
    },
    history: {
      eyebrow: t('会话归档', 'Conversation Archive'),
      glyph: 'history',
      description: activeSectionDescriptionById.history,
      preview: [
        `${chatMessageCount} ${t('条消息', 'messages')}`,
        t('导入 / 导出 / 清理', 'Import / Export / Clear'),
      ],
    },
    memory: {
      eyebrow: t('长期记忆', 'Long-term Memory'),
      glyph: 'memory',
      description: activeSectionDescriptionById.memory,
      preview: [
        `${memories.length} ${t('条记忆', 'memories')}`,
        `${dailyMemoryEntries.length} ${t('条日记', 'daily notes')}`,
      ],
    },
    voice: {
      eyebrow: t('连续对话模式', 'Talk Mode'),
      glyph: 'voice',
      description: activeSectionDescriptionById.voice,
      preview: [
        draft.continuousVoiceModeEnabled ? t('连续语音开启', 'Continuous voice on') : t('连续语音关闭', 'Continuous voice off'),
        continuousVoiceActive ? t('当前正在监听', 'Live session running') : t('当前待命', 'Standing by'),
      ],
    },
    window: {
      eyebrow: t('桌宠与面板', 'Pet & Window'),
      glyph: 'window',
      description: activeSectionDescriptionById.window,
      preview: [
        petModel?.label ?? t('桌宠模型', 'Desktop pet'),
        windowState.petWindowState.clickThrough ? t('穿透开启', 'Click-through on') : t('正常交互', 'Interactive'),
      ],
    },
    integrations: {
      eyebrow: t('模块映射', 'Module Mapping'),
      glyph: 'integrations',
      description: activeSectionDescriptionById.integrations,
      preview: [
        draft.mcpServers.length ? t(`MCP ${draft.mcpServers.length} 个服务`, `MCP ${draft.mcpServers.length} server(s)`) : t('MCP 待配置', 'MCP pending'),
        draft.minecraftIntegrationEnabled || draft.factorioIntegrationEnabled
          ? t('游戏模块已启用', 'Game modules enabled')
          : t('游戏模块待命', 'Game modules idle'),
      ],
    },
    autonomy: {
      eyebrow: t('自主行为', 'Autonomous Behavior'),
      glyph: 'autonomy',
      description: activeSectionDescriptionById.autonomy,
      preview: [
        draft.autonomyEnabled ? t('自治引擎开启', 'Autonomy on') : t('自治引擎关闭', 'Autonomy off'),
        draft.autonomyEnabled && draft.autonomyDreamEnabled
          ? t('记忆整理开启', 'Dream enabled')
          : t('记忆整理关闭', 'Dream off'),
      ],
    },
  }
  const settingsHomeCards = settingsSectionOptions.map((section) => {
    const sectionMeta = settingsSectionMetaById[section.id]

    return {
      key: section.id,
      sectionId: section.id,
      title: section.label,
      eyebrow: sectionMeta.eyebrow,
      description: sectionMeta.description,
      glyph: sectionMeta.glyph,
      preview: sectionMeta.preview,
    }
  })
  const activeSectionMeta = settingsSectionMetaById[activeSectionId]
  const activeSectionDescription = activeSectionMeta.description
  // Sync draft from external settings ONLY when the drawer opens,
  // not while the user is actively editing.
   
  useEffect(() => {
    if (open) {
      console.info('[SettingsDrawer] SYNC draft from settings, provider:', settings.speechOutputProviderId)
      setDraft(settings)
      voiceClone.syncCloneName(settings.companionName)
      speechVoices.syncPreviewText(settings.companionName)
      setSettingsView('home')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on open transition, not settings changes
  }, [open])

  // Re-sync API keys when vault hydration completes after drawer is already open.
  // This handles the race where settings are loaded with empty keys before vault decrypts them.
   
  useEffect(() => {
    if (!open) return
    setDraft((current) => {
      const keyFields = ['apiKey', 'speechInputApiKey', 'speechOutputApiKey', 'voiceCloneApiKey', 'toolWebSearchApiKey'] as const
      let changed = false
      const patch = { ...current }
      for (const field of keyFields) {
        if (!current[field] && settings[field]) {
          ;(patch as Record<string, unknown>)[field] = settings[field]
          changed = true
        }
      }
      return changed ? patch : current
    })
  }, [open, settings.apiKey, settings.speechOutputApiKey, settings.speechInputApiKey, settings.voiceCloneApiKey, settings.toolWebSearchApiKey]) // eslint-disable-line react-hooks/exhaustive-deps -- only sync specific vault keys, not full settings

   
  useEffect(() => {
    if (!petModelPresets.length) return

    setDraft((current) => (
      petModelPresets.some((preset) => preset.id === current.petModelId)
        ? current
        : {
            ...current,
            petModelId: petModelPresets[0].id,
          }
    ))
  }, [petModelPresets])

  // Reset all transient state when drawer opens/closes or settings change
  useEffect(() => {
    connectionTests.resetConnectionTests()
    voiceClone.resetVoiceClone()
    petModel_.resetPetModelImport()
    speechVoices.resetSpeechVoices()
    chatHistory.resetChatHistory()
    memoryArchive.resetMemoryArchive()
    windowState.resetWindowState()
  }, [open, settings]) // eslint-disable-line react-hooks/exhaustive-deps -- reset functions are stable objects from custom hooks

  function applyTextProviderPreset(providerId: string) {
    setDraft((prev) => switchTextProvider(prev, providerId))
  }

  function applySpeechOutputPreset(providerId: string) {
    console.info('[SettingsDrawer] applySpeechOutputPreset:', providerId)
    setDraft((prev) => {
      const next = switchSpeechOutputProvider(prev, providerId)
      console.info('[SettingsDrawer] draft updated: prev provider:', prev.speechOutputProviderId, '→ next:', next.speechOutputProviderId)
      return next
    })
    speechVoices.applySpeechOutputPreset(providerId)
  }

  function applyVoiceClonePreset(providerId: string) {
    const preset = getVoiceCloneProviderPreset(providerId)

    setDraft((prev) => ({
      ...prev,
      voiceCloneProviderId: providerId,
      voiceCloneApiBaseUrl: preset.baseUrl || prev.voiceCloneApiBaseUrl,
    }))
  }

  function handleDismiss() {
    windowState.rollbackWindowState()
    onClose()
  }

  function handleOpenSettingsSection(sectionId: SettingsSectionId) {
    setActiveSectionId(sectionId)
    setSettingsView('section')
  }

  function handleReturnToSettingsHome() {
    setSettingsView('home')
  }

  if (!open) return null

  return (
    <div className="settings-backdrop" onClick={handleDismiss}>
      <aside
        className="settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t(`${settings.companionName} 设置面板`, `${settings.companionName} settings panel`)}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-drawer__header">
          <div className="settings-drawer__header-main">
            <div className="settings-drawer__title-stack">
              <h3 className="settings-drawer__window-title">
                <span className="settings-drawer__window-title-name">{draft.companionName}</span>
                <span className="settings-drawer__window-title-label">{t('设置', 'Settings')}</span>
              </h3>
            </div>

            <div className="settings-drawer__toolbar">
              <label className="settings-drawer__language-control">
                <select
                  value={draft.uiLanguage}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      uiLanguage: event.target.value as AppSettings['uiLanguage'],
                    }))
                  }
                >
                  {UI_LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.nativeLabel}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="ghost-button" onClick={handleDismiss}>
                {t('关闭', 'Close')}
              </button>
            </div>
          </div>
        </div>

        <div className="settings-drawer__body">
          {settingsView === 'home' ? (
            <div className="settings-home">
              {settingsHomeCards.map((card) => (
                <button
                  key={card.key}
                  type="button"
                  className="settings-home-card"
                  data-section={card.key}
                  onClick={() => handleOpenSettingsSection(card.sectionId)}
                >
                  <span className="settings-home-card__glyph" aria-hidden="true">
                    {renderSettingsCardIcon(card.glyph)}
                  </span>
                  <span className="settings-home-card__label">{card.title}</span>
                  <span className="settings-home-card__value">{card.preview[0] ?? ''}</span>
                  <span className="settings-home-card__chevron" aria-hidden="true">
                    <svg width="8" height="13" viewBox="0 0 8 13" fill="none">
                      <path d="M1 1l5.5 5.5L1 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="settings-page">
              <div className="settings-page__header">
                <button type="button" className="settings-page__back" onClick={handleReturnToSettingsHome}>
                  <span aria-hidden="true">{'<'}</span>
                  <span>{t('返回卡片', 'Back to cards')}</span>
                </button>

                <div className="settings-page__headline">
                  <p className="eyebrow">{activeSectionMeta.eyebrow}</p>
                  <h4>{activeSectionLabel}</h4>
                  <p className="settings-section__note">{activeSectionDescription}</p>
                </div>

              </div>

              <div className="settings-drawer__content settings-drawer__sections">

        <ConsoleSection
          active={activeSectionId === 'console'}
          continuousVoiceActive={continuousVoiceActive}
          debugConsoleEvents={debugConsoleEvents}
          liveTranscript={liveTranscript}
          onClearDebugConsole={onClearDebugConsole}
          reminderTasks={reminderTasks}
          speechLevel={speechLevel}
          uiLanguage={uiLanguage}
          voicePipeline={voicePipeline}
          voiceState={voiceState}
          voiceTrace={voiceTrace}
        />

        <ModelSection
          active={activeSectionId === 'model'}
          draft={draft}
          setDraft={setDraft}
          testingTarget={connectionTests.testingTarget}
          textProvider={textProvider}
          t={t}
          getProviderRegionLabel={getProviderRegionLabel}
          onApplyTextProviderPreset={applyTextProviderPreset}
          onRunTextConnectionTest={() => void connectionTests.runConnectionTest('text')}
          renderTextTestResult={() => connectionTests.renderTestResult('text')}
        />

        <ChatSection
          active={activeSectionId === 'chat'}
          draft={draft}
          setDraft={setDraft}
          setCloneName={voiceClone.setCloneName}
          petModelPresets={petModelPresets}
          importingPetModel={petModel_.importingPetModel}
          petModelStatus={petModel_.petModelStatus}
          onImportPetModel={() => void petModel_.handleImportPetModel()}
        />

        <HistorySection
          active={activeSectionId === 'history'}
          chatMessageCount={chatMessageCount}
          chatBusy={chatBusy}
          exportingChatHistory={chatHistory.exportingChatHistory}
          importingChatHistory={chatHistory.importingChatHistory}
          clearingChatHistory={chatHistory.clearingChatHistory}
          chatHistoryStatus={chatHistory.chatHistoryStatus}
          onExportChatHistory={() => void chatHistory.handleExportChatHistory()}
          onImportChatHistory={() => void chatHistory.handleImportChatHistory()}
          onClearChatHistory={() => void chatHistory.handleClearChatHistory()}
        />

        <MemorySection
          active={activeSectionId === 'memory'}
          draft={draft}
          setDraft={setDraft}
          memories={memories}
          dailyMemoryEntries={dailyMemoryEntries}
          uiLanguage={uiLanguage}
          memorySearchModeOptions={memorySearchModeOptions}
          selectedMemorySearchMode={selectedMemorySearchMode}
          selectedMemoryEmbeddingModel={selectedMemoryEmbeddingModel}
          exportingMemoryArchive={memoryArchive.exportingMemoryArchive}
          importingMemoryArchive={memoryArchive.importingMemoryArchive}
          clearingMemoryArchive={memoryArchive.clearingMemoryArchive}
          chatBusy={chatBusy}
          memoryArchiveStatus={memoryArchive.memoryArchiveStatus}
          onExportMemoryArchive={() => void memoryArchive.handleExportMemoryArchive()}
          onImportMemoryArchive={() => void memoryArchive.handleImportMemoryArchive()}
          onClearMemoryArchive={() => void memoryArchive.handleClearMemoryArchive()}
          onAddManualMemory={onAddManualMemory}
          onUpdateMemory={onUpdateMemory}
          onRemoveMemory={onRemoveMemory}
          onClearDailyMemory={onClearDailyMemory}
          onUpdateDailyEntry={onUpdateDailyEntry}
          onRemoveDailyEntry={onRemoveDailyEntry}
        />

        <VoiceSection
          active={activeSectionId === 'voice'}
          audioSmokeStatus={speechVoices.audioSmokeStatus}
          draft={draft}
          onRunAudioSmokeTest={() => void speechVoices.handleRunAudioSmokeTest()}
          previewingSpeech={speechVoices.previewingSpeech}
          runningAudioSmoke={speechVoices.runningAudioSmoke}
          setDraft={setDraft}
          testingTarget={connectionTests.testingTarget}
          uiLanguage={uiLanguage}
        />

        <SpeechInputSection
          active={activeSectionId === 'voice'}
          draft={draft}
          setDraft={setDraft}
          testingTarget={connectionTests.testingTarget}
          onRunSpeechInputConnectionTest={() => void connectionTests.runConnectionTest('speech-input')}
          renderSpeechInputTestResult={() => connectionTests.renderTestResult('speech-input')}
        />

        <SpeechOutputSection
          active={activeSectionId === 'voice'}
          draft={draft}
          setDraft={setDraft}
          speechVoiceOptions={speechVoices.speechVoiceOptions}
          speechVoiceStatus={speechVoices.speechVoiceStatus}
          loadingSpeechVoices={speechVoices.loadingSpeechVoices}
          speechPreviewText={speechVoices.speechPreviewText}
          setSpeechPreviewText={speechVoices.setSpeechPreviewText}
          speechPreviewStatus={speechVoices.speechPreviewStatus}
          previewingSpeech={speechVoices.previewingSpeech}
          testingTarget={connectionTests.testingTarget}
          onApplySpeechOutputPreset={applySpeechOutputPreset}
          onLoadSpeechVoices={() => void speechVoices.handleLoadSpeechVoices()}
          onPreviewSpeech={() => void speechVoices.handlePreviewSpeech()}
          onRunSpeechOutputConnectionTest={() => void connectionTests.runConnectionTest('speech-output')}
          renderSpeechOutputTestResult={() => connectionTests.renderTestResult('speech-output')}
        />

        <CloneSection
          active={activeSectionId === 'voice'}
          draft={draft}
          setDraft={setDraft}
          testingTarget={connectionTests.testingTarget}
          cloneFiles={voiceClone.cloneFiles}
          cloneName={voiceClone.cloneName}
          cloneDescription={voiceClone.cloneDescription}
          removeBackgroundNoise={voiceClone.removeBackgroundNoise}
          cloningVoice={voiceClone.cloningVoice}
          cloneStatus={voiceClone.cloneStatus}
          voiceCloneProvider={voiceCloneProvider}
          applyVoiceClonePreset={applyVoiceClonePreset}
          setCloneFiles={voiceClone.setCloneFiles}
          setCloneName={voiceClone.setCloneName}
          setCloneDescription={voiceClone.setCloneDescription}
          setRemoveBackgroundNoise={voiceClone.setRemoveBackgroundNoise}
          onRunVoiceCloneConnectionTest={() => void connectionTests.runConnectionTest('voice-clone')}
          onCloneVoice={() => void voiceClone.handleCloneVoice()}
          renderVoiceCloneTestResult={() => connectionTests.renderTestResult('voice-clone')}
        />

        <WindowSection
          active={activeSectionId === 'window'}
          draft={draft}
          petWindowState={windowState.petWindowState}
          setDraft={setDraft}
          uiLanguage={uiLanguage}
          updateWindowState={windowState.updateWindowState}
          windowStatusMessage={windowState.windowStatusMessage}
        />

        <IntegrationsSection
          active={activeSectionId === 'integrations'}
          draft={draft}
          setDraft={setDraft}
          uiLanguage={uiLanguage}
        />

        <AutonomySection
          active={activeSectionId === 'autonomy'}
          draft={draft}
          setDraft={setDraft}
          channels={notificationChannels}
          channelsLoading={notificationChannelsLoading}
          onAddChannel={onAddNotificationChannel}
          onUpdateChannel={onUpdateNotificationChannel}
          onRemoveChannel={onRemoveNotificationChannel}
        />

        <ContextSection
          active={activeSectionId === 'console'}
          draft={draft}
          setDraft={setDraft}
          reminderTasks={reminderTasks}
          uiLanguage={uiLanguage}
          onAddReminderTask={onAddReminderTask}
          onUpdateReminderTask={onUpdateReminderTask}
          onRemoveReminderTask={onRemoveReminderTask}
        />
              </div>
            </div>
          )}
        </div>

      <div className="settings-drawer__actions">
        <button type="button" className="ghost-button" onClick={handleDismiss}>
          {t('取消', 'Cancel')}
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() =>
            onSave({
              ...draft,
              proactivePresenceIntervalMinutes: clampPresenceIntervalMinutes(
                draft.proactivePresenceIntervalMinutes,
              ),
            })}
        >
          {t('保存设置', 'Save settings')}
        </button>
      </div>
      </aside>
    </div>
  )
}

