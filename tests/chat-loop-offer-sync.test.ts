import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mergeRemoteChatMessages, normalizeChatMessagesForStorage, remoteApplyConsumedByLocalLine } from '../src/lib/storage/chat.ts'
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

test('a booked reminder stays booked when the other window still asks', () => {
  const local = [message({
    id: 'preview',
    content: '10月20日 9:00，南山出入境大厅。前一晚会提醒你。',
    loopOffer: { ...offer, status: 'booked' },
  })]
  const remote = [message({
    id: 'preview',
    content: '要我前一晚提醒你吗？',
    loopOffer: { ...offer, status: 'pending' },
  })]
  assert.equal(mergeRemoteChatMessages(local, remote)[0]?.loopOffer?.status, 'booked')
})

test('cancelling a booked reminder is not restored by the other window', () => {
  const local = [message({
    id: 'preview',
    content: '已经撤掉。',
    loopOffer: { ...offer, status: 'cancelled' },
  })]
  const remote = [message({
    id: 'preview',
    content: '10月20日 9:00，南山出入境大厅。前一晚会提醒你。',
    loopOffer: { ...offer, status: 'booked' },
  })]
  assert.equal(mergeRemoteChatMessages(local, remote)[0]?.loopOffer?.status, 'cancelled')
})

test('a booked reminder card stays booked after reload', () => {
  const [stored] = normalizeChatMessagesForStorage([message({
    id: 'preview',
    content: '10月20日 9:00，南山出入境大厅。前一晚会提醒你。',
    loopOffer: { ...offer, status: 'booked' },
  })])
  assert.equal(stored?.loopOffer?.status, 'booked')
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

test('a stale shorter transcript does not drop the local reminder card', () => {
  const local = [
    message({ id: 'user', role: 'user', content: '下周二去办护照' }),
    message({
      id: 'preview',
      content: '要我前一晚提醒你吗？',
      loopOffer: { ...offer, status: 'pending' },
    }),
  ]
  const remote = [
    message({ id: 'user', role: 'user', content: '下周二去办护照' }),
  ]
  const merged = mergeRemoteChatMessages(local, remote)
  assert.equal(merged.length, 2)
  assert.equal(merged[1]?.id, 'preview')
  assert.equal(merged[1]?.loopOffer?.status, 'pending')
})

test('an empty remote transcript still clears the local thread', () => {
  const local = [
    message({ id: 'user', role: 'user', content: '下周二去办护照' }),
  ]
  assert.deepEqual(mergeRemoteChatMessages(local, []), [])
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
