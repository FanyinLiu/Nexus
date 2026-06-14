import assert from 'node:assert/strict'
import { test } from 'node:test'

import { TOPIC_EXHAUSTION_GUIDANCE } from '../src/features/chat/topicExhaustionGuidance.ts'

test('topic-exhaustion guidance recognizes winding-down signals', () => {
  assert.match(TOPIC_EXHAUSTION_GUIDANCE, /shorter answers/)
  assert.match(TOPIC_EXHAUSTION_GUIDANCE, /echoing/)
})

test('topic-exhaustion guidance discourages extracting one last insight', () => {
  assert.match(TOPIC_EXHAUSTION_GUIDANCE, /do not need to extract/)
  assert.match(TOPIC_EXHAUSTION_GUIDANCE, /squeezing/)
})

test('topic-exhaustion guidance trusts the user to return if they want', () => {
  assert.match(TOPIC_EXHAUSTION_GUIDANCE, /they will/)
})
