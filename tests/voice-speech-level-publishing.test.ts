import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createSpeechLevelPublisher,
  SPEECH_LEVEL_REACT_INTERVAL_MS,
} from '../src/hooks/voice/speechLevelPublishing.ts'

test('speech level keeps frame-rate raw samples while bounding snapshots to 20Hz', () => {
  const publisher = createSpeechLevelPublisher()
  const published: number[] = []
  const unsubscribe = publisher.source.subscribe(() => {
    published.push(publisher.source.getSnapshot())
  })
  let now = 1_000

  for (let frame = 0; frame < 600; frame += 1) {
    const level = 0.5 + Math.sin(frame / 7) * 0.45
    publisher.publish(level, now)
    assert.ok(Math.abs(publisher.source.current - level) < 1e-9)
    now += 1000 / 60
  }

  assert.ok(published.length <= 201)
  assert.ok(published.length >= 100, 'visual level should remain responsive')
  unsubscribe()
  publisher.dispose()
})

test('first non-zero and a settled zero are visible without making repeated zero noisy', () => {
  const publisher = createSpeechLevelPublisher()
  const published: number[] = []
  publisher.source.subscribe(() => published.push(publisher.source.getSnapshot()))

  publisher.publish(0.8, 1_000)
  publisher.publish(0, 1_001)
  publisher.publish(0, 1_002)
  publisher.publish(0, 1_050)
  publisher.reset(1_051)

  assert.deepEqual(published, [0.8, 0])
  assert.equal(publisher.source.current, 0)

  publisher.publish(0.8, 1_100)
  publisher.reset(1_200)
  publisher.reset(1_201)
  assert.deepEqual(published, [0.8, 0, 0.8, 0])
  publisher.dispose()
})

test('ordinary alternating samples stay within the strict 20Hz budget while raw remains exact', () => {
  const publisher = createSpeechLevelPublisher()
  const published: number[] = []
  publisher.source.subscribe(() => published.push(publisher.source.getSnapshot()))
  let now = 2_000

  for (let frame = 0; frame < 600; frame += 1) {
    const level = frame % 2 === 0 ? 0.8 : 0
    publisher.publish(level, now)
    assert.equal(publisher.source.current, level)
    now += 1000 / 60
  }

  assert.ok(published.length <= 201)
  assert.ok(SPEECH_LEVEL_REACT_INTERVAL_MS >= 50)
  publisher.dispose()
})

test('snapshot is updated before listeners run and instances remain isolated', () => {
  const first = createSpeechLevelPublisher()
  const second = createSpeechLevelPublisher()
  const observed: number[] = []
  const unsubscribe = first.source.subscribe(() => observed.push(first.source.getSnapshot()))

  first.publish(0.37, 3_000)
  second.publish(0.82, 3_000)

  assert.deepEqual(observed, [0.35])
  assert.equal(first.source.getSnapshot(), 0.35)
  assert.equal(second.source.getSnapshot(), 0.8)
  unsubscribe()
  unsubscribe()
  first.dispose()
  second.dispose()
})

test('dispose silences late frames, clears listeners, and keeps unsubscribe idempotent', () => {
  const publisher = createSpeechLevelPublisher()
  let notifications = 0
  const unsubscribe = publisher.source.subscribe(() => {
    notifications += 1
  })

  publisher.publish(0.6, 4_000)
  publisher.dispose()
  unsubscribe()
  unsubscribe()
  publisher.publish(0.9, 4_100)
  publisher.reset(4_200)

  assert.equal(notifications, 1)
  assert.equal(publisher.source.current, 0)
  assert.equal(publisher.source.getSnapshot(), 0)
})

test('one broken subscriber cannot poison the sampler or block healthy leaves', () => {
  const publisher = createSpeechLevelPublisher()
  let healthyNotifications = 0
  const originalConsoleError = console.error
  console.error = () => undefined

  try {
    publisher.source.subscribe(() => {
      throw new Error('broken visual leaf')
    })
    publisher.source.subscribe(() => {
      healthyNotifications += 1
    })

    assert.doesNotThrow(() => publisher.publish(0.5, 5_000))
    assert.equal(healthyNotifications, 1)
    assert.equal(publisher.source.getSnapshot(), 0.5)
  } finally {
    console.error = originalConsoleError
    publisher.dispose()
  }
})

test('non-finite samples are normalized to silence before raw or snapshots escape', () => {
  const publisher = createSpeechLevelPublisher()
  publisher.publish(Number.NaN, 6_000)
  assert.equal(publisher.source.current, 0)
  assert.equal(publisher.source.getSnapshot(), 0)

  publisher.publish(Number.POSITIVE_INFINITY, 6_100)
  assert.equal(publisher.source.current, 0)
  assert.equal(publisher.source.getSnapshot(), 0)
  publisher.dispose()
})
