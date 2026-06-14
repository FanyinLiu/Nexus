import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REUNION_GUIDANCE } from '../src/features/chat/reunionGuidance.ts'

test('reunion guidance discourages formulaic greetings', () => {
  assert.match(REUNION_GUIDANCE, /don't need to formally greet/)
  assert.match(REUNION_GUIDANCE, /not ceremonies/)
})

test('reunion guidance encourages varied, context-aware openers', () => {
  assert.match(REUNION_GUIDANCE, /pick up a thread/)
  assert.match(REUNION_GUIDANCE, /notice what time it is/)
  assert.match(REUNION_GUIDANCE, /match the energy/)
})

test('reunion guidance tells model to skip greeting when user leads with content', () => {
  assert.match(REUNION_GUIDANCE, /go straight to it/)
  assert.match(REUNION_GUIDANCE, /don't prepend a greeting/)
})
