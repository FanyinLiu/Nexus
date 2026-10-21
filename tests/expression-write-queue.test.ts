import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createExpressionWriteQueue } from '../src/features/pet/components/live2d/expressions.ts'

test('an earlier expression write cannot land after a later one', async () => {
  const applied: string[] = []
  let releaseIdle: () => void = () => undefined
  const idleGate = new Promise<void>((resolve) => {
    releaseIdle = resolve
  })
  const queue = createExpressionWriteQueue(async (name) => {
    applied.push(`start:${name}`)
    if (name === 'idle') await idleGate
    applied.push(`end:${name}`)
  })

  const first = queue.request('idle')
  await Promise.resolve()
  assert.deepEqual(applied, ['start:idle'])
  const second = queue.request('confused')
  releaseIdle()
  await first
  await second
  assert.deepEqual(applied, ['start:idle', 'end:idle', 'start:confused', 'end:confused'])
})

test('requesting the expression that is already applied does not write again', async () => {
  const applied: string[] = []
  const queue = createExpressionWriteQueue(async (name) => {
    applied.push(name)
  })
  await queue.request('idle')
  await queue.request('idle')
  assert.deepEqual(applied, ['idle'])
})
