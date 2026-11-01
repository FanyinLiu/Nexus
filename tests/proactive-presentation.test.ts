import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveProactivePresentation } from '../src/features/proactive/proactivePresentation.ts'
import type { ProactiveMessage } from '../shared/proactiveDelivery.js'

function makeMessage(overrides: Partial<ProactiveMessage> = {}): ProactiveMessage {
  return {
    id: 'msg-1',
    source: 'reminder',
    kind: 'reminder_follow_up',
    priority: 'normal',
    title: 'Stand up',
    body: 'You asked me to remind you.',
    actions: ['done'],
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

test('a strip-routed presentation produces no bubble', () => {
  const bubble = resolveProactivePresentation({
    outlet: 'strip',
    message: makeMessage(),
  })

  assert.equal(bubble, null)
})

test('a bubble presentation uses the message body', () => {
  const bubble = resolveProactivePresentation({
    outlet: 'bubble',
    message: makeMessage({ body: 'Bubble body' }),
  })

  assert.deepEqual(bubble, { content: 'Bubble body' })
})

test('a bubble presentation falls back to the title when the body is empty', () => {
  const bubble = resolveProactivePresentation({
    outlet: 'bubble',
    message: makeMessage({ title: 'Title only', body: '   ' }),
  })

  assert.deepEqual(bubble, { content: 'Title only' })
})

test('a bubble presentation with no text produces no bubble', () => {
  const bubble = resolveProactivePresentation({
    outlet: 'bubble',
    message: makeMessage({ title: '   ', body: '' }),
  })

  assert.equal(bubble, null)
})
