import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loopNoteProps } from '../src/components/loopNoteProps.ts'

test('a chat line hands its overdue check to the reminder card', () => {
  const props = loopNoteProps({
    id: 'm1',
    loopCheck: { memoryId: 'loop-1', status: 'pending' },
  })
  assert.deepEqual(props, {
    messageId: 'm1',
    loopCheck: { memoryId: 'loop-1', status: 'pending' },
  })
})

test('a chat line hands over every field it carries', () => {
  const loopOffer = {
    memoryId: 'loop-1',
    title: '下周二去办护照',
    nightBeforeAt: '2026-10-19T12:00:00.000Z',
    status: 'booked' as const,
  }
  const proactiveWhy = {
    summary: '下周二去办护照',
    quote: '下周二去办护照',
    at: '2026-10-16T03:00:00.000Z',
  }
  const props = loopNoteProps({
    id: 'm2',
    loopOffer,
    loopCheck: { memoryId: 'loop-1', status: 'later' },
    proactiveWhy,
  })
  assert.equal(props.messageId, 'm2')
  assert.equal(props.loopOffer, loopOffer)
  assert.deepEqual(props.loopCheck, { memoryId: 'loop-1', status: 'later' })
  assert.equal(props.proactiveWhy, proactiveWhy)
})

test('a chat line without a card carries no card fields', () => {
  const props = loopNoteProps({ id: 'm3' })
  assert.deepEqual(props, { messageId: 'm3' })
  assert.equal('loopOffer' in props, false)
  assert.equal('loopCheck' in props, false)
  assert.equal('proactiveWhy' in props, false)
})
