import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  createInitialWakewordRuntimeState,
  createWakewordRuntime,
} from '../src/features/hearing/wakewordRuntime.ts'
import { handleWakewordRuntimeStateChangeRuntime } from '../src/hooks/voice/wakewordIntegration.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN/index.ts'
import { enMessages } from '../src/i18n/locales/en/index.ts'
import type { TranslationKey, TranslationParams } from '../src/types/i18n.ts'
import type { WakewordRuntimeState } from '../src/types'

type LocaleMessages = Record<string, string>

// The runtime receives its `ti` from the hook layer (makeTranslator over the
// user's settings locale), so the tests stand a translator on the locale
// dictionaries — same interpolation contract ({param} → value).
function makeFakeTranslator(messages: LocaleMessages) {
  return (key: TranslationKey, params?: TranslationParams) => {
    let text = messages[key] ?? String(key)
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }
}

type FakeListenerCallbacks = {
  onKeywordDetected: (keyword: string) => void
  onError?: (message: string) => void
}

function buildRuntimeHarness(
  messages: LocaleMessages,
  overrides: Parameters<typeof createWakewordRuntime>[0] = {},
) {
  const states: WakewordRuntimeState[] = []
  const timers: Array<{ callback: () => void; delayMs: number }> = []
  const runtime = createWakewordRuntime({
    checkAvailability: async () => ({
      installed: true,
      modelFound: true,
      modelKind: 'zh',
      modelsDir: '',
      reason: '',
    }),
    onStateChange: (next) => { states.push(next) },
    setTimeoutFn: (callback, delayMs) => {
      timers.push({ callback, delayMs })
      return timers.length
    },
    clearTimeoutFn: () => undefined,
    ti: makeFakeTranslator(messages),
    ...overrides,
  })
  return { runtime, states, timers }
}

function enableRuntime(runtime: { update: (config: { enabled: boolean; wakeWord: string }) => Promise<void> }) {
  return runtime.update({ enabled: true, wakeWord: '小猫' })
}

// Internal wording that must never reach a user-facing state. The runtime
// logs the raw form but every emitted reason/error must be humanized copy.
const RAW_ERROR_TOKENS = ['Permission denied', 'NotAllowedError', 'Microphone track ended']
const TRACK_ENDED_MESSAGE = 'Microphone track ended unexpectedly — triggering recovery.'

function assertNoRawErrorText(state: WakewordRuntimeState) {
  for (const token of RAW_ERROR_TOKENS) {
    assert.equal(
      state.reason.includes(token),
      false,
      `reason leaked "${token}": ${state.reason}`,
    )
    assert.equal(
      state.error.includes(token),
      false,
      `error leaked "${token}": ${state.error}`,
    )
  }
}

const LOCALES = [
  ['zh-CN', zhCNMessages],
  ['en', enMessages],
] as const

// A mic-permission denial reaches the runtime either as a bare string, a
// Chromium DOMException, or a DOMException-like object whose message reads as
// an innocuous "The request is not allowed". All are recognized by
// humanizeMicPermissionError, become the per-platform sentence, and are
// permanent: retrying can never fix a denied permission.
describe('wakeword runtime copy — mic permission denied', () => {
  const deniedInputs = [
    { name: 'bare string', error: 'Permission denied' },
    {
      name: 'DOMException-like name',
      error: { name: 'NotAllowedError', message: 'The request is not allowed' },
    },
  ]
  const platforms = [
    { platform: 'darwin', key: 'humanize.voice.mic_permission_mac' },
    { platform: 'win32', key: 'humanize.voice.mic_permission_windows' },
    { platform: 'linux', key: 'humanize.voice.mic_permission' },
  ] as const

  for (const [localeName, messages] of LOCALES) {
    for (const { name, error } of deniedInputs) {
      for (const { platform, key } of platforms) {
        test(`${localeName}: ${name} on ${platform} gives the bare platform sentence`, async () => {
          const { runtime, states, timers } = buildRuntimeHarness(messages, {
            permissionPlatform: platform,
            startListener: async () => { throw error },
          })

          await enableRuntime(runtime)

          const final = states.at(-1)
          assert.ok(final, 'expected at least one state emit')
          const expected = messages[key]
          assert.equal(final.phase, 'unavailable')
          assert.equal(final.reason, expected)
          assert.equal(final.error, expected)
          assert.equal(timers.length, 0, 'a denied permission must not schedule a retry')
          for (const state of states) assertNoRawErrorText(state)
          runtime.destroy()
        })
      }
    }
  }

  test('permission denied through the availability check path is also humanized', async () => {
    const { runtime, states, timers } = buildRuntimeHarness(zhCNMessages, {
      permissionPlatform: 'unknown',
      checkAvailability: async () => { throw new Error('Permission denied') },
    })

    await enableRuntime(runtime)

    const final = states.at(-1)
    assert.ok(final)
    assert.equal(final.phase, 'unavailable')
    assert.equal(final.reason, zhCNMessages['humanize.voice.mic_permission'])
    assert.equal(final.error, zhCNMessages['humanize.voice.mic_permission'])
    assert.equal(timers.length, 0)
    for (const state of states) assertNoRawErrorText(state)
    runtime.destroy()
  })
})

// The OS kills the mic track with telemetry-style internal wording. The
// detector text is log-only: every emitted reason/error must carry the
// recording-device guidance sentence instead — including after the retry
// budget is exhausted.
describe('wakeword runtime copy — mic track ended', () => {
  for (const [localeName, messages] of LOCALES) {
    test(`${localeName}: retry error state keeps retry reason but bare device error`, async () => {
      let listenerCallbacks: FakeListenerCallbacks | null = null
      const { runtime, states, timers } = buildRuntimeHarness(messages, {
        startListener: async (callbacks) => {
          listenerCallbacks = callbacks
          return { stop: () => undefined, subscribeFrames: () => () => undefined }
        },
      })

      await enableRuntime(runtime)
      assert.equal(runtime.getState().phase, 'listening')

      listenerCallbacks?.onError?.(TRACK_ENDED_MESSAGE)

      const deviceSentence = messages['voice.error.device']
      const final = states.at(-1)
      assert.ok(final)
      assert.equal(final.phase, 'error')
      assert.equal(final.error, deviceSentence)

      const retryReason = messages['voice.wakeword.retry_in_seconds']
        .replaceAll('{seconds}', String(Math.round(timers[0].delayMs / 100) / 10))
      assert.equal(final.reason, retryReason, 'scheduleRetry keeps the retry_in_seconds reason')
      assert.equal(timers.length, 1)

      for (const state of states) {
        assertNoRawErrorText(state)
        if (state.phase === 'error') assert.equal(state.error, deviceSentence)
      }
      runtime.destroy()
    })

    test(`${localeName}: give-up after retries exhausted shows the bare device sentence`, async () => {
      const { runtime, states, timers } = buildRuntimeHarness(messages, {
        startListener: async () => { throw TRACK_ENDED_MESSAGE },
        retryMaxAttempts: 0,
      })

      await enableRuntime(runtime)

      const final = states.at(-1)
      assert.ok(final)
      const deviceSentence = messages['voice.error.device']
      assert.equal(final.phase, 'unavailable')
      assert.equal(final.reason, deviceSentence)
      assert.equal(final.error, deviceSentence)
      assert.equal(timers.length, 0)
      for (const state of states) assertNoRawErrorText(state)
      runtime.destroy()
    })
  }
})

// The runtime marks humanized mic failures by emitting the full sentence in
// reason — the pet-status bridge must show it verbatim (no generic
// "Wake word unavailable: …" shell) while every other reason keeps its shell.
describe('wakeword pet-status bridge copy', () => {
  function runStateChange(messages: LocaleMessages, reason: string): string[] {
    const petStatusLines: string[] = []
    const previousState = createInitialWakewordRuntimeState()
    const nextState: WakewordRuntimeState = {
      ...previousState,
      phase: 'unavailable',
      reason,
    }
    handleWakewordRuntimeStateChangeRuntime({
      nextState,
      previousState,
      setWakewordState: () => undefined,
      appendVoiceTrace: () => undefined,
      showPetStatus: (message) => petStatusLines.push(message),
      ti: makeFakeTranslator(messages),
    })
    return petStatusLines
  }

  const humanizedKeys: TranslationKey[] = [
    'humanize.voice.mic_permission',
    'humanize.voice.mic_permission_mac',
    'humanize.voice.mic_permission_windows',
    'humanize.voice.mic_not_responding',
    'voice.error.engine',
    'voice.error.device',
    'voice.error.network',
    'voice.error.playback',
    'voice.error.generic',
  ]

  for (const [localeName, messages] of LOCALES) {
    test(`${localeName}: humanized mic sentences are shown verbatim`, () => {
      for (const key of humanizedKeys) {
        const sentence = messages[key]
        const [line] = runStateChange(messages, sentence)
        assert.equal(line, sentence, key)
      }
    })
  }

  test('other reasons keep the localized unavailable shell', () => {
    const reason = enMessages['voice.wakeword.model_unavailable']
    const [line] = runStateChange(enMessages, reason)
    assert.equal(
      line,
      enMessages['voice.wakeword.unavailable_with_reason'].replace('{reason}', reason),
    )
  })
})
