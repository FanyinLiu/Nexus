import { app } from 'electron'
import { synthesizeRemoteTts, warmupRemoteTtsSession } from './services/ttsService.js'
import { createTtsStreamService } from './ttsStreamService.js'

import * as windowIpc from './ipc/windowIpc.js'
import * as chatIpc from './ipc/chatIpc.js'
import * as audioIpc from './ipc/audioIpc.js'
import * as ttsStreamIpc from './ipc/ttsStreamIpc.js'
import * as serviceIpc from './ipc/serviceIpc.js'
import * as vaultIpc from './ipc/vaultIpc.js'

const CHAT_REQUEST_TIMEOUT_MS = 25_000
const CONNECTION_TEST_TIMEOUT_MS = 12_000
const AUDIO_TRANSCRIBE_TIMEOUT_MS = 20_000
const AUDIO_SYNTH_TIMEOUT_MS = 25_000
const AUDIO_VOICE_LIST_TIMEOUT_MS = 15_000
const VOICE_CLONE_TIMEOUT_MS = 60_000

const activeChatStreamControllers = new Map()

// Lazy-loaded modules — loaded on first use, not at startup
let _deferredModulesPromise = null

function loadDeferredModules() {
  if (!_deferredModulesPromise) {
    _deferredModulesPromise = Promise.all([
      import('./sherpaTts.js'),
      import('./ipc/sherpaIpc.js'),
      import('./ipc/mcpIpc.js'),
      import('./ipc/pluginIpc.js'),
      import('./ipc/memoryIpc.js'),
    ]).then(([sherpaTtsService, sherpaIpc, mcpIpc, pluginIpc, memoryIpc]) => {
      const ttsStreamService = createTtsStreamService({
        sherpaTtsService,
        synthesizeRemote: synthesizeRemoteTts,
        warmupRemote: warmupRemoteTtsSession,
      })

      ttsStreamIpc.register({ ttsStreamService })
      sherpaIpc.register()
      mcpIpc.register()
      pluginIpc.register()
      memoryIpc.register()

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
    VOICE_CLONE_TIMEOUT_MS,
  })

  serviceIpc.register()
  vaultIpc.register()

  // Load deferred modules when the renderer is ready (first IPC call will trigger it),
  // but also kick off a background load after a short delay as a warm-up.
  setTimeout(loadDeferredModules, 1_500)

  app.once('before-quit', async () => {
    const [mcpHost, memoryVectorStore, minecraftGateway, factorioRcon, realtimeVoice] = await Promise.all([
      import('./services/mcpHost.js').catch(() => null),
      import('./services/memoryVectorStore.js').catch(() => null),
      import('./services/minecraftGateway.js').catch(() => null),
      import('./services/factorioRcon.js').catch(() => null),
      import('./services/realtimeVoice.js').catch(() => null),
    ])
    await Promise.all([
      mcpHost?.stopAll().catch(() => {}),
      memoryVectorStore?.flush().catch(() => {}),
      minecraftGateway?.disconnect().catch(() => {}),
      factorioRcon?.disconnect().catch(() => {}),
      realtimeVoice?.stopSession().catch(() => {}),
    ])
  })
}
