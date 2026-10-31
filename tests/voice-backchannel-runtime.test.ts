import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearBackchannelClipCache,
  createBackchannelSession,
  type BackchannelClip,
} from '../src/hooks/voice/backchannelRuntime.ts'
import type { InterruptMicPolicyInput } from '../src/features/voice/autoRestartPolicy.ts'
import type { AppSettings } from '../src/types/index.ts'

const SETTINGS = {
  voiceBackchannelEnabled: true,
  speechOutputEnabled: true,
  speechOutputProviderId: 'qwen3-tts-local',
  speechOutputApiBaseUrl: '',
  speechOutputApiKey: '',
  speechOutputModel: 'qwen3-tts-local',
  speechOutputVoice: 'vivian',
  speechOutputInstructions: '',
  activeCharacterProfileId: 'char-a',
  speechSynthesisLang: 'zh-CN',
  speechRecognitionLang: 'zh-CN',
  speechRate: 0.92,
  speechPitch: 1,
  speechVolume: 1,
} as AppSettings

const VOICE_MIC: InterruptMicPolicyInput = {
  source: 'voice',
  continuousActive: false,
  wakewordLive: false,
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function createHarness(settings: AppSettings, moodTempo = 1.5) {
  const calls: Array<{ text: string; speechTempo: number }> = []
  const session = createBackchannelSession({
    getSettings: () => settings,
    getPlayer: () => ({ appendBackchannelPcmChunk: () => 100 }),
    voiceEchoCooldownUntilRef: { current: 0 },
    micPolicy: VOICE_MIC,
    getMoodSpeechTempo: () => moodTempo,
    synthesizeClip: async (_settings, text, speechTempo): Promise<BackchannelClip> => {
      calls.push({ text, speechTempo })
      return { samples: new Float32Array([0.1, 0.2]), sampleRate: 24_000 }
    },
  })
  return { session, calls }
}

test('clips survive stop and are replayed on the next turn', async () => {
  clearBackchannelClipCache()
  const first = createHarness(SETTINGS)
  first.session.start()
  await tick()
  assert.equal(first.calls.length, 3, 'the three tokens are synthesized once')
  first.session.stop()

  const second = createHarness(SETTINGS)
  second.session.start()
  await tick()
  assert.equal(second.calls.length, 0, 'the next turn reuses the cache')
})

test('a provider, voice, language, or mood-tempo change clears the cache', async () => {
  clearBackchannelClipCache()
  const scenarios: Array<{ label: string; settings: AppSettings; tempo: number }> = [
    { label: 'baseline', settings: SETTINGS, tempo: 1.5 },
    { label: 'voice', settings: { ...SETTINGS, speechOutputVoice: 'serena' }, tempo: 1.5 },
    { label: 'language', settings: { ...SETTINGS, speechSynthesisLang: 'ja-JP' }, tempo: 1.5 },
    { label: 'provider', settings: { ...SETTINGS, speechOutputProviderId: 'openai-tts' }, tempo: 1.5 },
    { label: 'mood tempo', settings: SETTINGS, tempo: 1.65 },
  ]

  for (const scenario of scenarios) {
    const harness = createHarness(scenario.settings, scenario.tempo)
    harness.session.start()
    await tick()
    assert.equal(harness.calls.length, 3, `${scenario.label} re-synthesizes the three tokens`)
    harness.session.stop()
  }
})

test('clips are requested at the current mood tempo for the local provider', async () => {
  clearBackchannelClipCache()
  const harness = createHarness(SETTINGS, 1.65)
  harness.session.start()
  await tick()
  assert.deepEqual(
    harness.calls.map((call) => call.speechTempo),
    [1.65, 1.65, 1.65],
  )

  const otherProvider = createHarness({ ...SETTINGS, speechOutputProviderId: 'openai-tts' }, 1.65)
  otherProvider.session.start()
  await tick()
  assert.deepEqual(
    otherProvider.calls.map((call) => call.speechTempo),
    [1, 1, 1],
    'only the local Qwen3 path carries a client-side tempo',
  )
})

test('a synthesis timeout aborts the in-flight request', async () => {
  clearBackchannelClipCache()
  const previousWindow = globalThis.window
  const aborted: string[] = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      desktopPet: {
        ttsStreamStart: async () => ({ ok: true }),
        ttsStreamPushText: async () => ({ ok: true }),
        ttsStreamFinish: async () => ({ ok: true }),
        ttsStreamAbort: async ({ requestId }: { requestId: string }) => {
          aborted.push(requestId)
          return { ok: true }
        },
        subscribeTtsStream: () => () => undefined,
      },
    },
  })

  try {
    const session = createBackchannelSession({
      getSettings: () => SETTINGS,
      getPlayer: () => ({ appendBackchannelPcmChunk: () => 0 }),
      voiceEchoCooldownUntilRef: { current: 0 },
      micPolicy: VOICE_MIC,
      getMoodSpeechTempo: () => 1.5,
      synthesisTimeoutMs: 5,
    })
    session.start()
    await new Promise<void>((resolve) => setTimeout(resolve, 60))
    assert.equal(aborted.length, 3, 'each timed-out request is aborted')
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    })
  }
})
