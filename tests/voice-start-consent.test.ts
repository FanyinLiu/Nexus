import assert from 'node:assert/strict'
import { test } from 'node:test'

import { startVoiceConversationEntrypoint } from '../src/hooks/voice/conversationEntrypoints.ts'
import type { StartVoiceConversationEntrypointOptions } from '../src/hooks/voice/conversationEntrypoints.ts'
import type { AppSettings } from '../src/types/index.ts'

function settings(speechInputEnabled: boolean): AppSettings {
  return {
    speechInputEnabled,
    speechOutputEnabled: false,
    speechInputProviderId: 'local-sensevoice',
  } as AppSettings
}

function harness(speechInputEnabled: boolean, wakewordTriggered = false) {
  const started: string[] = []
  let statusCalls = 0
  const current = settings(speechInputEnabled)
  Object.assign(globalThis, {
    window: {
      desktopPet: {
        sensevoiceStatus: async () => {
          statusCalls += 1
          return { installed: true, modelFound: true, modelsDir: 'models' }
        },
      },
    },
  })
  const params = {
    options: wakewordTriggered ? { wakewordTriggered: true } : undefined,
    settingsRef: { current },
    busyRef: { current: false },
    activeVoiceConversationOptionsRef: { current: {} },
    voiceStateRef: { current: 'idle' },
    suppressVoiceReplyRef: { current: false },
    recognitionRef: { current: null },
    vadSessionRef: { current: null },
    paraformerSessionRef: { current: null },
    sensevoiceSessionRef: { current: null },
    tencentAsrSessionRef: { current: null },
    paraformerStartingRef: { current: false },
    sensevoiceStartingRef: { current: false },
    clearPendingVoiceRestart: () => {},
    canInterruptSpeech: () => false,
    interruptSpeakingForVoiceInput: () => false,
    setContinuousVoiceSession: () => {},
    shouldKeepContinuousVoiceSession: () => false,
    resetNoSpeechRestartCount: () => {},
    beginVoiceListeningSession: () => {},
    dispatchVoiceSessionAndSync: () => {},
    setMood: () => {},
    setError: () => {},
    setLiveTranscript: () => {},
    updateVoicePipeline: () => {},
    showPetStatus: () => {},
    handleRecognizedVoiceTranscript: async () => false,
    handleVoiceListeningFailure: () => {},
    shouldAutoRestartVoice: () => false,
    scheduleVoiceRestart: () => {},
    ensureSupportedSpeechInputSettings: () => current,
    startParaformerConversation: async () => { started.push('paraformer') },
    startSenseVoiceConversation: async () => { started.push('sensevoice') },
    startTencentAsrConversation: async () => { started.push('tencent') },
    startVadVoiceConversation: async () => { started.push('vad') },
    startApiVoiceConversation: async () => { started.push('api') },
    ti: (key: string) => key,
  } as StartVoiceConversationEntrypointOptions
  return { params, started, statusCalls: () => statusCalls, current }
}

test('a finished download does not open the microphone while listening is off', async () => {
  const off = harness(false)
  startVoiceConversationEntrypoint(off.params)
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  assert.deepEqual(off.started, [])
  assert.equal(off.current.speechInputEnabled, false)

  const wake = harness(false, true)
  startVoiceConversationEntrypoint(wake.params)
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  assert.deepEqual(wake.started, ['sensevoice'])
})

test('start voice opens the microphone only after listening was turned on', async () => {
  const on = harness(true)
  startVoiceConversationEntrypoint(on.params)
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  assert.deepEqual(on.started, ['sensevoice'])
  assert.equal(on.statusCalls(), 1)
})
