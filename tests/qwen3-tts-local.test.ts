import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

import {
  getSpeechOutputProvider,
} from '../src/lib/speechProviderCatalog.ts'
import { resolveSpeechOutputSettingsView } from '../src/features/voice/providerSettings.ts'
import {
  buildSpeechOutputFailoverCandidatesRuntime,
  createQwen3TtsFallbackNotice,
  shouldFailoverSpeechOutput,
} from '../src/hooks/voice/providerFallbacks.ts'
import { executeWithFailover } from '../src/features/failover/orchestrator.ts'
import { buildQwen3TtsSpeechRequestPayload } from '../electron/services/qwen3TtsPayload.js'
import { createTtsStreamService } from '../electron/ttsStreamService.js'
import type { AppSettings } from '../src/types/index.ts'

const SETTINGS = {
  speechOutputProviderId: 'qwen3-tts-local',
  speechOutputFailoverEnabled: false,
  speechOutputApiBaseUrl: '',
  speechOutputApiKey: '',
  speechOutputModel: '',
  speechOutputVoice: 'vivian',
  speechOutputInstructions: '',
} as AppSettings

function installLocalStorage() {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value) },
        removeItem: (key: string) => { store.delete(key) },
      },
    },
  })
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('Qwen3-TTS catalog entry exposes the local streaming contract', () => {
  const entry = getSpeechOutputProvider('qwen3-tts-local')

  assert.equal(entry.id, 'qwen3-tts-local')
  assert.equal(entry.kind, 'local')
  assert.equal(entry.hidden, false)
  assert.equal(entry.supportsStreaming, true)
  assert.equal(entry.protocol, 'qwen3-tts')
  assert.equal(entry.defaultVoice, 'vivian')
  assert.equal(entry.baseUrl, 'http://127.0.0.1:8002/v1')
  assert.deepEqual(
    entry.fallbackVoiceOptions.map((voice) => voice.id),
    ['vivian', 'serena', 'ono_anna', 'sohee', 'aiden', 'dylan', 'eric', 'ryan', 'uncle_fu'],
  )

  const view = resolveSpeechOutputSettingsView({ speechOutputProviderId: 'qwen3-tts-local' })
  assert.equal(view.provider.defaultVoice, 'vivian')
  assert.equal(view.hideCredentials, true)
  assert.equal(view.showEndpoint, false)
  assert.equal(view.showCustomVoiceInput, false)
})

test('Qwen3 falls back to the previous default voice even with cloud failover off', () => {
  const candidates = buildSpeechOutputFailoverCandidatesRuntime(SETTINGS)

  assert.deepEqual(
    candidates.map((candidate) => candidate.speechOutputProviderId),
    ['qwen3-tts-local', 'edge-tts'],
  )
  assert.equal(shouldFailoverSpeechOutput(SETTINGS, candidates.length), true)
  assert.equal(shouldFailoverSpeechOutput({
    ...SETTINGS,
    speechOutputProviderId: 'edge-tts',
  }, 1), false)
})

test('health failure and first-chunk timeout both hand the reply to Edge once, with one notice', async () => {
  installLocalStorage()
  const candidates = buildSpeechOutputFailoverCandidatesRuntime(SETTINGS)
  const attempts: string[] = []
  let notices = 0

  const notice = createQwen3TtsFallbackNotice()

  async function reply(errorMessage: string) {
    const result = await executeWithFailover({
      domain: 'speech-output',
      candidates: candidates.map((settings, index) => ({
        id: settings.speechOutputProviderId,
        identity: `${settings.speechOutputProviderId}|${index}`,
        payload: settings,
      })),
      failoverEnabled: shouldFailoverSpeechOutput(SETTINGS, candidates.length),
      execute: async (candidate) => {
        attempts.push(candidate.id)
        if (candidate.id === 'qwen3-tts-local') {
          throw new Error(errorMessage)
        }
      },
    })
    if (result.usedFallback) {
      notice((message: string) => {
        assert.ok(message.length > 0)
        notices += 1
      }, (key) => `t:${key}`)
    }
    return result
  }

  const healthFailure = await reply('Local Qwen3 speech service is not ready (503).')
  assert.equal(healthFailure.candidateId, 'edge-tts')
  assert.equal(healthFailure.usedFallback, true)

  const chunkTimeout = await reply('Streaming TTS did not produce audio within 20 seconds.')
  assert.equal(chunkTimeout.candidateId, 'edge-tts')

  assert.deepEqual(attempts, [
    'qwen3-tts-local',
    'edge-tts',
    'qwen3-tts-local',
    'edge-tts',
  ])
  assert.equal(notices, 1)
})

test('Qwen3 speech payload carries speaker, instructions, language, and PCM format', () => {
  assert.deepEqual(
    buildQwen3TtsSpeechRequestPayload({
      voice: 'serena',
      instructions: '带点傲娇，语气轻快',
      language: 'zh-CN',
      rate: 1.2,
    }, '你好呀。'),
    {
      input: '你好呀。',
      voice: 'serena',
      response_format: 'pcm',
      speed: 1.2,
      instructions: '带点傲娇，语气轻快',
      language: 'zh-CN',
    },
  )

  assert.deepEqual(
    buildQwen3TtsSpeechRequestPayload({}, 'Hello.'),
    {
      input: 'Hello.',
      voice: 'vivian',
      response_format: 'pcm',
    },
  )
})

test('aborting a streamed Qwen3 reply destroys the PCM stream without an error event', async () => {
  let sawSynth = () => undefined
  const synthesized = new Promise<void>((resolve) => { sawSynth = resolve })
  const events: Array<{ type: string }> = []
  const sender = {
    isDestroyed: () => false,
    send: (_channel: string, event: { type: string }) => { events.push(event) },
    once: () => undefined,
    removeListener: () => undefined,
  }

  const service = createTtsStreamService({
    synthesizeRemote: async (_payload, _text, signal: AbortSignal) => {
      const stream = new Readable({ read() {} })
      stream.push(Buffer.alloc(512))
      signal.addEventListener('abort', () => {
        stream.destroy(new Error('aborted by barge-in'))
      })
      sawSynth()
      return { pcmStream: stream, pcmSampleRate: 24000 }
    },
  })

  await service.start(sender, { requestId: 'qwen-stream-1', providerId: 'qwen3-tts-local' })
  service.pushText(sender, { requestId: 'qwen-stream-1', text: '你好呀。' })
  await synthesized
  await delay(10)

  service.abort(sender, { requestId: 'qwen-stream-1' })
  await delay(20)

  assert.equal(events.some((event) => event.type === 'error'), false)
})
