import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveImage4ActivityLabelKey } from '../src/app/views/image4ActivityLabel.ts'

test('resolveImage4ActivityLabelKey maps Image4 activity state to companion copy', () => {
  assert.equal(resolveImage4ActivityLabelKey({
    activityState: 'idle',
    mode: 'idle',
  }), 'panel.activity.idle')

  assert.equal(resolveImage4ActivityLabelKey({
    activityState: 'preparing_reply',
    mode: 'attentive',
  }), 'panel.activity.preparing_reply')

  assert.equal(resolveImage4ActivityLabelKey({
    activityState: 'speaking',
    mode: 'speaking',
  }), 'panel.activity.speaking')
})

test('resolveImage4ActivityLabelKey keeps resting as quiet companion presence', () => {
  assert.equal(resolveImage4ActivityLabelKey({
    activityState: 'context_available',
    mode: 'resting',
  }), 'panel.activity.quiet')
})
