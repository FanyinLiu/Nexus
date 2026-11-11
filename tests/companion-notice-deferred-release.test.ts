import assert from 'node:assert/strict'
import { test } from 'node:test'

import { VoiceBus } from '../src/features/voice/bus.ts'
import { emitSpeechStopAll } from '../src/features/voice/speechStopBus.ts'
import { mergeContinuousVoiceActive } from '../src/hooks/voice/continuousVoice.ts'
import {
  createHarness,
  flushMicrotasks,
  pendingSpeech,
  reminder,
} from './helpers/companionNoticeHarness.ts'

const END_CASES: Array<{
  name: string
  event: Parameters<VoiceBus['emit']>[0]
  continuousOff?: boolean
}> = [
  { name: 'normal end', event: { type: 'session:completed' } },
  { name: 'manual cancel', event: { type: 'session:aborted', abortReason: 'user_cancelled' } },
  { name: 'ASR error', event: { type: 'stt:error', code: 'network', message: 'network failed' } },
  { name: 'VAD error', event: { type: 'mic:error', message: 'vad failed' } },
  { name: 'no-speech', event: { type: 'vad:no_speech_timeout', waitedMs: 2_000 } },
  { name: 'transcription failure', event: { type: 'stt:error', code: 'decode', message: 'decode failed' } },
  { name: 'session interrupted', event: { type: 'session:aborted', abortReason: 'interrupted' } },
  { name: 'continuous turned off midway', event: { type: 'session:completed' }, continuousOff: true },
  { name: 'mic denied', event: { type: 'mic:error', message: 'permission denied' } },
]

for (const endCase of END_CASES) {
  test(`end path releases once: ${endCase.name}`, async () => {
    const harness = createHarness()
    await harness.api.pushCompanionNotice(reminder('r1', 'drink water'))
    assert.deepEqual(harness.spoken, [], 'queued while the session is active')

    harness.voiceStateRef.current = 'idle'
    harness.continuousVoiceActiveRef.current = false
    harness.bus.emit(endCase.event)
    await flushMicrotasks()

    assert.deepEqual(harness.spoken, ['drink water.'], 'released once on session end')
    assert.equal(harness.timers.pending(), 0, 'release clears all timers')

    harness.bus.emit(endCase.event)
    harness.bus.emit(endCase.event)
    await flushMicrotasks()
    assert.deepEqual(harness.spoken, ['drink water.'], 'multiple end signals cannot double release')
    assert.equal(harness.timers.pending(), 0, 'extra end signals leave no timer behind')
    harness.unmount()
  })
}

const CONTINUOUS_MID_SESSION_EVENTS: Array<{
  name: string
  event: Parameters<VoiceBus['emit']>[0]
}> = [
  {
    name: 'vad no-speech',
    event: { type: 'vad:no_speech_timeout', waitedMs: 2_000 },
  },
  {
    name: 'tts error with resume',
    event: {
      type: 'tts:error',
      message: 'tts failed',
      speechGeneration: 1,
      shouldResumeContinuousVoice: true,
    },
  },
  {
    name: 'session aborted with reopen',
    event: { type: 'session:aborted', abortReason: 'session_aborted' },
  },
]

for (const midSession of CONTINUOUS_MID_SESSION_EVENTS) {
  test(`continuous mode does not release on ${midSession.name}`, async () => {
    const harness = createHarness()
    await harness.api.pushCompanionNotice(reminder('mid', 'mid reminder'))
    harness.voiceStateRef.current = 'idle'
    harness.bus.emit(midSession.event)
    await flushMicrotasks()
    assert.deepEqual(harness.spoken, [], 'continuous voice will reopen the microphone')

    harness.continuousVoiceActiveRef.current = false
    harness.bus.emit({ type: 'session:completed' })
    await flushMicrotasks()
    assert.deepEqual(harness.spoken, ['mid reminder.'], 'releases once the flag clears')
    harness.unmount()
  })
}

for (const singleTurn of [
  { name: 'normal end', event: { type: 'session:completed' } },
  { name: 'error', event: { type: 'stt:error', code: 'network', message: 'network failed' } },
] as const) {
  test(`single-turn ${singleTurn.name} releases once`, async () => {
    const harness = createHarness({
      continuousVoiceActiveRef: { current: false },
    })
    await harness.api.pushCompanionNotice(reminder('single', 'single reminder'))
    harness.voiceStateRef.current = 'idle'
    harness.bus.emit(singleTurn.event)
    await flushMicrotasks()
    assert.deepEqual(harness.spoken, ['single reminder.'])
    harness.unmount()
  })
}

test('hide alone keeps waiting, and session end while hidden still releases', async () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: { hidden: true, visibilityState: 'hidden' },
  })
  const harness = createHarness()
  try {
    await harness.api.pushCompanionNotice(reminder('hidden', 'take a break'))
    harness.advance(15_000)
    await flushMicrotasks()
    assert.deepEqual(harness.spoken, [], 'hidden alone must not end the session')

    harness.voiceStateRef.current = 'idle'
    harness.continuousVoiceActiveRef.current = false
    harness.bus.emit({ type: 'session:completed' })
    await flushMicrotasks()
    assert.deepEqual(harness.spoken, ['take a break.'], 'session end releases while hidden')
  } finally {
    harness.unmount()
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})

test('new reminders merge by due time, dedupe by id, and speak once with one prefix', async () => {
  const harness = createHarness()
  await harness.api.pushCompanionNotice(reminder('late', 'late reminder', 300))
  await harness.api.pushCompanionNotice(reminder('early', 'early reminder', 100))
  await harness.api.pushCompanionNotice(reminder('early', 'duplicate early reminder', 90))
  await harness.api.pushCompanionNotice(reminder('middle', 'middle reminder', 200))
  await harness.api.pushCompanionNotice(reminder('extra', 'extra reminder', 400))
  assert.deepEqual(harness.spoken, [])

  harness.advance(60_000)
  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()

  assert.equal(harness.spoken.length, 1, 'one TTS call for the whole batch')
  assert.equal(
    harness.spoken[0],
    'While we were chatting, a reminder came up: early reminder; middle reminder; late reminder. 1 more reminder.',
  )
  assert.equal(harness.bubbles.length, 1, 'one bubble for the whole batch')
  assert.equal(harness.messages.length, 1, 'one chat line for the whole batch')
  harness.unmount()
})

test('an interrupted merged replay keeps one prefix and one more line', async () => {
  const pending = pendingSpeech()
  const harness = createHarness({ speakAssistantReply: pending.speak })
  await harness.api.pushCompanionNotice(reminder('late', 'late reminder', 300))
  await harness.api.pushCompanionNotice(reminder('early', 'early reminder', 100))
  await harness.api.pushCompanionNotice(reminder('early', 'duplicate early reminder', 90))
  await harness.api.pushCompanionNotice(reminder('middle', 'middle reminder', 200))
  await harness.api.pushCompanionNotice(reminder('extra', 'extra reminder', 400))

  harness.advance(60_000)
  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()

  const expected = 'While we were chatting, a reminder came up: early reminder; middle reminder; late reminder. 1 more reminder.'
  assert.deepEqual(harness.spoken, [expected])
  assert.equal(harness.messages.length, 1)
  assert.equal(harness.bubbles.length, 1)

  pending.interruptLatest()
  await flushMicrotasks()

  // Wait another prefix-sized window while the session is still active so a
  // merged-text replay would re-add the prefix, then release normally.
  harness.continuousVoiceActiveRef.current = true
  harness.voiceStateRef.current = 'listening'
  harness.advance(60_000)
  harness.continuousVoiceActiveRef.current = false
  harness.voiceStateRef.current = 'idle'
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [expected, expected], 'replay uses the original reminders')
  assert.equal(
    (harness.spoken[1].match(/1 more reminder\./gu) ?? []).length,
    1,
    'the replay does not nest the more line',
  )
  assert.equal((harness.spoken[1].match(/While we were chatting/gu) ?? []).length, 1)
  assert.equal(harness.messages.length, 1, 'replay does not duplicate the chat line')
  assert.equal(harness.bubbles.length, 1, 'replay does not duplicate the bubble')

  pending.resolveLatest()
  await flushMicrotasks()
  harness.unmount()
})

test('all punctuation-only reminders produce only a chat line', async () => {
  const harness = createHarness()
  await harness.api.pushCompanionNotice({
    chatContent: '。',
    bubbleContent: '。',
    speechContent: '。',
    reminderId: 'dots',
    reminderDueAt: 1,
  })
  await harness.api.pushCompanionNotice({
    chatContent: '!!',
    bubbleContent: '!!',
    speechContent: '!!',
    reminderId: 'bangs',
    reminderDueAt: 2,
  })
  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()

  assert.deepEqual(harness.messages, ['。\n!!'])
  assert.deepEqual(harness.spoken, [], 'no TTS for punctuation-only reminders')
  assert.deepEqual(harness.bubbles, [], 'no bubble for punctuation-only reminders')
  harness.unmount()
})

test('stop-all keeps a deliverable reminder when another queued reminder is dropped', async () => {
  const dropped = new Set(['x'])
  const harness = createHarness({
    shouldDropDeferredNotice: (payload) => dropped.has(payload.reminderId ?? ''),
  })
  await harness.api.pushCompanionNotice(reminder('x', 'x'))
  await harness.api.pushCompanionNotice(reminder('y', 'y'))

  emitSpeechStopAll()
  await flushMicrotasks()

  assert.deepEqual(harness.messages, ['title-y: y'])
  assert.doesNotMatch(harness.messages[0], /title-x/u)
  assert.deepEqual(harness.spoken, [])
  harness.unmount()
})

test('stop-all appends one merged chat line without speaking or bubbling', async () => {
  const harness = createHarness()
  await harness.api.pushCompanionNotice(reminder('a', 'a'))
  await harness.api.pushCompanionNotice(reminder('b', 'b'))
  assert.deepEqual(harness.messages, [])

  emitSpeechStopAll()
  await flushMicrotasks()

  assert.deepEqual(harness.messages, ['title-a: a\ntitle-b: b'])
  assert.deepEqual(harness.spoken, [], 'stop-all never speaks the queued reminders')
  assert.deepEqual(harness.bubbles, [], 'stop-all never opens a pet bubble')
  assert.equal(harness.api.hasDeferredCompanionNotices(), false)
  assert.equal(harness.timers.pending(), 0, 'stop-all clears the release timers')

  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [], 'nothing replays after stop-all')
  assert.deepEqual(harness.messages, ['title-a: a\ntitle-b: b'])
  harness.unmount()
})

test('stop-all skips a speech-only replay and keeps only the normal reminder line', async () => {
  const pending = pendingSpeech()
  const harness = createHarness({ speakAssistantReply: pending.speak })
  await harness.api.pushCompanionNotice(reminder('replayed', 'replayed'))

  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()
  assert.equal(harness.messages.length, 1)
  assert.equal(harness.bubbles.length, 1)
  assert.equal(harness.spoken.length, 1)

  pending.interruptLatest()
  await flushMicrotasks()

  harness.continuousVoiceActiveRef.current = true
  harness.voiceStateRef.current = 'listening'
  await harness.api.pushCompanionNotice(reminder('normal', 'normal'))
  const spokenBeforeStop = harness.spoken.length
  const bubblesBeforeStop = harness.bubbles.length

  emitSpeechStopAll()
  await flushMicrotasks()

  assert.equal(harness.messages.length, 2, 'only one new line is appended')
  assert.equal(harness.messages[1], 'title-normal: normal')
  assert.doesNotMatch(harness.messages[1], /replayed/u, 'the speech-only replay is not duplicated')
  assert.equal(harness.spoken.length, spokenBeforeStop, 'stop-all does not speak')
  assert.equal(harness.bubbles.length, bubblesBeforeStop, 'stop-all does not bubble')
  assert.equal(harness.api.hasDeferredCompanionNotices(), false)

  harness.continuousVoiceActiveRef.current = false
  harness.voiceStateRef.current = 'idle'
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()
  assert.equal(harness.spoken.length, spokenBeforeStop, 'the speech-only replay is gone for good')
  harness.unmount()
})

test('stop-all appends nothing when every queued entry is a speech-only replay', async () => {
  const pending = pendingSpeech()
  const harness = createHarness({ speakAssistantReply: pending.speak })
  await harness.api.pushCompanionNotice(reminder('replayed-only', 'replayed only'))
  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()
  pending.interruptLatest()
  await flushMicrotasks()

  const messagesBeforeStop = harness.messages.length
  const spokenBeforeStop = harness.spoken.length
  emitSpeechStopAll()
  await flushMicrotasks()

  assert.equal(harness.messages.length, messagesBeforeStop, 'no duplicate chat line')
  assert.equal(harness.spoken.length, spokenBeforeStop, 'no replay speech')
  assert.equal(harness.api.hasDeferredCompanionNotices(), false)
  harness.unmount()
})

test('stop-all does not append reminders dropped by DND or a paused row', async () => {
  let dnd = false
  const harness = createHarness({ shouldDropDeferredNotice: () => dnd })
  await harness.api.pushCompanionNotice(reminder('dnd-stop', 'dnd stop'))
  dnd = true
  emitSpeechStopAll()
  await flushMicrotasks()
  assert.deepEqual(harness.messages, [], 'dropped reminders never become a chat line')
  assert.deepEqual(harness.spoken, [])
  harness.unmount()
})

test('session:completed before tts:completed and the 15 s fallback never flush mid-session', async () => {
  const harness = createHarness()
  await harness.api.pushCompanionNotice(reminder('gap', 'gap reminder'))

  harness.bus.emit({ type: 'session:completed' })
  harness.bus.emit({ type: 'tts:completed', speechGeneration: 1, shouldResumeContinuousVoice: true })
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [], 'completion events only re-arm during continuous voice')

  harness.advance(15_000)
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [], 'the fallback also waits mid-session')

  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, ['gap reminder.'], 'release after the session ends')
  assert.equal(harness.timers.pending(), 0, 'all timers are cleared after release')

  harness.advance(30_000)
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, ['gap reminder.'], 'no late extra flush')
  harness.unmount()
})

test('the 15 s fallback releases within 15 s once the continuous flag goes false', async () => {
  const harness = createHarness()
  await harness.api.pushCompanionNotice(reminder('fallback', 'fallback reminder'))

  harness.bus.emit({ type: 'tts:completed', speechGeneration: 1, shouldResumeContinuousVoice: true })
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [])

  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.advance(15_000)
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, ['fallback reminder.'])
  harness.unmount()
})

test('a 5 s gap does not trip the stuck fallback, and a voice event resets the 30 s window', async () => {
  const harness = createHarness()
  await harness.api.pushCompanionNotice(reminder('stuck', 'stuck reminder'))
  harness.voiceStateRef.current = 'idle'

  harness.advance(5_000)
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [], '5 s is not a stuck session')

  harness.bus.emit({ type: 'vad:speech_start' })
  harness.advance(29_000)
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [], 'a voice event restarts the stuck window')

  harness.advance(1_000)
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, ['stuck reminder.'], '30 s with no event releases once')
  assert.equal(harness.timers.pending(), 0)

  harness.advance(30_000)
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, ['stuck reminder.'], 'the stuck fallback never double releases')
  harness.unmount()
})

test('Do-Not-Disturb while queued drops the reminder instead of replaying it', async () => {
  let dnd = false
  const harness = createHarness({
    shouldDropDeferredNotice: () => dnd,
  })
  await harness.api.pushCompanionNotice(reminder('dnd', 'dnd reminder'))
  assert.deepEqual(harness.spoken, [])

  dnd = true
  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [], 'DND drops the queued reminder')
  assert.equal(harness.api.hasDeferredCompanionNotices(), false)
  harness.unmount()
})

test('pausing the reminder while queued drops it instead of replaying it', async () => {
  let paused = false
  const harness = createHarness({
    shouldDropDeferredNotice: (payload) => paused && payload.reminderId === 'paused',
  })
  await harness.api.pushCompanionNotice(reminder('paused', 'paused reminder'))
  paused = true
  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [], 'reminders off drops the queued item')
  harness.unmount()
})

test('a fresh queue has nothing to replay after restart', async () => {
  const harness = createHarness()
  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [], 'no phantom replay from an empty in-memory queue')
  harness.unmount()
})

test('panel inherits the pet continuous-voice flag and holds reminders', async () => {
  const merged = mergeContinuousVoiceActive({
    view: 'panel',
    localActive: false,
    petRuntimeActive: true,
  })
  assert.equal(merged, true, 'panel sees the pet continuous session')

  const harness = createHarness({
    voiceStateRef: { current: 'idle' },
    continuousVoiceActiveRef: { current: merged },
    ownContinuousVoiceActiveRef: { current: false },
  })
  await harness.api.pushCompanionNotice(reminder('panel', 'panel reminder'))
  assert.deepEqual(harness.spoken, [], 'panel queues while the pet is in continuous voice')
  harness.unmount()
})

test('queue/release/drop logs never include reminder text or user speech', async () => {
  const captured: unknown[][] = []
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const
  const originals = methods.map((method) => console[method])
  for (const method of methods) {
    console[method] = (...args: unknown[]) => { captured.push(args) }
  }
  const harness = createHarness({
    shouldDropDeferredNotice: (payload) => payload.reminderId === 'drop-secret',
  })
  try {
    await harness.api.pushCompanionNotice(reminder(
      'secret',
      'SECRET-REMINDER-TITLE',
      1,
      'SECRET-USER-SPEECH',
    ))
    harness.voiceStateRef.current = 'idle'
    harness.continuousVoiceActiveRef.current = false
    harness.bus.emit({ type: 'session:completed' })
    await flushMicrotasks()

    await harness.api.pushCompanionNotice(reminder('drop-secret', 'SECRET-REMINDER-TITLE'))
    harness.bus.emit({ type: 'session:completed' })
    await flushMicrotasks()
  } finally {
    for (const [index, method] of methods.entries()) {
      console[method] = originals[index]
    }
    harness.unmount()
  }

  const text = captured.flat().map((value) => String(value)).join('\n')
  assert.doesNotMatch(text, /SECRET-REMINDER-TITLE/)
  assert.doesNotMatch(text, /SECRET-USER-SPEECH/)
})
