import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mapCardToPersona } from '../electron/services/characterCardMapper.js'

test('mapCardToPersona writes the assembled persona as systemPrompt, not a placeholder', () => {
  const result = mapCardToPersona({
    data: {
      name: 'Aria',
      description: 'A calm seaside companion.',
      personality: 'Gentle, curious, a little playful.',
      scenario: 'You meet on a quiet pier at dusk.',
    },
  })

  // systemPrompt must carry the real card identity (same as soul.md) so an
  // imported card drives chat even when the per-profile persona flag is off —
  // not the old "[Character card: X]" stub that leaked in as literal text.
  assert.equal(result.profile.systemPrompt, result.files['soul.md'])
  assert.ok(!result.profile.systemPrompt.includes('[Character card:'))
  assert.match(result.profile.systemPrompt, /Aria/)
  assert.match(result.profile.systemPrompt, /Gentle, curious/)
  assert.match(result.profile.systemPrompt, /## Scenario/)
})

test('mapCardToPersona stores post-history instructions separately from soul.md', () => {
  const result = mapCardToPersona({
    data: {
      name: 'Aria',
      description: 'A calm seaside companion.',
      post_history_instructions: 'Stay in character after the history; never narrate as the assistant.',
    },
  })

  // Card authors write post_history_instructions to apply after the chat
  // history. Pasting it at the top of soul.md buried it, so it now travels in
  // style.json.postHistory and the post-history reminder injects it there.
  assert.doesNotMatch(result.files['soul.md'], /Stay in character after the history/)
  assert.doesNotMatch(result.files['soul.md'], /Post-History Instructions/)
  const style = JSON.parse(result.files['style.json']) as { postHistory?: string }
  assert.equal(style.postHistory, 'Stay in character after the history; never narrate as the assistant.')
})

test('mapCardToPersona keeps style.json empty when the card has neither tags nor post-history notes', () => {
  const result = mapCardToPersona({ data: { name: 'Aria', description: 'x' } })
  assert.deepEqual(JSON.parse(result.files['style.json']), {})
})
