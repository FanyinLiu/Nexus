import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import {
  classifyVoiceError,
  humanizeVoiceError,
} from '../src/lib/humanizeError.ts'
import { getSpeechOutputErrorMessage } from '../src/hooks/chat/support.ts'
import { AudioPlaybackQueue } from '../src/features/voice/audioQueue.ts'
import { StreamAudioPlayer } from '../src/features/voice/streamAudioPlayer.ts'
import { createWakewordRuntime } from '../src/features/hearing/wakewordRuntime.ts'
import { ensureLocaleLoaded, setLocale } from '../src/i18n/runtime.ts'
import { enMessages } from '../src/i18n/locales/en/index.ts'
import { jaMessages } from '../src/i18n/locales/ja/index.ts'
import { koMessages } from '../src/i18n/locales/ko/index.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN/index.ts'
import { zhTWMessages } from '../src/i18n/locales/zh-TW/index.ts'
import type { TranslationKey, TranslationParams } from '../src/types/i18n.ts'

const MARKER = 'RAW-ERR-MARKER-xyz'

before(async () => {
  await ensureLocaleLoaded('en-US')
  setLocale('en-US')
})

function captureWarnings() {
  const lines: string[] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  return {
    lines,
    restore: () => { console.warn = originalWarn },
  }
}

const VOICE_ERROR_KEYS = [
  'voice.error.engine',
  'voice.error.device',
  'voice.error.network',
  'voice.error.playback',
  'voice.error.generic',
] as const

const ONBOARDING_ERROR_KEYS = [
  'onboarding.error.save_failed',
  'onboarding.error.language_failed',
] as const

test('every new voice/onboarding key exists in all five locales', () => {
  const dictionaries: Array<Record<string, string>> = [
    zhCNMessages,
    zhTWMessages,
    enMessages,
    jaMessages,
    koMessages,
  ]
  for (const key of [...VOICE_ERROR_KEYS, ...ONBOARDING_ERROR_KEYS]) {
    for (const dictionary of dictionaries) {
      assert.ok(dictionary[key]?.trim(), `missing ${key}`)
    }
  }
})

test('Japanese error copy uses the polite form', () => {
  for (const key of [...VOICE_ERROR_KEYS, ...ONBOARDING_ERROR_KEYS]) {
    assert.match(
      jaMessages[key],
      /(ください|ません|です|ます)[。！？]?$/,
      `${key} must end politely: ${jaMessages[key]}`,
    )
  }
})

test('voice error classification follows the cause and never returns raw text', () => {
  const cases = [
    { raw: `${MARKER} fetch failed: getaddrinfo ENOTFOUND`, category: 'network', key: 'voice.error.network' },
    { raw: `${MARKER} Paraformer recognizer init failed`, category: 'engine', key: 'voice.error.engine' },
    { raw: `${MARKER}`, category: 'generic', key: 'voice.error.generic' },
  ] as const

  for (const { raw, category, key } of cases) {
    const captured = captureWarnings()
    try {
      assert.equal(classifyVoiceError(new Error(raw)), category)
      const message = humanizeVoiceError(new Error(raw))
      assert.equal(message, enMessages[key])
      assert.equal(message.includes(MARKER), false)
      assert.ok(captured.lines.some((line) => line.includes(MARKER)), 'raw error must reach the log')
    } finally {
      captured.restore()
    }
  }

  const captured = captureWarnings()
  try {
    const playback = humanizeVoiceError(new Error(`${MARKER} splitter exploded`), {
      category: 'playback',
    })
    assert.equal(playback, enMessages['voice.error.playback'])
    assert.equal(playback.includes(MARKER), false)
    assert.ok(captured.lines.some((line) => line.includes(MARKER)))
  } finally {
    captured.restore()
  }
})

test('permission-denied voice errors keep the platform permission sentence', () => {
  const cases = [
    { name: 'NotAllowedError DOMException', error: new DOMException(`${MARKER} Permission denied`, 'NotAllowedError') },
    { name: 'SecurityError', error: new DOMException(`${MARKER} capture blocked`, 'SecurityError') },
    { name: 'plain permission message', error: new Error(`${MARKER} Permission denied`) },
  ]
  const platforms = [
    { platform: 'darwin', key: 'humanize.voice.mic_permission_mac' },
    { platform: 'win32', key: 'humanize.voice.mic_permission_windows' },
    { platform: 'linux', key: 'humanize.voice.mic_permission' },
  ] as const

  for (const { name, error } of cases) {
    for (const { platform, key } of platforms) {
      const captured = captureWarnings()
      try {
        const message = humanizeVoiceError(error, { platform })
        assert.equal(message, enMessages[key], `${name} / ${platform}`)
        assert.equal(message.includes(MARKER), false)
        assert.doesNotMatch(message, /Permission denied/)
        assert.ok(captured.lines.some((line) => line.includes(MARKER)), 'raw denial must reach the log')
      } finally {
        captured.restore()
      }
    }
  }
})

test('playback support maps an uncoded error to the playback sentence', () => {
  const captured = captureWarnings()
  try {
    const message = getSpeechOutputErrorMessage(new Error(`${MARKER} audio pipeline failed`))
    assert.equal(message, enMessages['voice.error.playback'])
    assert.equal(message.includes(MARKER), false)
    assert.ok(captured.lines.some((line) => line.includes(MARKER)))
  } finally {
    captured.restore()
  }
})

test('wakeword runtime emits fixed copy and logs the raw listener error', async () => {
  const captured = captureWarnings()
  try {
    const states: Array<{ phase: string; error: string; reason: string }> = []
    const ti = (key: TranslationKey, params?: TranslationParams) => {
      let text = (enMessages as Record<string, string>)[key] ?? String(key)
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          text = text.replaceAll(`{${name}}`, String(value))
        }
      }
      return text
    }

    const runtime = createWakewordRuntime({
      checkAvailability: async () => ({
        installed: true,
        modelFound: true,
        modelKind: 'zh',
        modelsDir: '',
        reason: '',
      }),
      startListener: async () => {
        throw new Error(`${MARKER} NotAllowedError: Permission denied`)
      },
      permissionPlatform: 'darwin',
      onStateChange: (next) => { states.push({ phase: next.phase, error: next.error, reason: next.reason }) },
      setTimeoutFn: () => 1,
      clearTimeoutFn: () => undefined,
      ti,
    })

    await runtime.update({ enabled: true, wakeWord: '小猫', suspended: false })

    const final = states.at(-1)
    assert.ok(final)
    assert.equal(final.phase, 'unavailable')
    assert.equal(final.error, enMessages['humanize.voice.mic_permission_mac'])
    assert.equal(final.reason, enMessages['humanize.voice.mic_permission_mac'])
    for (const state of states) {
      assert.equal(state.error.includes(MARKER), false)
      assert.equal(state.reason.includes(MARKER), false)
    }
    assert.ok(captured.lines.some((line) => line.includes(MARKER)), 'raw wakeword error must reach the log')
    runtime.destroy()
  } finally {
    captured.restore()
  }
})

test('audio queue playback failure shows the playback sentence, not the raw error', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio')
  const originalCreateObjectUrl = URL.createObjectURL
  const originalRevokeObjectUrl = URL.revokeObjectURL
  const captured = captureWarnings()

  class FakeAudio {
    readyState = 4
    preload = ''
    currentTime = 0
    onloadedmetadata: (() => void) | null = null
    oncanplay: (() => void) | null = null
    oncanplaythrough: (() => void) | null = null
    onplay: (() => void) | null = null
    onended: (() => void) | null = null
    onerror: (() => void) | null = null
    play() { return Promise.reject(new Error(`${MARKER} play rejected`)) }
    load() {}
    pause() {}
  }

  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: {
        atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
      },
    })
    Object.defineProperty(globalThis, 'Audio', {
      configurable: true,
      writable: true,
      value: FakeAudio,
    })
    URL.createObjectURL = () => 'blob:raw-error-test'
    URL.revokeObjectURL = () => undefined

    const segmentErrors: string[] = []
    const queue = new AudioPlaybackQueue({
      onSegmentError: (_segment, message) => { segmentErrors.push(message) },
    })

    await assert.rejects(
      queue.enqueue({ audioBase64: '', mimeType: 'audio/mpeg' }),
      (error: Error) => {
        assert.equal(error.message, enMessages['voice.error.playback'])
        assert.equal(error.message.includes(MARKER), false)
        return true
      },
    )
    assert.deepEqual(segmentErrors, [enMessages['voice.error.playback']])
    assert.ok(captured.lines.some((line) => line.includes(MARKER)))
  } finally {
    captured.restore()
    URL.createObjectURL = originalCreateObjectUrl
    URL.revokeObjectURL = originalRevokeObjectUrl
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete (globalThis as { window?: unknown }).window
    if (originalAudio) Object.defineProperty(globalThis, 'Audio', originalAudio)
    else delete (globalThis as { Audio?: unknown }).Audio
  }
})

test('streaming audio player reports the playback sentence, not the raw error', async () => {
  const originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext')
  const captured = captureWarnings()

  class FakeAudioContext {
    currentTime = 0
    destination = {}
    createAnalyser() {
      return { fftSize: 0, smoothingTimeConstant: 0, connect() {} }
    }
    createGain() {
      return { gain: { value: 0 }, connect() {} }
    }
    createOscillator() {
      return { frequency: { value: 0 }, connect() {}, start() {} }
    }
    createBuffer() {
      throw new Error(`${MARKER} createBuffer failed`)
    }
    resume() {
      return Promise.resolve()
    }
  }

  try {
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      writable: true,
      value: FakeAudioContext,
    })

    const playbackErrors: string[] = []
    const player = new StreamAudioPlayer({
      onPlaybackError: (message) => { playbackErrors.push(message) },
    })

    await assert.rejects(
      player.appendPcmChunk(new Float32Array([0, 0]), 16_000, 1),
      (error: Error) => {
        assert.equal(error.message, enMessages['voice.error.playback'])
        assert.equal(error.message.includes(MARKER), false)
        return true
      },
    )
    assert.deepEqual(playbackErrors, [enMessages['voice.error.playback']])
    assert.ok(captured.lines.some((line) => line.includes(MARKER)))
  } finally {
    captured.restore()
    if (originalAudioContext) Object.defineProperty(globalThis, 'AudioContext', originalAudioContext)
    else delete (globalThis as { AudioContext?: unknown }).AudioContext
  }
})
