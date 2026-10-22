import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import { createModelSetupRequestGate } from '../electron/services/modelSetupRequestGate.js'
import type { VoiceRuntimeBag } from '../src/hooks/voice/voiceRuntimeBag.ts'
import type { AppSettings } from '../src/types/app.ts'

// voiceLifecycleControls reaches bundler-style directory imports, so the
// resolve/load hooks must be registered before the dynamic import below.
register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const {
  createVoiceLifecycleControls,
} = await import('../src/hooks/voice/voiceLifecycleControls.ts')

function createLifecycle(
  view: 'pet' | 'panel',
  options: { onReminder?: (content: string) => void } = {},
) {
  const settings = {
    speechInputEnabled: false,
    speechInputProviderId: '',
    speechOutputEnabled: false,
    voiceActivityDetectionEnabled: false,
  } as AppSettings

  const refs = {
    continuousVoiceActiveRef: { current: false },
    voiceStateRef: { current: 'idle' },
    activeVoiceConversationOptionsRef: { current: {} },
    suppressVoiceReplyRef: { current: false },
    recognitionRef: { current: null },
    vadSessionRef: { current: null },
    paraformerSessionRef: { current: null },
    sensevoiceSessionRef: { current: null },
    tencentAsrSessionRef: { current: null },
    paraformerStartingRef: { current: false },
    sensevoiceStartingRef: { current: false },
    assistantSpeechGenerationRef: { current: 0 },
  }

  const bindings = {
    canInterruptSpeech: () => true,
    interruptSpeakingForVoiceInput: () => true,
    setContinuousVoiceSession: () => {},
    shouldKeepContinuousVoiceSession: () => false,
    resetNoSpeechRestartCount: () => {},
    beginVoiceListeningSession: () => {},
    dispatchVoiceSessionAndSync: () => {},
    handleRecognizedVoiceTranscript: async () => false,
    handleVoiceListeningFailure: () => {},
    shouldAutoRestartVoice: () => false,
    resetSpeechLevel: () => {},
  }

  const engines = {
    startVadVoiceConversation: async () => {},
    startParaformerVoiceConversation: async () => {},
    startSenseVoiceConversation: async () => {},
    startTencentAsrConversation: async () => {},
    startApiVoiceConversation: async () => {},
  }

  const bag = {
    ctx: {
      view,
      settingsRef: { current: settings },
      busyRef: { current: false },
      markPresenceActivity: () => {},
      setMood: () => {},
      setError: () => {},
    },
    refs,
    setters: {
      setVoiceState: () => {},
      setLiveTranscript: () => {},
    },
    hookCallbacks: {
      ti: (key: string) => key,
      clearPendingVoiceRestart: () => {},
      updateVoicePipeline: () => {},
      showPetStatus: () => {},
      presentCompanionNotice: (content: string) => { options.onReminder?.(content) },
      busEmit: () => {},
      ensureSupportedSpeechInputSettings: () => settings,
      appendVoiceTrace: () => {},
    },
    hearingRuntime: { clearEngine: () => {} },
    bindingsHolder: { current: bindings },
    enginesHolder: { current: engines },
    lifecycleHolder: { current: null },
    voiceBus: {},
    tunables: {
      voiceTranscriptDedupWindowMs: 0,
      maxContinuousNoSpeechRestarts: 1,
      browserTtsLipsyncIntervalMs: 0,
      audioTtsAnalyserFftSize: 0,
    },
  } as unknown as VoiceRuntimeBag

  return createVoiceLifecycleControls(bag)
}

function installBridge(
  inventoryReady: boolean,
  options: { gate?: ReturnType<typeof createModelSetupRequestGate> } = {},
) {
  let requests = 0
  const gate = options.gate
  Object.assign(globalThis, {
    window: {
      desktopPet: {
        modelsGetInventory: async () => ({ ready: inventoryReady }),
        requestModelSetup: async () => { requests += 1 },
        // The refusal and the reminder it owes live in the main process.
        claimModelSetupReminder: async () => ({
          declined: gate ? gate.isDeclined() : false,
          remind: gate ? gate.claimReminder() : false,
        }),
      },
    },
  })
  return { getRequests: () => requests }
}

async function flushAsyncWork() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
}

test('the mic trigger requests model setup while required models are missing', async () => {
  const bridge = installBridge(false)
  const lifecycle = createLifecycle('pet')

  lifecycle.toggleVoiceConversation()
  await flushAsyncWork()

  assert.equal(bridge.getRequests(), 1)
})

test('the mic trigger stays quiet when the models are already installed', async () => {
  const bridge = installBridge(true)
  const lifecycle = createLifecycle('pet')

  lifecycle.toggleVoiceConversation()
  await flushAsyncWork()

  assert.equal(bridge.getRequests(), 0)
})

test('a refused installer reminds once on the next voice action', async () => {
  const gate = createModelSetupRequestGate({ deliver: () => {} })
  gate.decline()

  const reminders: string[] = []
  const bridge = installBridge(false, { gate })
  const lifecycle = createLifecycle('pet', {
    onReminder: (content) => { reminders.push(content) },
  })

  lifecycle.toggleVoiceConversation()
  await flushAsyncWork()

  assert.deepEqual(
    reminders,
    ['model_setup.deferred_reminder'],
    'the first voice action after the refusal reminds that the models are missing',
  )
  assert.equal(bridge.getRequests(), 0, 'the refused installer is not offered again')

  lifecycle.toggleVoiceConversation()
  await flushAsyncWork()

  assert.deepEqual(
    reminders,
    ['model_setup.deferred_reminder'],
    'the reminder is owed only once',
  )
  assert.equal(bridge.getRequests(), 0, 'the refused installer stays closed')
})

test('a voice action without a refusal offers the installer instead of reminding', async () => {
  const gate = createModelSetupRequestGate({ deliver: () => {} })

  const reminders: string[] = []
  const bridge = installBridge(false, { gate })
  const lifecycle = createLifecycle('pet', {
    onReminder: (content) => { reminders.push(content) },
  })

  lifecycle.toggleVoiceConversation()
  await flushAsyncWork()

  assert.deepEqual(reminders, [], 'nothing is owed while the installer may still open')
  assert.equal(bridge.getRequests(), 1, 'the installer is offered as before')
})
