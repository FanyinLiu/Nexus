import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mergeRemoteChatMessages, remoteApplyConsumedByLocalLine } from '../src/lib/storage/chat.ts'
import type { ChatMessage } from '../src/types/chat.ts'

function message(patch: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'content'>): ChatMessage {
  return {
    role: 'assistant',
    createdAt: '2026-10-16T03:00:00.000Z',
    ...patch,
  }
}

const offer = {
  memoryId: 'loop-1',
  title: '下周二去办护照',
  nightBeforeAt: '2026-10-19T12:00:00.000Z',
}

test('a decided night-before card is not put back to pending by the other window', () => {
  const local = [message({
    id: 'preview',
    content: '要我前一晚提醒你吗？',
    loopOffer: { ...offer, status: 'accepted' },
  })]
  const remote = [
    message({
      id: 'preview',
      content: '要我前一晚提醒你吗？',
      loopOffer: { ...offer, status: 'pending' },
    }),
    message({ id: 'check', content: '办好了吗？' }),
  ]
  const merged = mergeRemoteChatMessages(local, remote)
  assert.equal(merged[0]?.loopOffer?.status, 'accepted')
  assert.equal(merged[1]?.content, '办好了吗？')
})

test('a local line in the same commit as a remote apply is still saved', () => {
  assert.equal(remoteApplyConsumedByLocalLine('2:preview:12::pending', '3:check:6::pending.-'), true)
  assert.equal(remoteApplyConsumedByLocalLine('2:preview:12::pending', '2:preview:12::pending'), false)
  assert.equal(remoteApplyConsumedByLocalLine(null, '1:hello:5::-'), false)
})

test('a remote decision still wins when this window has not answered', () => {
  const local = [message({
    id: 'preview',
    content: '要我前一晚提醒你吗？',
    loopOffer: { ...offer, status: 'pending' },
    images: ['data:image/png;base64,abc'],
  })]
  const remote = [message({
    id: 'preview',
    content: '要我前一晚提醒你吗？',
    loopOffer: { ...offer, status: 'declined' },
  })]
  const merged = mergeRemoteChatMessages(local, remote)
  assert.equal(merged[0]?.loopOffer?.status, 'declined')
  assert.deepEqual(merged[0]?.images, ['data:image/png;base64,abc'])
})

test('a decided check card is not put back to pending by the other window', () => {
  const local = [message({
    id: 'check',
    content: '办好了吗？',
    loopCheck: { memoryId: 'loop-1', status: 'done' },
  })]
  const remote = [message({
    id: 'check',
    content: '办好了吗？',
    loopCheck: { memoryId: 'loop-1', status: 'pending' },
  })]
  const merged = mergeRemoteChatMessages(local, remote)
  assert.equal(merged[0]?.loopCheck?.status, 'done')
})
