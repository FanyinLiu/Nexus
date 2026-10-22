import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createRemoteMoodApply } from '../src/features/pet/moodPublish.ts'

test('a remote mood updates the face once and the next local change publishes again', () => {
  const gate = createRemoteMoodApply()

  assert.equal(gate.consumePublish(), true)

  assert.deepEqual(gate.apply('idle', 'idle'), { changed: false })
  assert.equal(gate.consumePublish(), true)

  assert.deepEqual(gate.apply('idle', 'worried'), { changed: true })
  assert.equal(gate.consumePublish(), false)
  assert.equal(gate.consumePublish(), true)

  assert.deepEqual(gate.apply('worried', 'happy'), { changed: true })
  assert.equal(gate.consumePublish(), false)
  assert.equal(gate.consumePublish(), true)
})
