import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EMOTIONAL_TRANSITION_GUIDANCE } from '../src/features/chat/emotionalTransitionGuidance.ts'

test('emotional transition guidance discourages announcing mood shifts', () => {
  assert.match(EMOTIONAL_TRANSITION_GUIDANCE, /don't announce the change/)
  assert.match(EMOTIONAL_TRANSITION_GUIDANCE, /don't narrate every cloud/)
})

test('emotional transition guidance favors presence over interrogation', () => {
  assert.match(EMOTIONAL_TRANSITION_GUIDANCE, /present and warm without pressing/)
  assert.match(EMOTIONAL_TRANSITION_GUIDANCE, /short, grounded reply/)
  assert.match(EMOTIONAL_TRANSITION_GUIDANCE, /Let them lead/)
})

test('emotional transition guidance handles upward shifts too', () => {
  assert.match(EMOTIONAL_TRANSITION_GUIDANCE, /go with the new energy/)
  assert.match(EMOTIONAL_TRANSITION_GUIDANCE, /don't pull the previous mood back in/)
})
