import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import type { CompanionNoticePayload } from '../src/hooks/chat/types.ts'
import { shouldDropDeferredReminderNotice } from '../src/features/reminders/deferredNotice.ts'
import { emitSpeechStopAll } from '../src/features/voice/speechStopBus.ts'
import { updateReminderTaskInCollection } from '../src/features/reminders/schedule.ts'
import type { ReminderTask } from '../src/types/index.ts'
import {
  createHarness,
  flushMicrotasks,
  reminder,
} from './helpers/companionNoticeHarness.ts'

function reminderTask(id: string): ReminderTask {
  return {
    id,
    title: `title-${id}`,
    prompt: `prompt-${id}`,
    action: { kind: 'notice' },
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schedule: { kind: 'at', at: '2026-01-01T00:00:00.000Z' },
  }
}

test('panel never self-releases on the inherited flag, then releases after pet sync false', async () => {
  const sharedContinuous = { current: true }
  const panel = createHarness({
    voiceStateRef: { current: 'idle' },
    continuousVoiceActiveRef: sharedContinuous,
    ownContinuousVoiceActiveRef: { current: false },
  })
  await panel.api.pushCompanionNotice(reminder('panel-wait', 'panel wait'))

  panel.advance(60_000)
  await flushMicrotasks()
  assert.deepEqual(panel.spoken, [], 'the panel 30 s fallback must ignore the inherited flag')

  sharedContinuous.current = false
  panel.advance(15_000)
  await flushMicrotasks()
  assert.deepEqual(
    panel.spoken,
    ['While we were chatting, a reminder came up: panel wait.'],
    'the panel releases within 15 s after pet sync',
  )
  panel.unmount()
})

test('pet stuck fallback clears its own flag so the panel eventually releases once', async () => {
  const sharedContinuous = { current: true }
  const petOwn = { current: true }
  const pet = createHarness({
    voiceStateRef: { current: 'idle' },
    continuousVoiceActiveRef: sharedContinuous,
    ownContinuousVoiceActiveRef: petOwn,
    onStuckFallback: () => {
      petOwn.current = false
      sharedContinuous.current = false
    },
  })
  const panel = createHarness({
    voiceStateRef: { current: 'idle' },
    continuousVoiceActiveRef: sharedContinuous,
    ownContinuousVoiceActiveRef: { current: false },
  })
  await pet.api.pushCompanionNotice(reminder('pet-stuck', 'pet stuck'))
  await panel.api.pushCompanionNotice(reminder('panel-after-stuck', 'panel after stuck'))

  panel.advance(60_000)
  await flushMicrotasks()
  assert.deepEqual(panel.spoken, [], 'panel still waits while the pet flag is true')

  pet.advance(30_000)
  await flushMicrotasks()
  assert.deepEqual(pet.spoken, ['pet stuck.'], 'pet stuck fallback releases once')
  assert.equal(petOwn.current, false, 'pet clears its own continuous flag')
  assert.equal(sharedContinuous.current, false, 'pet syncs the merged flag false')

  panel.advance(15_000)
  await flushMicrotasks()
  assert.deepEqual(
    panel.spoken,
    ['While we were chatting, a reminder came up: panel after stuck.'],
    'panel releases exactly once',
  )
  panel.advance(30_000)
  await flushMicrotasks()
  assert.deepEqual(
    panel.spoken,
    ['While we were chatting, a reminder came up: panel after stuck.'],
    'panel does not replay',
  )
  pet.unmount()
  panel.unmount()
})

test('useAppController wires merged and own continuous refs into chat', async () => {
  const source = (await readFile(
    new URL('../src/app/controllers/useAppController.ts', import.meta.url),
    'utf8',
  )).replace(/\r\n/g, '\n')
  const chatBlock = source.match(/const chat = useChat\(\{[\s\S]*?\n[ ]{2}\}\)/u)?.[0] ?? ''
  assert.match(chatBlock, /\n[ ]{4}continuousVoiceActiveRef,\n/u)
  assert.match(chatBlock, /\n[ ]{4}ownContinuousVoiceActiveRef: voice\.continuousVoiceActiveRef,\n/u)
  assert.doesNotMatch(chatBlock, /\n[ ]{4}continuousVoiceActiveRef: voice\.continuousVoiceActiveRef,\n/u)
})

test('English merged playback preserves item casing', async () => {
  const harness = createHarness()
  await harness.api.pushCompanionNotice(reminder('time', 'Time to drink water', 1))
  harness.advance(60_000)
  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()
  assert.deepEqual(
    harness.spoken,
    ['While we were chatting, a reminder came up: Time to drink water.'],
  )
  harness.unmount()
})

test('merged playback never resumes continuous voice', async () => {
  const harness = createHarness()
  await harness.api.pushCompanionNotice({
    ...reminder('resume', 'resume reminder'),
    shouldResumeContinuousVoice: true,
  })
  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, ['resume reminder.'])
  assert.deepEqual(harness.resumeFlags, [false], 'merged reminders never restart the mic')
  harness.unmount()
})

test('N14 an empty queue never clears a stuck continuous session', async () => {
  let stuckFallbackCalls = 0
  let clearContinuousCalls = 0
  const ownContinuous = { current: true }
  const mergedContinuous = { current: true }
  const harness = createHarness({
    voiceStateRef: { current: 'idle' },
    continuousVoiceActiveRef: mergedContinuous,
    ownContinuousVoiceActiveRef: ownContinuous,
    onStuckFallback: () => {
      stuckFallbackCalls += 1
      clearContinuousCalls += 1
      ownContinuous.current = false
      mergedContinuous.current = false
    },
  })

  harness.advance(90_000)
  await flushMicrotasks()
  assert.equal(stuckFallbackCalls, 0, 'an empty queue must not trigger the stuck fallback')
  assert.equal(clearContinuousCalls, 0, 'an empty queue must not clear continuous voice')
  assert.deepEqual(harness.spoken, [])

  await harness.api.pushCompanionNotice(reminder('later', 'later'))
  harness.advance(30_000)
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, ['later.'], 'the queued reminder releases once')
  assert.equal(stuckFallbackCalls, 1, 'the stuck fallback runs once with queued work')
  assert.equal(clearContinuousCalls, 1)
  harness.unmount()
})

test('N16 force fallback never bypasses listening or speaking', async () => {
  for (const voiceState of ['listening', 'speaking'] as const) {
    let stuckFallbackCalls = 0
    const harness = createHarness({
      voiceStateRef: { current: voiceState },
      continuousVoiceActiveRef: { current: true },
      ownContinuousVoiceActiveRef: { current: true },
      onStuckFallback: () => { stuckFallbackCalls += 1 },
    })
    await harness.api.pushCompanionNotice(reminder(`n16-${voiceState}`, 'n16'))
    harness.advance(90_000)
    await flushMicrotasks()
    assert.deepEqual(harness.spoken, [], `${voiceState}: no forced speech`)
    assert.equal(stuckFallbackCalls, 0, `${voiceState}: no stuck release`)
    harness.unmount()
  }
})

test('M3c useAppController keeps the pet runtime flag in the merged ref', async () => {
  const source = (await readFile(
    new URL('../src/app/controllers/useAppController.ts', import.meta.url),
    'utf8',
  )).replace(/\r\n/g, '\n')
  assert.match(
    source,
    /mergeContinuousVoiceActive\(\{\n[ ]{6}view,\n[ ]{6}localActive: voice\.continuousVoiceActive,\n[ ]{6}petRuntimeActive: petRuntimeContinuousVoiceActive,\n[ ]{4}\}\)/u,
  )
  assert.doesNotMatch(source, /petRuntimeActive:\s*false/u)
})

test('N2 onStuckFallback clears the continuous voice session', async () => {
  const source = (await readFile(
    new URL('../src/hooks/useChat.ts', import.meta.url),
    'utf8',
  )).replace(/\r\n/g, '\n')
  assert.match(
    source,
    /onStuckFallback: \(\) => ctxRef\.current\.setContinuousVoiceSession\(false\)/u,
  )
})

test('N13 start failure clears the continuous voice session', async () => {
  const source = (await readFile(
    new URL('../src/hooks/voice/voiceLifecycleControls.ts', import.meta.url),
    'utf8',
  )).replace(/\r\n/g, '\n')
  assert.match(
    source,
    /catch \(err\) \{[\s\S]*?bindings\.setContinuousVoiceSession\(false\)/u,
  )
})

test('stop-all keeps y when x is paused through the reminder task store', async () => {
  const pausedTasks = updateReminderTaskInCollection(
    [reminderTask('x'), reminderTask('y')],
    'x',
    { enabled: false },
  ).tasks
  const harness = createHarness({
    shouldDropDeferredNotice: (payload) => shouldDropDeferredReminderNotice({
      reminderId: payload.reminderId,
      tasks: pausedTasks,
      quietUntil: null,
      now: Date.now(),
    }),
  })
  await harness.api.pushCompanionNotice(reminder('x', 'x'))
  await harness.api.pushCompanionNotice(reminder('y', 'y'))

  emitSpeechStopAll()
  await flushMicrotasks()

  assert.deepEqual(harness.messages, ['title-y: y'])
  assert.doesNotMatch(harness.messages[0], /title-x/u)
  assert.deepEqual(harness.spoken, [], 'stop-all does not speak')
  assert.deepEqual(harness.bubbles, [], 'stop-all does not bubble')
  harness.unmount()
})

test('idle DND push keeps main immediate delivery for reminder, channel and capsule', async () => {
  const cases: Array<[string, CompanionNoticePayload]> = [
    ['reminder', reminder('dnd-reminder', 'dnd reminder')],
    ['channel announcement', {
      chatContent: 'channel announcement',
      bubbleContent: 'channel announcement',
      speechContent: 'channel announcement',
      dedupeKey: 'channel-announcement',
    }],
    ['capsule', {
      chatContent: 'capsule letter',
      bubbleContent: 'capsule letter',
      speechContent: 'capsule letter',
      dedupeKey: 'capsule-letter',
    }],
  ]

  for (const [name, payload] of cases) {
    const harness = createHarness({
      voiceStateRef: { current: 'idle' },
      continuousVoiceActiveRef: { current: false },
      shouldDropDeferredNotice: () => true,
    })
    await harness.api.pushCompanionNotice(payload)
    assert.deepEqual(harness.messages, [payload.chatContent], `${name}: chat line`)
    assert.deepEqual(harness.bubbles, [payload.bubbleContent], `${name}: bubble`)
    assert.deepEqual(harness.spoken, [payload.speechContent], `${name}: speech`)
    harness.unmount()
  }
})
