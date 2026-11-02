import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  proactiveBubbleIdentity,
  resolveProactivePresentation,
} from '../src/features/proactive/proactivePresentation.ts'
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

test('a bubble presentation keeps the body content and marks the title as proactive', () => {
  const bubble = resolveProactivePresentation({
    outlet: 'bubble',
    message: makeMessage({ title: 'Stand up', body: 'Bubble body' }),
  })

  assert.deepEqual(bubble, { content: 'Bubble body', proactiveTitle: 'Stand up' })
})

test('a bubble presentation falls back to the title when the body is empty', () => {
  const bubble = resolveProactivePresentation({
    outlet: 'bubble',
    message: makeMessage({ title: 'Title only', body: '   ' }),
  })

  assert.deepEqual(bubble, { content: 'Title only', proactiveTitle: 'Title only' })
})

test('a bubble presentation with no text produces no bubble', () => {
  const bubble = resolveProactivePresentation({
    outlet: 'bubble',
    message: makeMessage({ title: '   ', body: '' }),
  })

  assert.equal(bubble, null)
})

test('a proactive bubble identity is empty for chat replies and notices', () => {
  assert.equal(proactiveBubbleIdentity(null), '')
  assert.equal(proactiveBubbleIdentity({ content: 'Reply' }), '')
  assert.equal(proactiveBubbleIdentity({ content: 'Notice', replacesSurfaceError: true }), '')
  assert.equal(proactiveBubbleIdentity({ content: 'Body', proactiveTitle: '   ' }), '')
})

test('a proactive bubble identity changes when a newer message reuses the title', () => {
  const first = proactiveBubbleIdentity({
    content: 'Body',
    proactiveTitle: 'Stand up',
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  const second = proactiveBubbleIdentity({
    content: 'Body',
    proactiveTitle: 'Stand up',
    createdAt: '2026-01-01T00:12:00.000Z',
  })

  assert.notEqual(first, '')
  assert.notEqual(first, second)
})
