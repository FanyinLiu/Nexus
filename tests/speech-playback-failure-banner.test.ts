/**
 * A reply whose playback fails must surface the fixed humanized line on the
 * chat error banner. The raw provider/IPC text belongs to the redacted log and
 * the voice trace only — this pins the split the handler owns, so dropping the
 * banner or reverting it to `error.message` fails here.
 */

import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { ensureLocaleLoaded, setLocale } from '../src/i18n/runtime.ts'
import { enMessages } from '../src/i18n/locales/en/index.ts'
import { createSpeechPlaybackFailureHandler } from '../src/hooks/chat/speechPlaybackFailure.ts'

const RAW_SPEECH_ERROR = 'synthetic-r2 speaker offline at 127.0.0.1:65535'

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

function createHandler() {
  const errors: Array<string | null> = []
  const traces: Array<{ label: string; detail: string; tone: string }> = []
  const busEvents: Array<Record<string, unknown>> = []

  const handler = createSpeechPlaybackFailureHandler({
    ctx: {
      appendVoiceTrace: (label, detail, tone) => { traces.push({ label, detail, tone: tone ?? 'info' }) },
      busEmit: (event) => { busEvents.push(event as unknown as Record<string, unknown>) },
    },
    setError: (value) => { errors.push(value) },
    t: (key) => enMessages[key],
  } as unknown as Parameters<typeof createSpeechPlaybackFailureHandler>[0])

  return { handler, errors, traces, busEvents }
}

test('a text reply whose speech fails shows the humanized playback line, not the raw error', () => {
  const captured = captureWarnings()
  try {
    const { handler, errors, busEvents } = createHandler()

    handler(new Error(RAW_SPEECH_ERROR), {
      source: 'text',
      fromVoice: false,
      shouldResumeContinuousVoice: false,
    })

    assert.deepEqual(errors, [enMessages['voice.error.playback']], 'the banner gets the fixed companion line')
    assert.doesNotMatch(errors[0] ?? '', /synthetic-r2|127\.0\.0\.1|Error:/, 'the raw error never reaches the banner')
    assert.ok(
      captured.lines.some((line) => line.includes(RAW_SPEECH_ERROR)),
      'the raw error still reaches the redacted log',
    )
    const failureEvent = busEvents.find((event) => event.type === 'tts:error')
    assert.ok(failureEvent)
    assert.equal(failureEvent.message, enMessages['voice.error.playback'])
  } finally {
    captured.restore()
  }
})

test('a voice reply whose speech fails shows the fixed playback-with-reply summary', () => {
  const captured = captureWarnings()
  try {
    const { handler, errors, traces } = createHandler()

    handler(new Error(RAW_SPEECH_ERROR), {
      source: 'voice',
      fromVoice: true,
      traceLabel: '7',
      shouldResumeContinuousVoice: true,
    })

    assert.deepEqual(errors, [enMessages['chat.error.playback_with_reply']], 'the banner gets the fixed voice summary')
    assert.doesNotMatch(errors[0] ?? '', /synthetic-r2|127\.0\.0\.1|Error:/, 'the raw error never reaches the banner')
    assert.equal(traces.length, 1, 'the voice trace still records the failure')
    assert.match(traces[0].detail, /^#7 /)
    assert.doesNotMatch(traces[0].detail, /synthetic-r2/, 'the trace preview is humanized too')
    assert.ok(
      captured.lines.some((line) => line.includes(RAW_SPEECH_ERROR)),
      'the raw error still reaches the redacted log',
    )
  } finally {
    captured.restore()
  }
})
