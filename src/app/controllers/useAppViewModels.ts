// Owns everything the renderer consumes from the controller tail: the media
// session controller, the overlay models and the pet/panel view models.
// Extracted from useAppController without behavior change; the hook call order
// media session -> overlays -> view memos is preserved.

import { useMemo, type Dispatch, type SetStateAction } from 'react'
import type { AppSettings, WindowView } from '../../types'
import { useAppOverlays } from './useAppOverlays.ts'
import { useMediaSessionController } from './useMediaSessionController.ts'

type AutonomyController = ReturnType<typeof import('./useAutonomyController').useAutonomyController>
type ChatController = ReturnType<typeof import('../../hooks/useChat').useChat>
type DebugConsoleController = ReturnType<typeof import('./useDebugConsole').useDebugConsole>
type DesktopBridgeController = ReturnType<typeof import('./useDesktopBridge').useDesktopBridge>
type MemoryController = ReturnType<typeof import('../../hooks/useMemory').useMemory>
type PetController = ReturnType<typeof import('../../hooks/usePetBehavior').usePetBehavior>
type ReminderTaskStore = ReturnType<typeof import('./useReminderTaskStore').useReminderTaskStore>
type SettingsNavigation = ReturnType<typeof import('./useSettingsNavigation').useSettingsNavigation>
type VoiceController = ReturnType<typeof import('../../hooks/useVoice').useVoice>
type WindowChromeActions = ReturnType<typeof import('./useWindowChromeActions').useWindowChromeActions>

type UseAppViewModelsOptions = {
  autonomy: AutonomyController
  chatWithAutonomy: ChatController
  clickThrough: boolean
  closePanel: WindowChromeActions['closePanel']
  debugConsole: DebugConsoleController
  isPinned: boolean
  loadPetModels: DesktopBridgeController['loadPetModels']
  memory: MemoryController
  openChatPanelForVoice: SettingsNavigation['openChatPanelForVoice']
  openPetMenu: WindowChromeActions['openPetMenu']
  openSettingsPanel: SettingsNavigation['openSettingsPanel']
  openSettingsSection: SettingsNavigation['openSettingsSection']
  panelCollapsed: boolean
  pet: PetController
  petModel: DesktopBridgeController['petModel']
  petModelPresets: DesktopBridgeController['petModelPresets']
  petModelPresetsReady: DesktopBridgeController['petModelPresetsReady']
  petModelSelectionResolved: DesktopBridgeController['petModelSelectionResolved']
  petRuntimeContinuousVoiceActive: boolean
  platformProfile: DesktopBridgeController['platformProfile']
  preferredMemoryFocus: SettingsNavigation['preferredMemoryFocus']
  preferredSettingsSectionId: SettingsNavigation['preferredSettingsSectionId']
  remotePanelSettingsOpen: DesktopBridgeController['remotePanelSettingsOpen']
  reminderTaskStore: ReminderTaskStore
  runtimeSnapshot: DesktopBridgeController['runtimeSnapshot']
  setSettings: Dispatch<SetStateAction<AppSettings>>
  setSettingsOpen: SettingsNavigation['setSettingsOpen']
  settings: AppSettings
  settingsRef: { current: AppSettings }
  settingsOpen: boolean
  toggleClickThrough: WindowChromeActions['toggleClickThrough']
  toggleContinuousVoiceMode: WindowChromeActions['toggleContinuousVoiceMode']
  togglePanelCollapse: WindowChromeActions['togglePanelCollapse']
  togglePinned: WindowChromeActions['togglePinned']
  view: WindowView
  voice: VoiceController
}

export function useAppViewModels({
  autonomy,
  chatWithAutonomy,
  clickThrough,
  closePanel,
  debugConsole,
  isPinned,
  loadPetModels,
  memory,
  openChatPanelForVoice,
  openPetMenu,
  openSettingsPanel,
  openSettingsSection,
  panelCollapsed,
  pet,
  petModel,
  petModelPresets,
  petModelPresetsReady,
  petModelSelectionResolved,
  petRuntimeContinuousVoiceActive,
  platformProfile,
  preferredMemoryFocus,
  preferredSettingsSectionId,
  remotePanelSettingsOpen,
  reminderTaskStore,
  runtimeSnapshot,
  setSettings,
  setSettingsOpen,
  settings,
  settingsRef,
  settingsOpen,
  toggleClickThrough,
  toggleContinuousVoiceMode,
  togglePanelCollapse,
  togglePinned,
  view,
  voice,
}: UseAppViewModelsOptions) {
  const mediaSessionController = useMediaSessionController({
    view,
    platformProfile,
    appendSystemMessage: chatWithAutonomy.appendSystemMessage,
  })

  const { overlays } = useAppOverlays({
    view,
    settings,
    settingsRef,
    platformProfile,
    setSettings,
    settingsOpen,
    preferredSettingsSectionId,
    preferredMemoryFocus,
    setSettingsOpen,
    petModelPresets,
    petModelPresetsReady,
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

  const petView = useMemo(() => ({
    settings,
    petModel,
    petModelSelectionResolved,
    pet,
    voice,
    chat: chatWithAutonomy,
    isPinned,
    clickThrough,
    runtimeSnapshot,
    mediaSession: mediaSessionController.mediaSession,
    musicActionBusy: mediaSessionController.musicActionBusy,
    dismissedMusicSessionKey: mediaSessionController.dismissedMusicSessionKey,
    remotePanelSettingsOpen: remotePanelSettingsOpen || (view === 'pet' && settingsOpen),
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
  }), [
    settings,
    petModel,
    petModelSelectionResolved,
    pet,
    voice,
    chatWithAutonomy,
    isPinned,
    clickThrough,
    runtimeSnapshot,
    mediaSessionController.mediaSession,
    mediaSessionController.musicActionBusy,
    mediaSessionController.dismissedMusicSessionKey,
    remotePanelSettingsOpen,
    settingsOpen,
    view,
    openSettingsPanel,
    openChatPanelForVoice,
    openPetMenu,
    togglePinned,
    toggleClickThrough,
    toggleContinuousVoiceMode,
    mediaSessionController.handleMediaSessionControl,
    mediaSessionController.dismissCurrentMediaSession,
    mediaSessionController.startMediaPolling,
    autonomy.autonomyTick.autonomyState,
    autonomy.focusAwareness.focusState,
    autonomy.notificationBridge.unreadCount,
  ])

  const panelView = useMemo(() => ({
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
    openSettingsSection,
    togglePanelCollapse,
    closePanel,
    autonomyState: autonomy.autonomyTick.autonomyState,
    focusState: autonomy.focusAwareness.focusState,
    notificationBridge: autonomy.notificationBridge,
    contextScheduler: autonomy.contextScheduler,
    replyToTelegram: autonomy.replyToTelegram,
    replyToDiscord: autonomy.replyToDiscord,
  }), [
    settings,
    petModel,
    memory,
    pet,
    voice,
    chatWithAutonomy,
    runtimeSnapshot,
    petRuntimeContinuousVoiceActive,
    panelCollapsed,
    openSettingsPanel,
    openSettingsSection,
    togglePanelCollapse,
    closePanel,
    autonomy.autonomyTick.autonomyState,
    autonomy.focusAwareness.focusState,
    autonomy.notificationBridge,
    autonomy.contextScheduler,
    autonomy.replyToTelegram,
    autonomy.replyToDiscord,
  ])

  return {
    overlays,
    panelView,
    petView,
  }
}
