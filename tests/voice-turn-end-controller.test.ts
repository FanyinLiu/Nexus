import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createTurnEndController,
  type SmartTurnProbeResult,
  type TurnEndContext,
  type TurnEndTick,
} from '../src/hooks/voice/turnEndController.ts'
import {
  TURN_END_MODEL_CEILING_SILENCE_MS,
  TURN_END_MODEL_COMPLETE_SILENCE_MS,
} from '../src/features/hearing/turnEnd.ts'

function harness(options: {
  probe: () => Promise<SmartTurnProbeResult>
  partialTranscript?: string
  presetSilenceMs?: number
}) {
  let nowMs = 0
  const context: TurnEndContext = {
    partialTranscript: options.partialTranscript ?? '',
    locale: 'zh-CN',
    presetSilenceMs: options.presetSilenceMs ?? 900,
    speechStartedAt: 0,
    lastSpeechAt: 0,
    finalizing: false,
  }
  const ends: TurnEndTick[] = []
  const waits: TurnEndTick[] = []
  const controller = createTurnEndController({
    probe: options.probe,
    getContext: () => context,
    onEnd: (tick) => ends.push(tick),
    onWait: (tick) => waits.push(tick),
    now: () => nowMs,
  })
  return {
    controller,
    context,
    ends,
    waits,
    setNow(value: number) { nowMs = value },
  }
}

/** Let the probe's `.then` and the controller's follow-up tick run. */
async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('a missing model falls back to the provider preset', async () => {
  const h = harness({
    probe: async () => ({ available: false, probability: null, reason: 'missing' }),
  })

  h.setNow(250)
  h.controller.tick()
  await settle()
  assert.equal(h.ends.length, 0)

  h.setNow(649)
  h.controller.tick()
  assert.equal(h.ends.length, 0)

  h.setNow(900)
  h.controller.tick()
  assert.equal(h.ends.length, 1)
  assert.equal(h.ends[0].modelProbability, null)
  assert.equal(h.ends[0].decision.reason, 'empty')
})

test('a timed-out probe falls back to the text rules', async () => {
  const h = harness({
    partialTranscript: '好的',
    probe: async () => ({ available: false, probability: null, timedOut: true, reason: 'error' }),
  })

  h.setNow(250)
  h.controller.tick()
  await settle()

  h.setNow(600)
  h.controller.tick()
  assert.equal(h.ends.length, 1)
  assert.equal(h.ends[0].decision.reason, 'complete')
  assert.equal(h.ends[0].decision.thresholdMs, 600)
})

test('a confident complete ends at 300 ms of silence', async () => {
  const h = harness({
    probe: async () => ({ available: true, probability: 0.93, latencyMs: 120 }),
  })

  h.setNow(250)
  h.controller.tick()
  await settle()
  assert.equal(h.ends.length, 0)
  assert.equal(h.waits.at(-1)?.modelProbability, 0.93)

  h.setNow(TURN_END_MODEL_COMPLETE_SILENCE_MS)
  h.controller.tick()
  assert.equal(h.ends.length, 1)
  assert.equal(h.ends[0].decision.reason, 'model_complete')
})

test('a not-finished verdict waits for the 1.8 s ceiling', async () => {
  const h = harness({
    partialTranscript: 'I think that',
    probe: async () => ({ available: true, probability: 0.08, latencyMs: 130 }),
  })

  h.setNow(250)
  h.controller.tick()
  await settle()

  h.setNow(1_000)
  h.controller.tick()
  assert.equal(h.ends.length, 0)
  assert.equal(h.waits.at(-1)?.decision.reason, 'model_incomplete')

  h.setNow(TURN_END_MODEL_CEILING_SILENCE_MS)
  h.controller.tick()
  assert.equal(h.ends.length, 1)
  assert.equal(h.ends[0].decision.reason, 'model_incomplete')
})

test('a loading model is retried after the 300 ms recheck interval', async () => {
  let calls = 0
  const h = harness({
    probe: async () => {
      calls += 1
      return calls === 1
        ? { available: false, probability: null, reason: 'loading' }
        : { available: true, probability: 0.8 }
    },
  })

  h.setNow(250)
  h.controller.tick()
  await settle()
  assert.equal(calls, 1)

  h.setNow(550)
  h.controller.tick()
  await settle()
  assert.equal(calls, 2)
  assert.equal(h.ends.at(-1)?.modelProbability, 0.8)
})

test('concurrent ticks share one in-flight probe', async () => {
  let calls = 0
  let resolveProbe: ((result: SmartTurnProbeResult) => void) | null = null
  const h = harness({
    probe: () => {
      calls += 1
      return new Promise((resolve) => { resolveProbe = resolve })
    },
  })

  h.setNow(250)
  h.controller.tick()
  h.setNow(260)
  h.controller.tick()
  h.setNow(270)
  h.controller.tick()
  assert.equal(calls, 1)

  resolveProbe!({ available: true, probability: 0.6 })
  await settle()
  assert.equal(calls, 1)
})

test('resumed speech invalidates the cached probability', async () => {
  const probabilities = [0.1, 0.95]
  let calls = 0
  const h = harness({
    probe: async () => {
      const probability = probabilities[Math.min(calls, probabilities.length - 1)]
      calls += 1
      return { available: true, probability }
    },
  })

  h.setNow(250)
  h.controller.tick()
  await settle()
  assert.equal(calls, 1)

  // The user starts talking again; the next pause is a new audio context.
  h.context.lastSpeechAt = 500
  h.context.speechStartedAt = 500
  h.setNow(750)
  h.controller.tick()
  await settle()
  assert.equal(calls, 2)
  assert.equal(h.waits.at(-1)?.modelProbability, 0.95)

  h.setNow(1_050)
  h.controller.tick()
  assert.equal(h.ends.at(-1)?.decision.reason, 'model_complete')
})
