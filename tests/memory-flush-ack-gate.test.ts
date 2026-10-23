import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createMemoryFlushAckGate } from '../electron/services/memoryFlushAckGate.js'

test('a renderer ack releases the quit wait before the timeout', async () => {
  const gate = createMemoryFlushAckGate()
  gate.expect(1)
  const wait = gate.waitForAck(1_000)

  gate.acknowledge()

  assert.equal(await wait, true)
})

test('a missing ack resolves after the timeout instead of blocking quit', async () => {
  const gate = createMemoryFlushAckGate()
  gate.expect(1)

  const startedAt = Date.now()
  const acked = await gate.waitForAck(20)

  assert.equal(acked, false)
  assert.ok(Date.now() - startedAt >= 10)
})
