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
