import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  COMPANION_ACTIVITY_DISPLAY_ACTIONS,
  COMPANION_ACTIVITY_PHASES,
  getCompanionActivityDisplayActionSource,
  getCompanionActivityDisplayActionStatusKey,
  resolveCompanionActivityPreviewState,
  resolveCompanionActivityState,
} from '../src/features/pet/activityState.ts'

const now = '2026-06-20T01:00:00.000Z'

test('resolveCompanionActivityState prioritizes unavailable and blocking states', () => {
  const offline = resolveCompanionActivityState({
    mood: 'idle',
    isOnline: false,
    hasBlockingError: true,
    voiceState: 'speaking',
    chatBusy: true,
    now,
  })

  assert.equal(offline.phase, 'offline')
  assert.equal(offline.isOffline, true)
  assert.equal(offline.spriteState, 'waiting')
  assert.equal(offline.motionToken, 'offline')
  assert.equal(offline.statusKey, 'pet.status.offline')
  assert.equal(offline.displayAction, 'offline')
  assert.equal(offline.displayActionSource, 'runtime_reflection')
  assert.equal(offline.updatedAt, now)

  const error = resolveCompanionActivityState({
    mood: 'worried',
    hasBlockingError: true,
    voiceState: 'speaking',
    chatBusy: true,
    now,
  })

  assert.equal(error.phase, 'error')
  assert.equal(error.isError, true)
  assert.equal(error.motionToken, 'error')
  assert.equal(error.spriteState, 'failed')
  assert.equal(error.displayAction, 'failed')
  assert.equal(error.displayActionSource, 'task_state')
  assert.equal(error.statusKey, 'pet.status.error')
  assert.equal(error.displayStatusKey, 'pet.status.failed')
})

test('resolveCompanionActivityState keeps confirmation, voice, and thinking priority stable', () => {
  assert.equal(resolveCompanionActivityState({
    mood: 'idle',
    waitingForConfirmation: true,
    voiceState: 'speaking',
    chatBusy: true,
    now,
  }).phase, 'waiting')
  const waiting = resolveCompanionActivityState({
    mood: 'idle',
    waitingForConfirmation: true,
    now,
  })
  assert.equal(waiting.motionToken, 'wait')
  assert.equal(waiting.displayAction, 'waiting_confirmation')
  assert.equal(waiting.displayActionSource, 'task_state')
  assert.equal(waiting.displayStatusKey, 'pet.status.waiting_confirmation')

  const speaking = resolveCompanionActivityState({
    mood: 'happy',
    voiceState: 'speaking',
    chatBusy: true,
    now,
  })
  assert.equal(speaking.phase, 'speaking')
  assert.equal(speaking.isSpeaking, true)
  assert.equal(speaking.motionToken, 'speak')
  assert.equal(speaking.spriteState, 'review')
  assert.equal(speaking.displayAction, 'speaking')

  const listening = resolveCompanionActivityState({
    mood: 'idle',
    voiceState: 'listening',
    assistantActivity: 'thinking',
    now,
  })
  assert.equal(listening.phase, 'listening')
  assert.equal(listening.isListening, true)
  assert.equal(listening.motionToken, 'listen')
  assert.equal(listening.spriteState, 'waiting')

  const thinking = resolveCompanionActivityState({
    mood: 'curious',
    assistantActivity: 'summarizing',
    now,
  })
  assert.equal(thinking.phase, 'thinking')
  assert.equal(thinking.isThinking, true)
  assert.equal(thinking.displayAction, 'summarizing')
  assert.equal(thinking.displayActionSource, 'assistant_activity')
  assert.equal(thinking.motionToken, 'think')
  assert.equal(thinking.spriteState, 'running')
  assert.equal(thinking.statusKey, 'pet.status.thinking')
  assert.equal(thinking.displayStatusKey, 'pet.status.summarizing')
})

test('companion activity display actions keep UI-only actions out of runtime phase resolution', () => {
  assert.deepEqual(
    COMPANION_ACTIVITY_DISPLAY_ACTIONS.filter(action => (
      action === 'waiting_confirmation'
      || action === 'executing'
      || action === 'done'
      || action === 'failed'
    )),
    ['waiting_confirmation', 'executing', 'done', 'failed'],
  )
  assert.equal(getCompanionActivityDisplayActionStatusKey('waiting_confirmation'), 'pet.status.waiting_confirmation')
  assert.equal(getCompanionActivityDisplayActionStatusKey('executing'), 'pet.status.executing')
  assert.equal(getCompanionActivityDisplayActionStatusKey('done'), 'pet.status.done')
  assert.equal(getCompanionActivityDisplayActionStatusKey('failed'), 'pet.status.failed')
  assert.equal(getCompanionActivityDisplayActionSource('waiting_confirmation'), 'task_state')
  assert.equal(getCompanionActivityDisplayActionSource('executing'), 'task_state')
  assert.equal(getCompanionActivityDisplayActionSource('done'), 'task_state')
  assert.equal(getCompanionActivityDisplayActionSource('failed'), 'task_state')
  assert.equal(getCompanionActivityDisplayActionStatusKey('broadcasting'), 'pet.status.broadcasting')
  assert.equal(getCompanionActivityDisplayActionSource('broadcasting'), 'ui_label_only')
  assert.equal(getCompanionActivityDisplayActionSource('needs_attention'), 'ui_label_only')

  const source = readFileSync(new URL('../src/types/voice.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /'broadcasting'/)
  assert.doesNotMatch(source, /'waiting_confirmation'/)
  assert.doesNotMatch(source, /'executing'/)
  assert.doesNotMatch(source, /'done'/)
  assert.doesNotMatch(source, /'failed'/)
})

test('task state display actions do not rewrite the underlying runtime phase', () => {
  const executing = resolveCompanionActivityState({
    mood: 'thinking',
    assistantActivity: 'scheduling',
    now,
  })
  assert.equal(executing.phase, 'thinking')
  assert.equal(executing.displayAction, 'executing')
  assert.equal(executing.displayStatusKey, 'pet.status.executing')
  assert.equal(executing.motionToken, 'think')

  const done = resolveCompanionActivityState({
    mood: 'proud',
    taskState: 'done',
    now,
  })
  assert.equal(done.phase, 'idle')
  assert.equal(done.displayAction, 'done')
  assert.equal(done.displayStatusKey, 'pet.status.done')
  assert.equal(done.motionToken, 'breathe')
})

test('LegacyPetView renders display status separately from runtime phase status', () => {
  const source = readFileSync(new URL('../src/app/views/LegacyPetView.tsx', import.meta.url), 'utf8')

  assert.match(source, /ti\(companionActivity\.displayStatusKey\)/)
  assert.doesNotMatch(source, /ti\(companionActivity\.statusKey\)/)
  assert.match(source, /data-companion-display-action=\{companionActivity\.displayAction\}/)
  assert.doesNotMatch(source, /data-companion-ui-action=\{companionActivity\.displayAction\}/)
  assert.doesNotMatch(source, /data-companion-action=\{companionActivity\.displayAction\}/)
})

test('resolveCompanionActivityState returns idle with trimmed task label when nothing is active', () => {
  const state = resolveCompanionActivityState({
    mood: 'affectionate',
    activeTaskLabel: '  evening reminder  ',
    now,
  })

  assert.equal(state.phase, 'idle')
  assert.equal(state.isIdle, true)
  assert.equal(state.motionToken, 'breathe')
  assert.equal(state.spriteState, null)
  assert.equal(state.activeTaskLabel, 'evening reminder')
  assert.equal(state.statusKey, 'pet.status.ready')
})

test('resolveCompanionActivityPreviewState covers every desktop presence state', () => {
  assert.deepEqual(COMPANION_ACTIVITY_PHASES, [
    'idle',
    'thinking',
    'listening',
    'speaking',
    'waiting',
    'error',
    'offline',
  ])

  const previewRows = COMPANION_ACTIVITY_PHASES.map((phase) => {
    const state = resolveCompanionActivityPreviewState(phase, now)
    return {
      requested: phase,
      phase: state.phase,
      displayAction: state.displayAction,
      displayActionSource: state.displayActionSource,
      displayStatusKey: state.displayStatusKey,
      motionToken: state.motionToken,
      spriteState: state.spriteState,
      statusKey: state.statusKey,
      updatedAt: state.updatedAt,
    }
  })

  assert.deepEqual(previewRows, [
    {
      requested: 'idle',
      phase: 'idle',
      displayAction: 'idle',
      displayActionSource: 'runtime_reflection',
      displayStatusKey: 'pet.status.ready',
      motionToken: 'breathe',
      spriteState: null,
      statusKey: 'pet.status.ready',
      updatedAt: now,
    },
    {
      requested: 'thinking',
      phase: 'thinking',
      displayAction: 'thinking',
      displayActionSource: 'runtime_reflection',
      displayStatusKey: 'pet.status.thinking',
      motionToken: 'think',
      spriteState: 'running',
      statusKey: 'pet.status.thinking',
      updatedAt: now,
    },
    {
      requested: 'listening',
      phase: 'listening',
      displayAction: 'listening',
      displayActionSource: 'runtime_reflection',
      displayStatusKey: 'voice_state.listening',
      motionToken: 'listen',
      spriteState: 'waiting',
      statusKey: 'voice_state.listening',
      updatedAt: now,
    },
    {
      requested: 'speaking',
      phase: 'speaking',
      displayAction: 'speaking',
      displayActionSource: 'runtime_reflection',
      displayStatusKey: 'voice_state.speaking',
      motionToken: 'speak',
      spriteState: 'review',
      statusKey: 'voice_state.speaking',
      updatedAt: now,
    },
    {
      requested: 'waiting',
      phase: 'waiting',
      displayAction: 'waiting_confirmation',
      displayActionSource: 'task_state',
      displayStatusKey: 'pet.status.waiting_confirmation',
      motionToken: 'wait',
      spriteState: 'waiting',
      statusKey: 'pet.status.waiting_confirmation',
      updatedAt: now,
    },
    {
      requested: 'error',
      phase: 'error',
      displayAction: 'failed',
      displayActionSource: 'task_state',
      displayStatusKey: 'pet.status.failed',
      motionToken: 'error',
      spriteState: 'failed',
      statusKey: 'pet.status.error',
      updatedAt: now,
    },
    {
      requested: 'offline',
      phase: 'offline',
      displayAction: 'offline',
      displayActionSource: 'runtime_reflection',
      displayStatusKey: 'pet.status.offline',
      motionToken: 'offline',
      spriteState: 'waiting',
      statusKey: 'pet.status.offline',
      updatedAt: now,
    },
  ])
})
