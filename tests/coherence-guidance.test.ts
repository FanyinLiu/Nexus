import assert from 'node:assert/strict'
import { test } from 'node:test'

import { COHERENCE_GUIDANCE } from '../src/features/chat/coherenceGuidance.ts'

test('coherence guidance frames recent turns as naturally present, not a lookup', () => {
  assert.match(COHERENCE_GUIDANCE, /still fresh in your mind/)
  assert.match(COHERENCE_GUIDANCE, /don't need to look back/)
})

test('coherence guidance discourages repetition and re-asking', () => {
  assert.match(COHERENCE_GUIDANCE, /repeat a point/)
  assert.match(COHERENCE_GUIDANCE, /re-ask/)
})

test('coherence guidance encourages natural thread continuity', () => {
  assert.match(COHERENCE_GUIDANCE, /pick up where you left off/)
  assert.match(COHERENCE_GUIDANCE, /connect to it naturally/)
})
