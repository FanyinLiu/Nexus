import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createPairingManager } from '../electron/services/pairingManager.js'

function makeManager(overrides: Record<string, unknown> = {}) {
  let nowMs = 1_000_000
  let codeSeq = 0
  const manager = createPairingManager({
    now: () => nowMs,
    generateCode: () => `00000${++codeSeq}`.slice(-6),
    ...overrides,
  })
  return { manager, advance: (ms: number) => { nowMs += ms } }
}

describe('createPairingManager', () => {
  test('first contact mints a code; repeats are silent', () => {
    const { manager } = makeManager()
    const first = manager.requestPairing('42', 'Klein')
    assert.deepEqual(first, { kind: 'created', code: '000001' })
    // The same stranger messaging again must not mint codes or re-reply.
    assert.deepEqual(manager.requestPairing('42', 'Klein'), { kind: 'existing' })
    assert.equal(manager.list().length, 1)
  })

  test('caps pending requests per gateway', () => {
    const { manager } = makeManager()
    manager.requestPairing('1')
    manager.requestPairing('2')
    manager.requestPairing('3')
    assert.deepEqual(manager.requestPairing('4'), { kind: 'capped' })
    assert.equal(manager.list().length, 3)
  })

  test('codes expire after the TTL and free a slot', () => {
    const { manager, advance } = makeManager()
    manager.requestPairing('1')
    manager.requestPairing('2')
    manager.requestPairing('3')
    advance(61 * 60 * 1000)
    assert.equal(manager.list().length, 0)
    assert.equal(manager.requestPairing('4').kind, 'created')
  })

  test('resolve removes a request; sender can pair again later', () => {
    const { manager } = makeManager()
    manager.requestPairing('42', 'Klein')
    assert.equal(manager.resolve('42'), true)
    assert.equal(manager.list().length, 0)
    assert.equal(manager.requestPairing('42').kind, 'created')
  })

  test('sender names are stored truncated, list exposes full entries', () => {
    const { manager } = makeManager()
    manager.requestPairing('42', 'x'.repeat(200))
    const [entry] = manager.list()
    assert.equal(entry.senderId, '42')
    assert.equal(entry.name.length, 64)
    assert.match(entry.code, /^\d{6}$/)
  })
})
