// Behaviour tests for the AI-disclosure persistence + reminder
// trigger logic. Mocks window.localStorage since storage/core
// reaches for `window.localStorage` directly.

import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'

// ── Browser shim: storage/core reads `window.localStorage`.
class MemoryStorage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  key(i: number) { return Array.from(this.data.keys())[i] ?? null }
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null }
  setItem(k: string, v: string) { this.data.set(k, String(v)) }
  removeItem(k: string) { this.data.delete(k) }
  clear() { this.data.clear() }
}
const ms = new MemoryStorage()
;(globalThis as unknown as { window: unknown }).window = {
  localStorage: ms,
  addEventListener: () => {},
  removeEventListener: () => {},
  clearTimeout: () => {},
  setTimeout: () => 0,
}
;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = ms

// Storage/core opens a BroadcastChannel when one is available — Node
// 18+ ships a global one, which keeps the event loop alive past test
// completion. Stub it out before importing so the test process can
// exit cleanly when assertions finish.
;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined

// Dynamic import after the shim is installed.
const disclosure = await import('../src/features/safety/disclosureState.ts')

const HOUR_MS = 60 * 60 * 1000

function reset() {
  ms.clear()
  disclosure.__test_clear()
}

describe('AI disclosure state', () => {
  beforeEach(reset)

  test('hasAcknowledgedDisclosure is false until recordDisclosureAck runs', () => {
    assert.equal(disclosure.hasAcknowledgedDisclosure(), false)
    disclosure.recordDisclosureAck(new Date('2026-04-28T10:00:00Z'))
    assert.equal(disclosure.hasAcknowledgedDisclosure(), true)
  })

  test('recordDisclosureAck is idempotent — re-acking keeps the earliest timestamp', () => {
    disclosure.recordDisclosureAck(new Date('2026-04-28T10:00:00Z'))
    const first = disclosure.__test_getState().acknowledgedAt
    disclosure.recordDisclosureAck(new Date('2026-04-28T15:00:00Z'))
    assert.equal(disclosure.__test_getState().acknowledgedAt, first)
  })

  test('noteUserMessageAndCheckReminder returns false until disclosure is acknowledged', () => {
    for (let i = 0; i < 50; i++) {
      assert.equal(
        disclosure.noteUserMessageAndCheckReminder(new Date(Date.now() + i * HOUR_MS)),
        false,
      )
    }
  })

  test('reminder fires only when both 30 messages AND 3 hours elapsed', () => {
    const ackAt = new Date('2026-04-28T10:00:00Z')
    disclosure.recordDisclosureAck(ackAt)

    // Send 29 messages within 30 minutes — should not fire.
    for (let i = 0; i < 29; i++) {
      const t = new Date(ackAt.getTime() + i * 60 * 1000)
      assert.equal(disclosure.noteUserMessageAndCheckReminder(t), false)
    }
    // 30th message, still under 3 hours — should not fire.
    assert.equal(
      disclosure.noteUserMessageAndCheckReminder(new Date(ackAt.getTime() + 30 * 60 * 1000)),
      false,
    )

    // Now jump to 3.5 hours after ack and send another message — meets both.
    assert.equal(
      disclosure.noteUserMessageAndCheckReminder(new Date(ackAt.getTime() + 3.5 * HOUR_MS)),
      true,
    )
  })

  test('reminder does NOT fire on 100 messages in the first 30 minutes (time gate holds)', () => {
    const ackAt = new Date('2026-04-28T10:00:00Z')
    disclosure.recordDisclosureAck(ackAt)
    for (let i = 0; i < 100; i++) {
      const t = new Date(ackAt.getTime() + i * 18 * 1000) // ~30 minutes total
      assert.equal(disclosure.noteUserMessageAndCheckReminder(t), false)
    }
  })

  test('reminder does NOT fire after 24h with only 5 messages (count gate holds)', () => {
    const ackAt = new Date('2026-04-28T10:00:00Z')
    disclosure.recordDisclosureAck(ackAt)
    for (let i = 0; i < 5; i++) {
      const t = new Date(ackAt.getTime() + (i + 1) * 5 * HOUR_MS) // every 5 hours
      assert.equal(disclosure.noteUserMessageAndCheckReminder(t), false)
    }
  })

  test('after firing, counter resets and next reminder needs 30 more messages + 3 more hours', () => {
    const ackAt = new Date('2026-04-28T10:00:00Z')
    disclosure.recordDisclosureAck(ackAt)
    // Drive the first reminder.
    for (let i = 0; i < 29; i++) {
      disclosure.noteUserMessageAndCheckReminder(new Date(ackAt.getTime() + 60_000 * i))
    }
    const fired = disclosure.noteUserMessageAndCheckReminder(new Date(ackAt.getTime() + 4 * HOUR_MS))
    assert.equal(fired, true, 'expected the boundary message to fire reminder')

    // After fire, state.userMessagesSinceReminder is 0 and lastReminderAt = +4h.
    // Same conditions must hold from this new anchor.
    for (let i = 0; i < 29; i++) {
      const t = new Date(ackAt.getTime() + 4 * HOUR_MS + i * 60_000)
      assert.equal(disclosure.noteUserMessageAndCheckReminder(t), false)
    }
    const second = disclosure.noteUserMessageAndCheckReminder(
      new Date(ackAt.getTime() + 4 * HOUR_MS + 4 * HOUR_MS),
    )
    assert.equal(second, true)
  })

  test('resetDisclosureState clears acknowledgedAt + counter', () => {
    disclosure.recordDisclosureAck(new Date('2026-04-28T10:00:00Z'))
    disclosure.__test_setState({ userMessagesSinceReminder: 17 })
    disclosure.resetDisclosureState()
    assert.equal(disclosure.hasAcknowledgedDisclosure(), false)
    assert.equal(disclosure.__test_getState().userMessagesSinceReminder, 0)
  })
})
