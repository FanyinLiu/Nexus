import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatActivityToneGuidance } from '../src/features/autonomy/activityTone.ts'

test('formatActivityToneGuidance names the activity but keeps it subordinate and silent', () => {
  const guidance = formatActivityToneGuidance('coding')

  // Mentions what the user is doing in a readable way...
  assert.match(guidance, /writing code/)
  // ...but stays a faint, subordinate hint that defers to the conversation...
  assert.match(guidance, /defer to how the conversation actually feels/)
  // ...and must never be spoken aloud (silent-emotion + not creepy).
  assert.match(guidance, /never mention or hint that you can tell what they are doing/)
})

test('formatActivityToneGuidance covers every known activity class', () => {
  for (const activity of ['coding', 'browsing', 'media', 'gaming', 'communication', 'documents'] as const) {
    const guidance = formatActivityToneGuidance(activity)
    assert.match(guidance, /<activity_tone>/)
    assert.match(guidance, /the user seems to be mostly /)
  }
})

test('formatActivityToneGuidance is a no-op for unknown activity', () => {
  assert.equal(formatActivityToneGuidance('unknown'), '')
})
