import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SPECULATIVE_DECODE_MIN_PROBABILITY,
  createSpeculativeDecoder,
  shouldStartSpeculativeDecode,
} from '../src/features/hearing/speculativeDecode.ts'

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

test('only a confident pause starts a speculative decode', () => {
  assert.equal(
    shouldStartSpeculativeDecode({
      probability: SPECULATIVE_DECODE_MIN_PROBABILITY,
      silenceMs: 250,
    }),
    true,
  )
  assert.equal(
    shouldStartSpeculativeDecode({
      probability: SPECULATIVE_DECODE_MIN_PROBABILITY - 0.01,
      silenceMs: 250,
    }),
    false,
  )
  assert.equal(shouldStartSpeculativeDecode({ probability: null, silenceMs: 250 }), false)
  assert.equal(shouldStartSpeculativeDecode({ probability: 0.9, silenceMs: 0 }), false)
})

test('a decode is started once per speech epoch', async () => {
  const decoder = createSpeculativeDecoder<string>()
  let calls = 0
  const start = () => decoder.maybeStart(1, async () => {
    calls += 1
    return 'hello'
  })

  assert.equal(start(), true)
  assert.equal(start(), false, 'the in-flight decode is shared')
  await settle()

  assert.equal(calls, 1)
  assert.equal(decoder.take(1), 'hello')
  assert.equal(start(), false, 'a cached result is not decoded again')
})

test('a resumed utterance discards the speculative result', async () => {
  const decoder = createSpeculativeDecoder<string>()
  let release: (() => void) | null = null
  decoder.maybeStart(1, () => new Promise<string>((resolve) => {
    release = () => resolve('stale')
  }))

  // The user starts talking again before the decode resolves.
  decoder.invalidate(2)
  release!()
  await settle()

  assert.equal(decoder.take(1), null)
  assert.equal(await decoder.settle(1), null)
  assert.equal(await decoder.settle(2), null)

  assert.equal(decoder.maybeStart(2, async () => 'fresh'), true)
  await settle()
  assert.equal(await decoder.settle(2), 'fresh')
})

test('a decode that returns nothing falls back without retrying the same epoch', async () => {
  const decoder = createSpeculativeDecoder<string>()
  assert.equal(decoder.maybeStart(1, async () => null), true)
  await settle()

  assert.equal(decoder.take(1), null)
  assert.equal(await decoder.settle(1), null)
  assert.equal(
    decoder.maybeStart(1, async () => 'second try'),
    false,
    'the same unchanged audio is not decoded twice',
  )

  // Resumed speech opens a new epoch, so the next pause may try again.
  decoder.invalidate(2)
  assert.equal(decoder.maybeStart(2, async () => 'second try'), true)
  await settle()
  assert.equal(decoder.take(2), 'second try')
})

test('settle waits for an in-flight decode before deciding', async () => {
  const decoder = createSpeculativeDecoder<string>()
  let resolve: ((value: string) => void) | null = null
  decoder.maybeStart(4, () => new Promise<string>((done) => {
    resolve = done
  }))

  const pending = decoder.settle(4)
  resolve!('confirmed')
  assert.equal(await pending, 'confirmed')
})

test('a late result from an invalidated epoch never overwrites the new one', async () => {
  const decoder = createSpeculativeDecoder<string>()
  let releaseFirst: (() => void) | null = null
  decoder.maybeStart(1, () => new Promise<string>((resolve) => {
    releaseFirst = () => resolve('first')
  }))

  decoder.invalidate(2)
  assert.equal(decoder.maybeStart(2, async () => 'second'), true)
  await settle()
  releaseFirst!()
  await settle()

  assert.equal(decoder.take(1), null)
  assert.equal(decoder.take(2), 'second')
})
