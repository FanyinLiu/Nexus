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
  options: {
    onReminder?: (content: string, notice?: { replacesSurfaceError?: boolean }) => void
    onError?: (error: string | null) => void
    onStatus?: (message: string) => void
    speechInputProviderId?: string
  } = {},
) {
  const settings = {
    speechInputEnabled: false,
    speechInputProviderId: options.speechInputProviderId ?? '',
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
      setError: (error: string | null) => { options.onError?.(error) },
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
      showPetStatus: (message: string) => { options.onStatus?.(message) },
      presentCompanionNotice: (
        content: string,
        notice?: { replacesSurfaceError?: boolean },
      ) => { options.onReminder?.(content, notice) },
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
  options: {
    gate?: ReturnType<typeof createModelSetupRequestGate>
    senseVoice?: { installed: boolean; modelFound: boolean; modelsDir: string }
    paraformer?: { installed: boolean; modelFound: boolean; modelsDir: string; currentModelId: string | null }
  } = {},
) {
  let requests = 0
  const gate = options.gate
  Object.assign(globalThis, {
    window: {
      desktopPet: {
        modelsGetInventory: async () => ({ ready: inventoryReady }),
        sensevoiceStatus: async () => options.senseVoice ?? {
          installed: false,
          modelFound: false,
          modelsDir: '',
        },
        paraformerStatus: async () => options.paraformer ?? {
          installed: false,
          modelFound: false,
          modelsDir: '',
          currentModelId: null,
        },
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
    ['model_setup.deferred_reminder', 'voice.provider.sensevoice.node_missing'],
    'the installer reminder is owed only once; the next press keeps the missing-runtime line',
  )
  assert.equal(bridge.getRequests(), 0, 'the refused installer stays closed')
})

test('a missing SenseVoice model shows the reminder instead of the error', async () => {
  const gate = createModelSetupRequestGate({ deliver: () => {} })
  gate.decline()

  const reminders: Array<{ content: string; replacesSurfaceError?: boolean }> = []
  const errors: Array<string | null> = []
  const statuses: string[] = []
  installBridge(false, {
    gate,
    senseVoice: { installed: true, modelFound: false, modelsDir: '/models' },
  })
  const lifecycle = createLifecycle('pet', {
    speechInputProviderId: 'local-sensevoice',
    onReminder: (content, notice) => {
      reminders.push({ content, replacesSurfaceError: notice?.replacesSurfaceError })
    },
    onError: (error) => { errors.push(error) },
    onStatus: (message) => { statuses.push(message) },
  })

  lifecycle.toggleVoiceConversation()
  await flushAsyncWork()

  assert.deepEqual(reminders, [{
    content: 'model_setup.deferred_reminder',
    replacesSurfaceError: true,
  }])
  assert.deepEqual(errors, [], 'the missing-model error is not raised beside the reminder')
  assert.deepEqual(statuses, [], 'the missing-model status is not raised beside the reminder')

  lifecycle.toggleVoiceConversation()
  await flushAsyncWork()

  assert.deepEqual(reminders, [
    {
      content: 'model_setup.deferred_reminder',
      replacesSurfaceError: true,
    },
    {
      content: 'voice.provider.sensevoice.not_installed',
      replacesSurfaceError: true,
    },
  ], 'after the one reminder, the missing model stays a single pet line')
  assert.deepEqual(errors, [], 'the missing-model sentence is not a chat error that later becomes generic')
  assert.deepEqual(statuses, [])
})

test('a missing speech model is only the pet line, including the runtime and Paraformer', async () => {
  const cases = [
    {
      providerId: 'local-sensevoice',
      senseVoice: { installed: false, modelFound: false, modelsDir: '' },
      expected: 'voice.provider.sensevoice.node_missing',
    },
    {
      providerId: 'local-paraformer',
      paraformer: { installed: true, modelFound: false, modelsDir: '/models', currentModelId: null },
      expected: 'voice.provider.paraformer.model_missing',
    },
  ] as const

  for (const item of cases) {
    const reminders: Array<{ content: string; replacesSurfaceError?: boolean }> = []
    const errors: Array<string | null> = []
    const statuses: string[] = []
    installBridge(true, {
      senseVoice: 'senseVoice' in item ? item.senseVoice : undefined,
      paraformer: 'paraformer' in item ? item.paraformer : undefined,
    })
    const lifecycle = createLifecycle('pet', {
      speechInputProviderId: item.providerId,
      onReminder: (content, notice) => {
        reminders.push({ content, replacesSurfaceError: notice?.replacesSurfaceError })
      },
      onError: (error) => { errors.push(error) },
      onStatus: (message) => { statuses.push(message) },
    })

    lifecycle.toggleVoiceConversation()
    await flushAsyncWork()

    assert.deepEqual(reminders, [{ content: item.expected, replacesSurfaceError: true }])
    assert.deepEqual(errors, [])
    assert.deepEqual(statuses, [])
  }
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

  assert.deepEqual(
    reminders,
    ['voice.provider.sensevoice.node_missing'],
    'the installer is still the offer; the pet line is the missing runtime, not the one reminder',
  )
  assert.equal(bridge.getRequests(), 1, 'the installer is offered as before')
})
