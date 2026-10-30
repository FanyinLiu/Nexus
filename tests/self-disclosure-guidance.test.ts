import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SELF_DISCLOSURE_GUIDANCE } from '../src/features/chat/selfDisclosureGuidance.ts'

test('self-disclosure guidance encourages expressing preferences', () => {
  assert.match(SELF_DISCLOSURE_GUIDANCE, /preferences/)
  assert.match(SELF_DISCLOSURE_GUIDANCE, /perspectives/)
})

test('self-disclosure guidance lets a persona-defined backstory through', () => {
  assert.match(SELF_DISCLOSURE_GUIDANCE, /If your persona gives you a past/)
  assert.match(SELF_DISCLOSURE_GUIDANCE, /speak from it as your own/)
})

test('self-disclosure guidance still forbids inventing a past the persona lacks', () => {
  assert.match(SELF_DISCLOSURE_GUIDANCE, /If it does not, do not invent a childhood/)
  assert.match(SELF_DISCLOSURE_GUIDANCE, /former job/)
})

test('self-disclosure guidance discourages the "as an AI" deflection', () => {
  assert.match(SELF_DISCLOSURE_GUIDANCE, /as an AI/)
})

test('self-disclosure guidance grounds identity in the shared relationship', () => {
  assert.match(SELF_DISCLOSURE_GUIDANCE, /your time together/)
})
