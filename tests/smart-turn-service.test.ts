import assert from 'node:assert/strict'
import test from 'node:test'

import { SmartTurnService } from '../electron/smartTurn.js'

type PredictResult = { probability: number, featureMs: number, inferenceMs: number }

function prepare(service: SmartTurnService, results: Array<PredictResult | Error>) {
  let calls = 0
  service.active = true
  service.filled = 16_000
  service.engine = {
    async predict() {
      const result = results[Math.min(calls, results.length - 1)]
      calls += 1
      if (result instanceof Error) throw result
      return { ...result, totalMs: result.featureMs + result.inferenceMs }
    },
  } as never
}

const slow: PredictResult = { probability: 0.4, featureMs: 5, inferenceMs: 200 }
const fast: PredictResult = { probability: 0.8, featureMs: 5, inferenceMs: 40 }

test('a slow probe is labelled timeout and a fast probe resets the streak', async () => {
  const service = new SmartTurnService()
  prepare(service, [slow, slow, fast, slow])

  const first = await service.probe()
  assert.equal(first.timedOut, true)
  assert.equal(first.reason, 'timeout')
  assert.equal(first.consecutiveTimeouts, 1)

  const second = await service.probe()
  assert.equal(second.consecutiveTimeouts, 2)

  const healthy = await service.probe()
  assert.equal(healthy.available, true)
  assert.equal(healthy.probability, 0.8)
  assert.equal(service.consecutiveTimeouts, 0)

  const afterReset = await service.probe()
  assert.equal(afterReset.consecutiveTimeouts, 1)
})

test('a thrown inference is a real error, not a latency timeout', async () => {
  const service = new SmartTurnService()
  prepare(service, [slow, new Error('runner exploded'), fast])

  await service.probe()
  const failed = await service.probe()
  assert.equal(failed.reason, 'error')
  assert.equal(failed.timedOut, undefined)
  assert.equal(service.consecutiveTimeouts, 0)
})
