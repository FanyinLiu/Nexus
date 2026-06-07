import assert from 'node:assert/strict'
import test from 'node:test'

import { createAsyncLock } from '../electron/services/asyncLock.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

test('createAsyncLock serializes callers that are released from the same wait', async () => {
  const withLock = createAsyncLock()
  const releases = [deferred(), deferred(), deferred()]
  const started: number[] = []
  const finished: number[] = []
  let active = 0
  let maxActive = 0

  const run = (id: number) => withLock(async () => {
    active += 1
    maxActive = Math.max(maxActive, active)
    started.push(id)

    await releases[id - 1].promise

    finished.push(id)
    active -= 1
    return id
  })

  const results = Promise.all([run(1), run(2), run(3)])

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(started, [1])

  releases[0].resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(started, [1, 2])

  releases[1].resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(started, [1, 2, 3])

  releases[2].resolve()

  assert.deepEqual(await results, [1, 2, 3])
  assert.deepEqual(finished, [1, 2, 3])
  assert.equal(maxActive, 1)
})

test('createAsyncLock releases the next caller after a rejected task', async () => {
  const withLock = createAsyncLock()
  const started: string[] = []

  const first = withLock(async () => {
    started.push('first')
    throw new Error('boom')
  })
  const second = withLock(async () => {
    started.push('second')
    return 'ok'
  })

  await assert.rejects(first, /boom/)
  assert.equal(await second, 'ok')
  assert.deepEqual(started, ['first', 'second'])
})
