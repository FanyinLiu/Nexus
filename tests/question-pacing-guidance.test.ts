import assert from 'node:assert/strict'
import { test } from 'node:test'

import { QUESTION_PACING_GUIDANCE } from '../src/features/chat/questionPacingGuidance.ts'

test('question-pacing guidance discourages ending every reply with a question', () => {
  assert.match(QUESTION_PACING_GUIDANCE, /Not every reply needs to end with a question/)
})

test('question-pacing guidance warns against back-to-back questions', () => {
  assert.match(QUESTION_PACING_GUIDANCE, /two questions in a row/)
  assert.match(QUESTION_PACING_GUIDANCE, /interview/)
})

test('question-pacing guidance normalizes user silence after statements', () => {
  assert.match(QUESTION_PACING_GUIDANCE, /Silence from the user after a statement is fine/)
})
