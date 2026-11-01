// @ts-nocheck
import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { getRedactedErrorMessage } from './services/errorRedaction.js'
import { synthesizeRemoteTts, warmupRemoteTtsSession } from './services/ttsService.js'
import { createTtsStreamService } from './ttsStreamService.js'
import { createCompanionPresenceTracker } from './companionPresenceTracker.js'
import { buildRuntimeStateSnapshot, updateRuntimeState } from './windowRuntimeState.js'

import { installIpcChannelBinding, requireTrustedSender } from './ipc/validate.js'
import * as windowIpc from './ipc/windowIpc.js'
import * as chatIpc from './ipc/chatIpc.js'
import * as audioIpc from './ipc/audioIpc.js'
import * as ttsStreamIpc from './ipc/ttsStreamIpc.js'
import * as serviceIpc from './ipc/serviceIpc.js'
import * as telegramIpc from './ipc/telegramIpc.js'
import * as discordIpc from './ipc/discordIpc.js'
import * as vaultIpc from './ipc/vaultIpc.js'
import * as vtsBridgeIpc from './ipc/vtsBridgeIpc.js'
import * as personaIpc from './ipc/personaIpc.js'
import * as updaterIpc from './ipc/updaterIpc.js'
import * as sherpaIpc from './ipc/sherpaIpc.js'
import * as voiceProfileIpc from './ipc/voiceProfileIpc.js'
import * as notificationIpc from './ipc/notificationIpc.js'
import * as proactiveNotificationIpc from './ipc/proactiveNotificationIpc.js'
import * as proactiveIpc from './ipc/proactiveIpc.js'
import { getBoundWindowCapability } from './ipc/windowCapabilities.js'
import * as reminderStrip from './services/reminderStrip.js'
import { showProactiveNotification } from './services/proactiveNotification.js'
import { createProactiveDeliveryContextProvider } from './services/proactiveDeliveryContext.js'
import * as mcpIpc from './ipc/mcpIpc.js'
import * as externalActionPolicyIpc from './ipc/externalActionPolicyIpc.js'
import * as voiceRuntimeIpc from './ipc/voiceRuntimeIpc.js'
import * as localDataIpc from './ipc/localDataIpc.js'
import * as desktopPresenceIpc from './ipc/desktopPresenceIpc.js'

const CHAT_REQUEST_TIMEOUT_MS = 25_000
const CONNECTION_TEST_TIMEOUT_MS = 12_000
const AUDIO_TRANSCRIBE_TIMEOUT_MS = 20_000
const AUDIO_VOICE_LIST_TIMEOUT_MS = 15_000

// Matches the renderer focus-awareness default (autonomyIdleThresholdSeconds).
const FOCUS_IDLE_THRESHOLD_SECONDS = 300

const activeChatStreamControllers = new Map()

// The main process owns companion presence: it is computed from the chat
// request lifecycle and broadcast through the runtime-state channel. The mood
// mirror rides whatever the renderer last reported.
const companionPresence = createCompanionPresenceTracker({
  publishPresence: (presence) => updateRuntimeState({ companionPresence: presence }),
  getMood: () => buildRuntimeStateSnapshot().mood,
})

// Lazy-loaded modules — loaded on first use, not at startup.
// Anything the renderer might invoke immediately on mount must go through the
// eager `registerIpc()` path instead; a deferred registration produces
// "No handler registered" errors during the first ~1.5s of startup. Known
// offenders already moved out: sherpaIpc (kws:status), notificationIpc
// (notification:get-channels via useNotificationBridge), and — as of this
// change — mcpIpc (mcp:sync-servers via useMcpServerSync on App mount).
let _deferredModulesPromise = null

function loadDeferredModules() {
  if (!_deferredModulesPromise) {
    _deferredModulesPromise = Promise.all([
      import('./ipc/pluginIpc.js'),
      import('./ipc/memoryIpc.js'),
      import('./ipc/skillIpc.js'),
    ]).then(async ([pluginIpc, memoryIpc, skillIpc]) => {
      const ttsStreamService = createTtsStreamService({
        synthesizeRemote: synthesizeRemoteTts,
        warmupRemote: warmupRemoteTtsSession,
      })

      ttsStreamIpc.register({ ttsStreamService })
      pluginIpc.register()
      memoryIpc.register({ clearProactiveInbox: proactiveIpc.clearProactiveInbox })
      skillIpc.register()

      console.info('[IPC] Deferred modules loaded')
    }).catch((error) => {
      // A failed dynamic import or register() must not leave the promise
      // permanently rejected with no trace: that turned one bad module into
      // "No handler registered" for the tts/plugin/memory/skill IPC groups
      // until restart, with no logged root cause. Log the (redacted) cause
      // and reset the cached promise so the next call retries the load.
      _deferredModulesPromise = null
      console.error('[IPC] Failed to load deferred modules:', getRedactedErrorMessage(error))
    })
  }
  return _deferredModulesPromise
}

export function registerIpc(options = {}) {
  installIpcChannelBinding()
  windowIpc.register()

  chatIpc.register({
    activeChatStreamControllers,
    CHAT_REQUEST_TIMEOUT_MS,
    CONNECTION_TEST_TIMEOUT_MS,
    companionPresence,
  })

  audioIpc.register({
    AUDIO_TRANSCRIBE_TIMEOUT_MS,
    AUDIO_VOICE_LIST_TIMEOUT_MS,
  })

  serviceIpc.register()
  telegramIpc.register()
  discordIpc.register()
  vaultIpc.register()
  vtsBridgeIpc.register()
  personaIpc.register()
  updaterIpc.register()
  sherpaIpc.register()
  voiceProfileIpc.register()
  notificationIpc.register()
  proactiveNotificationIpc.register()
  const isPanelFocused = () => {
    const focused = BrowserWindow.getFocusedWindow()
    return !!focused && getBoundWindowCapability(focused.webContents) === 'panel'
  }
  // Renderer-supplied preferences are kept in memory only: a snoozed strip
  // item needs the latest quiet window, not a persisted copy of app settings.
  const deliveryPreferences = { current: null }
  const deliveryContext = createProactiveDeliveryContextProvider({
    isPanelFocused,
    getFocusState: () => {
      const state = powerMonitor.getSystemIdleState(FOCUS_IDLE_THRESHOLD_SECONDS)
      if (state === 'locked') return 'locked'
      if (state === 'idle') return 'idle'
      return 'active'
    },
    getActiveWindow: async () => {
      // Kept dynamic: the desktop-context service pulls native Electron
      // modules, and the re-route path only reads it when awareness is on.
      const { captureActiveWindowContext } = await import('./services/desktopContextService.js')
      const snapshot = await captureActiveWindowContext()
      if (!snapshot) return null
      return {
        title: typeof snapshot.activeWindowTitle === 'string' ? snapshot.activeWindowTitle : '',
        appName: typeof snapshot.activeWindowAppName === 'string' ? snapshot.activeWindowAppName : '',
      }
    },
    getPreferences: () => deliveryPreferences.current,
    now: () => Date.now(),
  })
  proactiveIpc.register({
    app,
    ipcMain,
    getAllWindows: () => BrowserWindow.getAllWindows(),
    requireTrustedSender,
    isPanelFocused,
    getDeliveryContext: deliveryContext.getDeliveryContext,
    setDeliveryPreferences: (preferences) => {
      deliveryPreferences.current = preferences
    },
    strip: {
      show: reminderStrip.showReminderStrip,
      withdraw: reminderStrip.withdrawReminderStripItem,
      withdrawAll: reminderStrip.withdrawAllReminderStripItems,
      configure: reminderStrip.configureReminderStrip,
    },
    showOsNotification: showProactiveNotification,
  })
  mcpIpc.register()
  externalActionPolicyIpc.register()
  voiceRuntimeIpc.register({ voiceSidecarSupervisor: options.voiceSidecarSupervisor })
  localDataIpc.register()
  desktopPresenceIpc.register()

  // Kick off the deferred-module load immediately (no setTimeout). The
  // load is async (Promise.all of dynamic imports) so the call returns
  // instantly and the imports stream in the background while the
  // window opens. The previous 1500 ms delay was a "give the eager
  // handlers room to finish first" heuristic from the audit era —
  // turned out the eager handlers all complete synchronously inside
  // registerIpc(), so there's nothing to give room to. Removing the
  // delay shrinks the "first IPC call before deferred handler is up"
  // race window from ~1.5s + import-time to just import-time
  // (typically < 200 ms on a warm cache).
  void loadDeferredModules()

  app.once('before-quit', async () => {
    desktopPresenceIpc.stop()
    proactiveIpc.stopProactiveInboxPrune()
    await proactiveIpc.flushProactiveInbox()
    const [mcpHost, memoryVectorStore, minecraftGateway, factorioRcon, telegramGateway, discordGateway, notificationBridge] = await Promise.all([
      import('./services/mcpHost.js').catch(() => null),
      import('./services/memoryVectorStore.js').catch(() => null),
      import('./services/minecraftGateway.js').catch(() => null),
      import('./services/factorioRcon.js').catch(() => null),
      import('./services/telegramGateway.js').catch(() => null),
      import('./services/discordGateway.js').catch(() => null),
      import('./services/notificationBridge.js').catch(() => null),
    ])
    await Promise.all([
      mcpHost?.stopAll().catch(() => {}),
      memoryVectorStore?.terminate().catch(() => {}),
      minecraftGateway?.disconnect().catch(() => {}),
      factorioRcon?.disconnect().catch(() => {}),
      telegramGateway?.disconnect().catch(() => {}),
      discordGateway?.disconnect().catch(() => {}),
      notificationBridge?.stop(),
      import('./services/vtsBridge.js').then((vtsBridge) => vtsBridge.shutdownVtsBridge()).catch(() => {}),
      Promise.resolve(reminderStrip.destroyReminderStrip()),
    ])
  })
}
