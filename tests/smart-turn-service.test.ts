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

test('session ids isolate buffers and reject stale stop/probe calls', async () => {
  const service = new SmartTurnService()
  service.ensureEngine = async () => null

  const first = service.startSession()
  service.feed(new Float32Array(16_000).fill(0.1))
  const second = service.startSession()
  service.feed(new Float32Array(8_000).fill(0.2))

  const staleStop = service.stopSession(first.sessionId)
  assert.deepEqual(staleStop, { ok: false, stale: true })
  assert.equal(service.active, true, 'a stale stop must not close the new turn')
  assert.equal(service.filled, 8_000, 'a stale stop must not clear the new buffer')

  const staleProbe = await service.probe(first.sessionId)
  assert.equal(staleProbe.available, false)
  assert.equal(staleProbe.reason, 'inactive')
  assert.equal(staleProbe.stale, true)

  assert.deepEqual(service.stopSession(second.sessionId), { ok: true })
  assert.equal(service.active, false)
})

test('an in-flight probe from an older generation resolves stale', async () => {
  const service = new SmartTurnService()
  service.ensureEngine = async () => null
  let resolvePredict: ((result: PredictResult) => void) | null = null
  service.engine = {
    predict: () => new Promise<PredictResult>((resolve) => { resolvePredict = resolve }),
  } as never

  const first = service.startSession()
  service.filled = 16_000
  const pending = service.probe(first.sessionId)
  service.startSession()
  resolvePredict!({ probability: 0.95, featureMs: 1, inferenceMs: 5 })

  const result = await pending
  assert.equal(result.available, false)
  assert.equal(result.reason, 'inactive')
  assert.equal(result.stale, true)
})

test('a stop invalidates a probe still awaiting inference', async () => {
  const service = new SmartTurnService()
  service.ensureEngine = async () => null
  let resolvePredict: ((result: PredictResult) => void) | null = null
  service.engine = {
    predict: () => new Promise<PredictResult>((resolve) => { resolvePredict = resolve }),
  } as never

  const session = service.startSession()
  service.filled = 16_000
  const pending = service.probe(session.sessionId)
  service.stopSession(session.sessionId)
  resolvePredict!({ probability: 0.95, featureMs: 1, inferenceMs: 5 })

  assert.equal((await pending).stale, true)
})

test('model download retries after 1 minute, then 10 minutes, then gives up', async () => {
  let now = 0
  let attempts = 0
  const timers: Array<{ run: () => void; delayMs: number }> = []
  const service = new SmartTurnService({
    now: () => now,
    downloadModel: async () => {
      attempts += 1
      throw new Error('offline')
    },
    setTimeout: (callback, delayMs) => {
      timers.push({ run: callback, delayMs })
      return { unref: () => undefined }
    },
    clearTimeout: () => undefined,
  })
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

  service.maybeDownloadModel()
  await flush()
  assert.equal(attempts, 1)
  assert.deepEqual(timers.map((timer) => timer.delayMs), [60_000])

  now += 60_000
  timers.shift()!.run()
  await flush()
  assert.equal(attempts, 2)
  assert.deepEqual(timers.map((timer) => timer.delayMs), [600_000])

  now += 600_000
  timers.shift()!.run()
  await flush()
  assert.equal(attempts, 3)
  assert.equal(timers.length, 0, 'the third failure gives up until next launch')

  service.maybeDownloadModel()
  await flush()
  assert.equal(attempts, 3)
  assert.equal(service.downloadRetryAt, 0)
})
