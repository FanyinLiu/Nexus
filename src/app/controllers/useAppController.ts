import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getInitialPanelSection,
  getWindowView,
  getWindowViewSync,
} from '../appSupport'
import { subscribeToSettings } from '../store/settingsStore'
import {
  loadPetWindowPreferences,
} from '../../lib'
import type {
  AppSettings,
  ChatMessage,
  PanelWindowState,
  ReminderTask,
  VoiceState,
  WindowView,
} from '../../types'
import {
  useChat,
  useDesktopContext,
  useGameIntegration,
  useMemory,
  usePetBehavior,
  useReminderScheduler,
  useVoice,
} from '../../hooks'
import { shouldRunReminderScheduler } from '../../features/reminders'
import {
  buildBuiltInToolSpeechSummary,
  executeBuiltInTool,
  resolveBuiltInToolPolicy,
  toChatToolResult,
} from '../../features/tools'
import { getSettingsSnapshot, initializeSettingsWithVault } from '../store/settingsStore'
import { useAppOverlays } from './useAppOverlays'
import { useAutonomyController } from './useAutonomyController'
import { useDebugConsole } from './useDebugConsole'
import { useDesktopBridge } from './useDesktopBridge'
import { useMediaSessionController } from './useMediaSessionController'
import { useReminderTaskStore } from './useReminderTaskStore'
import { commitSettingsUpdate } from '../store/commitSettingsUpdate'

type ChatController = ReturnType<typeof useChat>
type ReminderTaskStore = ReturnType<typeof useReminderTaskStore>

export function useAppController() {
  const [view, setView] = useState<WindowView>(() => getWindowViewSync())
  const [settings, setSettings] = useState<AppSettings>(() => getSettingsSnapshot())
  const [settingsOpen, setSettingsOpen] = useState(
    () => view === 'panel' && getInitialPanelSection() === 'settings',
  )

  // Refine view from async preload bridge (only matters inside Electron)
  useEffect(() => {
    void getWindowView().then((resolved) => {
      if (resolved !== view) setView(resolved)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [panelWindowState, setPanelWindowState] = useState<PanelWindowState>({ collapsed: false })
  const initialPrefs = loadPetWindowPreferences()
  const [isPinned, setIsPinned] = useState(initialPrefs.isPinned)
  const [clickThrough, setClickThrough] = useState(initialPrefs.clickThrough)

  // Sync React state when settings change in storage (after save or external update)
  useEffect(() => {
    return subscribeToSettings((updated) => {
      setSettings(updated)
    })
  }, [])

  const settingsRef = useRef(settings)
  const settingsOpenRef = useRef(view === 'panel' && getInitialPanelSection() === 'settings')
  const busyRef = useRef(false)
  const inputRef = useRef('')
  const messagesRef = useRef<ChatMessage[]>([])
  const voiceStateRef = useRef<VoiceState>('idle')
  const continuousVoiceActiveRef = useRef(false)
  const addReminderTaskFnRef = useRef<ReminderTaskStore['addReminderTask'] | null>(null)
  const updateReminderTaskFnRef = useRef<ReminderTaskStore['updateReminderTask'] | null>(null)
  const removeReminderTaskFnRef = useRef<ReminderTaskStore['removeReminderTask'] | null>(null)
  const setErrorRef = useRef<ChatController['setError']>(() => {})
  const setInputFnRef = useRef<ChatController['setInput']>(() => {})
  const appendSystemMessageRef = useRef<ChatController['appendSystemMessage']>(() => {})
  const sendMessageRef = useRef<ChatController['sendMessage']>(async () => false)

  useEffect(() => {
    initializeSettingsWithVault()
      .then((hydrated) => setSettings(hydrated))
      .catch(() => { /* vault unavailable — settings loaded without keys */ })
  }, [])

  const reminderTaskStore = useReminderTaskStore()
  const debugConsole = useDebugConsole()
  const memory = useMemory({ settings })
  const desktopContext = useDesktopContext({ settingsRef })
  useGameIntegration({ settingsRef })
  const pet = usePetBehavior({
    settingsRef,
    busyRef,
    voiceStateRef,
    continuousVoiceActiveRef,
    settingsOpenRef,
    inputRef,
    messagesRef,
    memoriesRef: memory.memoriesRef,
    view,
  })

  const panelCollapsed = panelWindowState.collapsed

  const applyPanelWindowState = useCallback(async (partialState: Partial<PanelWindowState>) => {
    if (!window.desktopPet?.setPanelWindowState) {
      setPanelWindowState((current) => ({ ...current, ...partialState }))
      return
    }

    try {
      const nextState = await window.desktopPet.setPanelWindowState(partialState)
      setPanelWindowState(nextState)
    } catch {
      setPanelWindowState((current) => ({ ...current, ...partialState }))
    }
  }, [])

  const togglePanelCollapse = useCallback(() => {
    const nextCollapsed = !panelCollapsed
    if (nextCollapsed) {
      setSettingsOpen(false)
    }
    void applyPanelWindowState({ collapsed: nextCollapsed })
  }, [applyPanelWindowState, panelCollapsed])

  const openSettingsPanel = useCallback(() => {
    if (view === 'pet') {
      const pending = window.desktopPet?.openPanel?.('settings')
      pending?.catch(() => undefined)
      return
    }

    if (panelCollapsed) {
      void applyPanelWindowState({ collapsed: false })
    }
    setSettingsOpen(true)
  }, [applyPanelWindowState, panelCollapsed, view])

  const openChatPanelForVoice = useCallback(() => {
    if (view === 'panel') {
      setSettingsOpen(false)
      return
    }

    const pending = window.desktopPet?.openPanel?.('chat')
    pending?.catch(() => undefined)
  }, [view])

  const closePanel = useCallback(() => {
    const pending = window.desktopPet?.closePanel?.()
    pending?.catch(() => undefined)
  }, [])

  const openPetMenu = useCallback(() => {
    const pending = window.desktopPet?.openPetMenu?.()
    pending?.catch(() => undefined)
  }, [])

  const togglePinned = useCallback(() => {
    setIsPinned((current) => !current)
  }, [])

  const toggleClickThrough = useCallback(() => {
    setClickThrough((current) => !current)
  }, [])

  const toggleContinuousVoiceMode = useCallback(() => {
    void commitSettingsUpdate(
      (current) => ({
        ...current,
        continuousVoiceModeEnabled: !current.continuousVoiceModeEnabled,
      }),
      (nextSettings) => {
        settingsRef.current = nextSettings
        setSettings(nextSettings)
      },
    )
  }, [])

  const voice = useVoice({
    settings,
    settingsRef,
    applySettingsUpdate: (update) => commitSettingsUpdate(update, (nextSettings) => {
      settingsRef.current = nextSettings
      setSettings(nextSettings)
    }),
    busyRef,
    view,
    setMood: pet.setMood,
    updatePetStatus: pet.updatePetStatus,
    setError: (error) => setErrorRef.current(error),
    markPresenceActivity: pet.markPresenceActivity,
    openChatPanelForVoice,
    inputRef,
    setInput: (value) => setInputFnRef.current(value),
    setSettings,
    sendMessageRef,
    appendSystemMessage: (content, tone) => appendSystemMessageRef.current(content, tone),
  })

  const chat = useChat({
    settingsRef,
    setSettings,
    applySettingsUpdate: (update) => commitSettingsUpdate(update, (nextSettings) => {
      settingsRef.current = nextSettings
      setSettings(nextSettings)
    }),
    memoriesRef: memory.memoriesRef,
    dailyMemoriesRef: memory.dailyMemoriesRef,
    setMemories: memory.setMemories,
    appendDailyMemoryEntries: memory.appendDailyMemoryEntries,
    setMood: pet.setMood,
    updatePetStatus: pet.updatePetStatus,
    clearPetPerformanceCue: pet.clearPetPerformanceCue,
    queuePetPerformanceCue: pet.queuePetPerformanceCue,
    markPresenceActivity: pet.markPresenceActivity,
    voiceStateRef: voice.voiceStateRef,
    suppressVoiceReplyRef: voice.suppressVoiceReplyRef,
    setVoiceState: voice.setVoiceState,
    setLiveTranscript: voice.setLiveTranscript,
    updateVoicePipeline: voice.updateVoicePipeline,
    appendVoiceTrace: voice.appendVoiceTrace,
    speakAssistantReply: voice.speakAssistantReply,
    beginStreamingSpeechReply: voice.beginStreamingSpeechReply,
    scheduleVoiceRestart: voice.scheduleVoiceRestart,
    busEmit: voice.busEmit,
    shouldAutoRestartVoice: voice.shouldAutoRestartVoice,
    clearPendingVoiceRestart: voice.clearPendingVoiceRestart,
    resetNoSpeechRestartCount: voice.resetNoSpeechRestartCount,
    setContinuousVoiceSession: voice.setContinuousVoiceSession,
    fillComposerWithVoiceTranscript: voice.fillComposerWithVoiceTranscript,
    stopActiveSpeechOutput: voice.stopActiveSpeechOutput,
    canInterruptSpeech: () => settingsRef.current.voiceInterruptionEnabled,
    loadDesktopContextSnapshot: desktopContext.loadDesktopContextSnapshot,
    reminderTasksRef: reminderTaskStore.reminderTasksRef,
    addReminderTask: (input) => addReminderTaskFnRef.current?.(input) ?? null,
    updateReminderTask: (id, updates) => updateReminderTaskFnRef.current?.(id, updates) ?? null,
    removeReminderTask: (id) => removeReminderTaskFnRef.current?.(id) ?? null,
    appendDebugConsoleEvent: debugConsole.appendDebugConsoleEvent,
  })

  useEffect(() => {
    sendMessageRef.current = chat.sendMessage
  }, [chat.sendMessage])

  useEffect(() => {
    setErrorRef.current = chat.setError
    setInputFnRef.current = chat.setInput
    appendSystemMessageRef.current = chat.appendSystemMessage
  }, [chat.appendSystemMessage, chat.setError, chat.setInput])

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    settingsOpenRef.current = settingsOpen
  }, [settingsOpen])

  useEffect(() => {
    busyRef.current = chat.busy
  }, [chat.busy])

  useEffect(() => {
    inputRef.current = chat.input
  }, [chat.input])

  useEffect(() => {
    messagesRef.current = chat.messages
  }, [chat.messages])

  useEffect(() => {
    voiceStateRef.current = voice.voiceState
  }, [voice.voiceState])

  useEffect(() => {
    addReminderTaskFnRef.current = reminderTaskStore.addReminderTask
    updateReminderTaskFnRef.current = reminderTaskStore.updateReminderTask
    removeReminderTaskFnRef.current = reminderTaskStore.removeReminderTask
  }, [
    reminderTaskStore.addReminderTask,
    reminderTaskStore.removeReminderTask,
    reminderTaskStore.updateReminderTask,
  ])

  const {
    runtimeSnapshot,
    petRuntimeContinuousVoiceActive,
    remotePanelSettingsOpen,
    petModelPresets,
    petModel,
    loadPetModels,
  } = useDesktopBridge({
    view,
    settings,
    setSettings,
    settingsOpen,
    setSettingsOpen,
    setPanelWindowState,
    panelCollapsed,
    applyPanelWindowState,
    isPinned,
    setIsPinned,
    clickThrough,
    setClickThrough,
    reminderTasks: reminderTaskStore.reminderTasks,
    setReminderTasks: reminderTaskStore.setReminderTasks,
    setDebugConsoleEvents: debugConsole.setDebugConsoleEvents,
    memory,
    chat,
    pet,
    voice,
  })

  useEffect(() => {
    continuousVoiceActiveRef.current = (
      voice.continuousVoiceActive
      || (view === 'panel' && petRuntimeContinuousVoiceActive && !voice.continuousVoiceActive)
    )
  }, [petRuntimeContinuousVoiceActive, view, voice.continuousVoiceActive])

  const handleReminderTaskTrigger = useCallback(async (task: ReminderTask) => {
    const displayText = task.prompt.trim()
    const action = task.action
    const currentSettings = settingsRef.current
    const defaultSpeechText = task.speechText?.trim() || `${task.title}提醒，${task.prompt.trim()}`

    debugConsole.appendDebugConsoleEvent({
      source: 'tool',
      title: '开始执行自动任务',
      detail: `${task.title} / ${action.kind === 'notice' ? '通知' : action.kind === 'weather' ? '天气' : '搜索'}`,
      relatedTaskId: task.id,
    })

    try {
      if (action.kind === 'notice') {
        await chat.pushCompanionNotice({
          chatContent: `【自动任务】${task.title}\n${displayText}`,
          bubbleContent: displayText,
          speechContent: defaultSpeechText,
          autoHideMs: 16_000,
        })
        debugConsole.appendDebugConsoleEvent({
          source: 'tool',
          title: '自动提醒已发出',
          detail: `${task.title} / 下一次时间可在任务快照里查看`,
          tone: 'success',
          relatedTaskId: task.id,
        })
        return
      }

      if (action.kind === 'weather') {
        const policy = resolveBuiltInToolPolicy('weather', currentSettings)
        if (!policy.enabled) {
          chat.appendSystemMessage(`本地自动任务「${task.title}」没有执行：天气工具当前已关闭。`, 'error')
          debugConsole.appendDebugConsoleEvent({
            source: 'tool',
            title: '自动任务被跳过',
            detail: `${task.title} / 天气工具当前已关闭`,
            tone: 'error',
            relatedTaskId: task.id,
          })
          return
        }

        const result = await executeBuiltInTool(
          {
            id: 'weather',
            location: action.location,
          },
          policy,
          currentSettings,
        )

        await chat.pushCompanionNotice({
          chatContent: `【自动任务】${task.title}\n${result.assistantSummary}`,
          bubbleContent: result.assistantSummary,
          speechContent: task.speechText?.trim() || buildBuiltInToolSpeechSummary(result),
          autoHideMs: 18_000,
          toolResult: toChatToolResult(result),
        })
        debugConsole.appendDebugConsoleEvent({
          source: 'tool',
          title: '自动天气任务已完成',
          detail: `${task.title} / ${result.kind === 'weather' ? result.result.resolvedName : action.location || '默认地点'}`,
          tone: 'success',
          relatedTaskId: task.id,
        })
        return
      }

      const policy = resolveBuiltInToolPolicy('web_search', currentSettings)
      if (!policy.enabled) {
        chat.appendSystemMessage(`本地自动任务「${task.title}」没有执行：网页搜索工具当前已关闭。`, 'error')
        debugConsole.appendDebugConsoleEvent({
          source: 'tool',
          title: '自动任务被跳过',
          detail: `${task.title} / 搜索工具当前已关闭`,
          tone: 'error',
          relatedTaskId: task.id,
        })
        return
      }

      const result = await executeBuiltInTool(
        {
          id: 'web_search',
          query: action.query,
          limit: action.limit ?? 5,
        },
        policy,
        currentSettings,
      )

      await chat.pushCompanionNotice({
        chatContent: `【自动任务】${task.title}\n${result.assistantSummary}`,
        bubbleContent: result.assistantSummary,
        speechContent: task.speechText?.trim() || buildBuiltInToolSpeechSummary(result),
        autoHideMs: 18_000,
        toolResult: toChatToolResult(result),
      })
      debugConsole.appendDebugConsoleEvent({
        source: 'tool',
        title: '自动搜索任务已完成',
        detail: `${task.title} / ${result.kind === 'web_search' ? result.result.query : action.query}`,
        tone: 'success',
        relatedTaskId: task.id,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '自动任务执行失败。'
      chat.appendSystemMessage(`本地自动任务「${task.title}」执行失败：${errorMessage}`, 'error')
      pet.updatePetStatus(`自动任务失败：${task.title}`, 3200)
      debugConsole.appendDebugConsoleEvent({
        source: 'tool',
        title: '自动任务执行失败',
        detail: `${task.title} / ${errorMessage}`,
        tone: 'error',
        relatedTaskId: task.id,
      })
    }
  }, [chat, debugConsole, pet])

  useReminderScheduler({
    enabled: shouldRunReminderScheduler(view, runtimeSnapshot),
    tasks: reminderTaskStore.reminderTasks,
    setTasks: reminderTaskStore.setReminderTasks,
    onTrigger: handleReminderTaskTrigger,
    onEvent: debugConsole.appendDebugConsoleEvent,
  })

  // ── Autonomy subsystem ──────────────────────────────────────────────────────

  const autonomy = useAutonomyController({
    settings,
    settingsRef,
    messagesRef,
    memory,
    reminderTasksRef: reminderTaskStore.reminderTasksRef,
    chat,
    debugConsole,
  })

  // Wake autonomy when user sends a chat message
  const originalSendMessage = chat.sendMessage
  const autonomyAwareSendMessage = useCallback(async (...args: Parameters<typeof originalSendMessage>) => {
    autonomy.focusAwareness.markActive()
    autonomy.autonomyTick.wakeUp()
    const result = await originalSendMessage(...args)
    if (result) {
      autonomy.memoryDream.incrementSessionCount()
    }
    return result
  }, [originalSendMessage, autonomy.focusAwareness, autonomy.autonomyTick, autonomy.memoryDream])

  // Patch chat.sendMessage with autonomy-aware wrapper
  const chatWithAutonomy = useMemo(() => ({
    ...chat,
    sendMessage: autonomyAwareSendMessage,
  }), [chat, autonomyAwareSendMessage])

  const mediaSessionController = useMediaSessionController({
    view,
    appendSystemMessage: chat.appendSystemMessage,
  })

  const { overlays } = useAppOverlays({
    view,
    settings,
    setSettings,
    settingsOpen,
    setSettingsOpen,
    petModelPresets,
    petRuntimeContinuousVoiceActive,
    reminderTasks: reminderTaskStore.reminderTasks,
    debugConsoleEvents: debugConsole.debugConsoleEvents,
    loadPetModels,
    memory,
    chat: chatWithAutonomy,
    pet,
    voice,
    addReminderTask: reminderTaskStore.addReminderTask,
    updateReminderTask: reminderTaskStore.updateReminderTask,
    removeReminderTask: reminderTaskStore.removeReminderTask,
    clearDebugConsoleEvents: debugConsole.clearDebugConsoleEvents,
    notificationChannels: autonomy.notificationBridge.channels,
    notificationChannelsLoading: autonomy.notificationBridge.channelsLoading,
    onAddNotificationChannel: autonomy.notificationBridge.addChannel,
    onUpdateNotificationChannel: autonomy.notificationBridge.updateChannel,
    onRemoveNotificationChannel: autonomy.notificationBridge.removeChannel,
  })

  return {
    view,
    overlays,
    petView: {
      settings,
      petModel,
      pet,
      voice,
      chat: chatWithAutonomy,
      isPinned,
      clickThrough,
      runtimeSnapshot,
      mediaSession: mediaSessionController.mediaSession,
      musicActionBusy: mediaSessionController.musicActionBusy,
      dismissedMusicSessionKey: mediaSessionController.dismissedMusicSessionKey,
      remotePanelSettingsOpen,
      openSettingsPanel,
      openChatPanelForVoice,
      openPetMenu,
      togglePinned,
      toggleClickThrough,
      toggleContinuousVoiceMode,
      handleMediaSessionControl: mediaSessionController.handleMediaSessionControl,
      dismissCurrentMediaSession: mediaSessionController.dismissCurrentMediaSession,
      startMediaPolling: mediaSessionController.startMediaPolling,
      autonomyState: autonomy.autonomyTick.autonomyState,
      focusState: autonomy.focusAwareness.focusState,
      notificationUnreadCount: autonomy.notificationBridge.unreadCount,
    },
    panelView: {
      settings,
      petModel,
      memory,
      pet,
      voice,
      chat: chatWithAutonomy,
      runtimeSnapshot,
      petRuntimeContinuousVoiceActive,
      panelCollapsed,
      openSettingsPanel,
      togglePanelCollapse,
      closePanel,
      autonomyState: autonomy.autonomyTick.autonomyState,
      focusState: autonomy.focusAwareness.focusState,
      notificationBridge: autonomy.notificationBridge,
      contextScheduler: autonomy.contextScheduler,
    },
  }
}

export type UseAppControllerResult = ReturnType<typeof useAppController>
