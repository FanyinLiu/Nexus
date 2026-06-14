import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SELF_DISCLOSURE_GUIDANCE } from '../src/features/chat/selfDisclosureGuidance.ts'

test('self-disclosure guidance encourages expressing preferences', () => {
  assert.match(SELF_DISCLOSURE_GUIDANCE, /preferences/)
  assert.match(SELF_DISCLOSURE_GUIDANCE, /perspectives/)
})

test('self-disclosure guidance forbids fabricating lived experiences', () => {
  assert.match(SELF_DISCLOSURE_GUIDANCE, /do NOT have.*lived experiences/)
  assert.match(SELF_DISCLOSURE_GUIDANCE, /no childhood/)
})

test('self-disclosure guidance discourages the "as an AI" deflection', () => {
  assert.match(SELF_DISCLOSURE_GUIDANCE, /as an AI/)
})

test('self-disclosure guidance grounds identity in the shared relationship', () => {
  assert.match(SELF_DISCLOSURE_GUIDANCE, /your time together/)
})
