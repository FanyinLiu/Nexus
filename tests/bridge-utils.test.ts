import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  createBridgeForwardQueue,
  decideBridgeAutoReply,
  isTelegramVoiceCompatibleMime,
  parseCsvIdSet,
  resolveBridgeReplyTarget,
} from '../src/app/controllers/bridgeUtils.ts'

describe('decideBridgeAutoReply', () => {
  const owner = { isOwner: true }
  const stranger = { isOwner: false }

  test('sends for an owner target with the toggle on', () => {
    assert.deepEqual(
      decideBridgeAutoReply({ autoReplyEnabled: true, permissionMode: 'confirm', target: owner }),
      { kind: 'send' },
    )
    assert.deepEqual(
      decideBridgeAutoReply({ autoReplyEnabled: true, permissionMode: 'auto', target: owner }),
      { kind: 'send' },
    )
  })

  test('never replies to non-owner senders (no companion-as-relay)', () => {
    assert.deepEqual(
      decideBridgeAutoReply({ autoReplyEnabled: true, permissionMode: 'auto', target: stranger }),
      { kind: 'skip', reason: 'not-owner' },
    )
  })

  test('toggle off wins over everything', () => {
    assert.deepEqual(
      decideBridgeAutoReply({ autoReplyEnabled: false, permissionMode: 'auto', target: owner }),
      { kind: 'skip', reason: 'disabled' },
    )
  })

  test('read-only mode blocks even owner replies', () => {
    assert.deepEqual(
      decideBridgeAutoReply({ autoReplyEnabled: true, permissionMode: 'read-only', target: owner }),
      { kind: 'skip', reason: 'read-only' },
    )
  })

  test('no inbound message yet means nothing to reply to', () => {
    assert.deepEqual(
      decideBridgeAutoReply({ autoReplyEnabled: true, permissionMode: 'auto', target: null }),
      { kind: 'skip', reason: 'no-target' },
    )
  })
})

describe('isTelegramVoiceCompatibleMime', () => {
  test('accepts the three voice-bubble containers', () => {
    assert.equal(isTelegramVoiceCompatibleMime('audio/mpeg'), true)
    assert.equal(isTelegramVoiceCompatibleMime('audio/ogg'), true)
    assert.equal(isTelegramVoiceCompatibleMime('audio/mp4'), true)
    assert.equal(isTelegramVoiceCompatibleMime('Audio/MPEG; charset=binary'), true)
  })

  test('rejects wav/pcm (Volcengine and DashScope output)', () => {
    assert.equal(isTelegramVoiceCompatibleMime('audio/wav'), false)
    assert.equal(isTelegramVoiceCompatibleMime('audio/pcm'), false)
    assert.equal(isTelegramVoiceCompatibleMime(''), false)
  })
})

describe('createBridgeForwardQueue', () => {
  type Scheduled = { fn: () => void; ms: number }

  function makeHarness(initialBusy = false) {
    const sent: string[] = []
    const dropped: Array<{ text: string; reason: string }> = []
    const scheduled: Scheduled[] = []
    const state = { busy: initialBusy, accept: true }
    const queue = createBridgeForwardQueue({
      send: async (text) => {
        if (!state.accept) return false
        sent.push(text)
        return true
      },
      isBusy: () => state.busy,
      onDrop: (text, reason) => dropped.push({ text, reason }),
      retryMs: 100,
      maxQueue: 3,
      schedule: (fn, ms) => { scheduled.push({ fn, ms }) },
    })
    const runScheduled = async () => {
      const batch = scheduled.splice(0)
      for (const item of batch) item.fn()
      // drain() is async; give its microtasks a chance to settle.
      await new Promise((r) => setTimeout(r, 0))
    }
    return { queue, sent, dropped, scheduled, state, runScheduled }
  }

  test('sends immediately when idle', async () => {
    const h = makeHarness()
    h.queue.push('hello')
    await new Promise((r) => setTimeout(r, 0))
    assert.deepEqual(h.sent, ['hello'])
    assert.equal(h.dropped.length, 0)
  })

  test('holds messages while busy and retries them after', async () => {
    const h = makeHarness(true)
    h.queue.push('while-busy')
    await new Promise((r) => setTimeout(r, 0))
    assert.deepEqual(h.sent, [])
    assert.equal(h.scheduled.length, 1)
    assert.equal(h.scheduled[0].ms, 100)

    h.state.busy = false
    await h.runScheduled()
    assert.deepEqual(h.sent, ['while-busy'])
    assert.equal(h.queue.size(), 0)
  })

  test('preserves order across a busy window', async () => {
    const h = makeHarness(true)
    h.queue.push('first')
    h.queue.push('second')
    await new Promise((r) => setTimeout(r, 0))
    h.state.busy = false
    await h.runScheduled()
    assert.deepEqual(h.sent, ['first', 'second'])
  })

  test('a rejection while idle drops the message loudly instead of looping', async () => {
    const h = makeHarness()
    h.state.accept = false
    h.queue.push('refused')
    await new Promise((r) => setTimeout(r, 0))
    assert.deepEqual(h.sent, [])
    assert.deepEqual(h.dropped, [{ text: 'refused', reason: 'rejected' }])
    assert.equal(h.scheduled.length, 0)
  })

  test('overflow evicts the oldest message', async () => {
    const h = makeHarness(true)
    h.queue.push('a')
    h.queue.push('b')
    h.queue.push('c')
    h.queue.push('d')
    await new Promise((r) => setTimeout(r, 0))
    assert.deepEqual(h.dropped, [{ text: 'a', reason: 'overflow' }])
    assert.equal(h.queue.size(), 3)
  })

  test('dispose stops all work', async () => {
    const h = makeHarness(true)
    h.queue.push('doomed')
    h.queue.dispose()
    h.state.busy = false
    await h.runScheduled()
    assert.deepEqual(h.sent, [])
    assert.equal(h.queue.size(), 0)
  })
})

describe('existing helpers stay intact', () => {
  test('parseCsvIdSet still parses', () => {
    assert.deepEqual([...parseCsvIdSet('1, 2,,3')], ['1', '2', '3'])
  })

  test('resolveBridgeReplyTarget still resolves', () => {
    const map = new Map([[1, { chatId: 1 }]])
    assert.deepEqual(resolveBridgeReplyTarget(map, null, 1), { chatId: 1 })
    assert.equal(resolveBridgeReplyTarget(map, null, 2), null)
  })
})
