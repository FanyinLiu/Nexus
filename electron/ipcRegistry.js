import { app } from 'electron'
import { synthesizeRemoteTts, warmupRemoteTtsSession } from './services/ttsService.js'
import { createTtsStreamService } from './ttsStreamService.js'

import * as windowIpc from './ipc/windowIpc.js'
import * as chatIpc from './ipc/chatIpc.js'
import * as audioIpc from './ipc/audioIpc.js'
import * as ttsStreamIpc from './ipc/ttsStreamIpc.js'
import * as serviceIpc from './ipc/serviceIpc.js'
import * as telegramIpc from './ipc/telegramIpc.js'
import * as discordIpc from './ipc/discordIpc.js'
import * as vaultIpc from './ipc/vaultIpc.js'
import * as personaIpc from './ipc/personaIpc.js'
import * as updaterIpc from './ipc/updaterIpc.js'
import * as workspaceFsIpc from './ipc/workspaceFsIpc.js'
import * as sherpaIpc from './ipc/sherpaIpc.js'
import * as notificationIpc from './ipc/notificationIpc.js'
import * as proactiveNotificationIpc from './ipc/proactiveNotificationIpc.js'
import * as mcpIpc from './ipc/mcpIpc.js'

const CHAT_REQUEST_TIMEOUT_MS = 25_000
const CONNECTION_TEST_TIMEOUT_MS = 12_000
const AUDIO_TRANSCRIBE_TIMEOUT_MS = 20_000
const AUDIO_SYNTH_TIMEOUT_MS = 25_000
const AUDIO_VOICE_LIST_TIMEOUT_MS = 15_000

const activeChatStreamControllers = new Map()

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
      memoryIpc.register()
      skillIpc.register()

      console.info('[IPC] Deferred modules loaded')
    })
  }
  return _deferredModulesPromise
}

export function registerIpc() {
  windowIpc.register()

  chatIpc.register({
    activeChatStreamControllers,
    CHAT_REQUEST_TIMEOUT_MS,
    CONNECTION_TEST_TIMEOUT_MS,
  })

  audioIpc.register({
    AUDIO_TRANSCRIBE_TIMEOUT_MS,
    AUDIO_SYNTH_TIMEOUT_MS,
    AUDIO_VOICE_LIST_TIMEOUT_MS,
  })

  serviceIpc.register()
  telegramIpc.register()
  discordIpc.register()
  vaultIpc.register()
  personaIpc.register()
  updaterIpc.register()
  workspaceFsIpc.register()
  sherpaIpc.register()
  notificationIpc.register()
  proactiveNotificationIpc.register()
  mcpIpc.register()

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
    const [mcpHost, memoryVectorStore, minecraftGateway, factorioRcon, realtimeVoice, telegramGateway, discordGateway, notificationBridge] = await Promise.all([
      import('./services/mcpHost.js').catch(() => null),
      import('./services/memoryVectorStore.js').catch(() => null),
      import('./services/minecraftGateway.js').catch(() => null),
      import('./services/factorioRcon.js').catch(() => null),
      import('./services/realtimeVoice.js').catch(() => null),
      import('./services/telegramGateway.js').catch(() => null),
      import('./services/discordGateway.js').catch(() => null),
      import('./services/notificationBridge.js').catch(() => null),
    ])
    await Promise.all([
      mcpHost?.stopAll().catch(() => {}),
      memoryVectorStore?.terminate().catch(() => {}),
      minecraftGateway?.disconnect().catch(() => {}),
      factorioRcon?.disconnect().catch(() => {}),
      realtimeVoice?.stopSession().catch(() => {}),
      telegramGateway?.disconnect().catch(() => {}),
      discordGateway?.disconnect().catch(() => {}),
      notificationBridge?.stop(),
    ])
  })
}
