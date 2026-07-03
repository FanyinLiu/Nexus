import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MEMORY_VECTOR_LOG_FLUSH_BATCH_SIZE,
  MEMORY_VECTOR_LOG_FLUSH_INTERVAL_MS,
  MemoryVectorLogAppendBuffer,
} from '../electron/services/memoryVectorLogBuffer.js'

test('memory vector log buffer batches mutation lines before append', async () => {
  const writes: string[] = []
  const scheduled: Array<() => void> = []
  const buffer = new MemoryVectorLogAppendBuffer({
    append: async (chunk) => writes.push(chunk),
    schedule: (callback) => {
      scheduled.push(callback)
      return scheduled.length
    },
    cancel: () => {},
    batchSize: 3,
  })

  const first = buffer.enqueue('a\n')
  const second = buffer.enqueue('b\n')

  assert.equal(writes.length, 0)
  assert.equal(scheduled.length, 1)

  const third = buffer.enqueue('c\n')
  await Promise.all([first, second, third])

  assert.deepEqual(writes, ['a\nb\nc\n'])
})

test('memory vector log buffer drain flushes partial tails', async () => {
  const writes: string[] = []
  let cancelledTimer: unknown = null
  const buffer = new MemoryVectorLogAppendBuffer({
    append: async (chunk) => writes.push(chunk),
    schedule: () => 9,
    cancel: (timer) => { cancelledTimer = timer },
    batchSize: 32,
  })

  const pending = buffer.enqueue('tail\n')
  await buffer.drain()
  await pending

  assert.deepEqual(writes, ['tail\n'])
  assert.equal(cancelledTimer, 9)
})

test('memory vector log buffer drains lines queued during an in-flight append', async () => {
  const writes: string[] = []
  let releaseFirstWrite!: () => void
  const firstWrite = new Promise<void>((resolve) => { releaseFirstWrite = resolve })
  const buffer = new MemoryVectorLogAppendBuffer({
    append: async (chunk) => {
      writes.push(chunk)
      if (writes.length === 1) {
        await firstWrite
      }
    },
    schedule: () => 1,
    cancel: () => {},
    batchSize: 2,
  })

  const first = buffer.enqueue('a\n')
  const second = buffer.enqueue('b\n')
  const third = buffer.enqueue('tail\n')

  const drainPromise = buffer.drain()
  assert.deepEqual(writes, ['a\nb\n'])

  releaseFirstWrite()
  await drainPromise
  await Promise.all([first, second, third])

  assert.deepEqual(writes, ['a\nb\n', 'tail\n'])
})

test('memory vector log buffer rejects queued lines when append fails', async () => {
  const error = new Error('disk full')
  const buffer = new MemoryVectorLogAppendBuffer({
    append: async () => { throw error },
    schedule: () => 1,
    cancel: () => {},
    batchSize: 2,
  })

  const first = buffer.enqueue('a\n')
  const second = buffer.enqueue('b\n')

  await assert.rejects(first, error)
  await assert.rejects(second, error)
})

test('memory vector log buffer exposes conservative batching defaults', () => {
  assert.equal(MEMORY_VECTOR_LOG_FLUSH_INTERVAL_MS, 75)
  assert.equal(MEMORY_VECTOR_LOG_FLUSH_BATCH_SIZE, 32)
})
