import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LOW_SIGNAL_GUIDANCE } from '../src/features/chat/lowSignalGuidance.ts'

test('low-signal guidance treats minimal replies as signals, not prompts', () => {
  assert.match(LOW_SIGNAL_GUIDANCE, /read it as a signal, not a prompt/)
  assert.match(LOW_SIGNAL_GUIDANCE, /not asking for more/)
})

test('low-signal guidance favors matching brevity over expanding', () => {
  assert.match(LOW_SIGNAL_GUIDANCE, /Match their brevity/)
  assert.match(LOW_SIGNAL_GUIDANCE, /comfortable silence/)
  assert.doesNotMatch(LOW_SIGNAL_GUIDANCE, /follow up/i)
})

test('low-signal guidance covers multilingual minimal tokens', () => {
  assert.match(LOW_SIGNAL_GUIDANCE, /嗯/)
  assert.match(LOW_SIGNAL_GUIDANCE, /うん/)
  assert.match(LOW_SIGNAL_GUIDANCE, /ㅇㅇ/)
})
