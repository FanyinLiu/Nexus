import assert from 'node:assert/strict'
import { test } from 'node:test'

import { redactSensitiveText } from '../shared/redaction.js'

// The key=value and userinfo rules used to retry their unanchored prefix at
// every offset, so an unmatched 64KB run took seconds. These are absolute
// wall-clock guards, not micro-benchmarks: the ceiling is deliberately loose so
// slow CI stays green while a quadratic regression still fails fast after the
// first over-budget run.

const RUN_COUNT = 20
const WARMUP_RUNS = 3
const ABSOLUTE_CEILING_MS = 750
const RATIO_CHECK_THRESHOLD_MS = 20
const MAX_SIZE_RATIO = 3
const LETTERS_64K = 'A'.repeat(64 * 1024)
const LETTERS_128K = 'A'.repeat(128 * 1024)
const MIXED_ALNUM_64K = 'a1B2_-'.repeat(Math.ceil((64 * 1024) / 6)).slice(0, 64 * 1024)
const LOG_LIKE_64K = (
  'level=info msg="request completed" path=/api/v1/items status=200 duration=42ms host=node-7 '
).repeat(800).slice(0, 64 * 1024)

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function measureMedian(input: string, label: string): number {
  for (let i = 0; i < WARMUP_RUNS; i += 1) {
    const startedAt = performance.now()
    redactSensitiveText(input)
    const elapsed = performance.now() - startedAt
    // Guard the warmup too: a quadratic regression must not spend 3 long runs
    // before the first measured sample gets a chance to fail.
    assert.ok(
      elapsed < ABSOLUTE_CEILING_MS,
      `${label} warmup ${i + 1} took ${elapsed.toFixed(1)}ms, over the ${ABSOLUTE_CEILING_MS}ms ceiling (quadratic redaction?)`,
    )
  }

  const samples: number[] = []
  for (let i = 0; i < RUN_COUNT; i += 1) {
    const startedAt = performance.now()
    redactSensitiveText(input)
    const elapsed = performance.now() - startedAt
    // Fail on the first over-budget run instead of collecting 20 quadratic
    // samples and hanging the whole suite.
    assert.ok(
      elapsed < ABSOLUTE_CEILING_MS,
      `${label} run ${i + 1} took ${elapsed.toFixed(1)}ms, over the ${ABSOLUTE_CEILING_MS}ms ceiling (quadratic redaction?)`,
    )
    samples.push(elapsed)
  }
  return median(samples)
}

test('redaction: 64KB unmatched letters stays under the absolute ceiling', () => {
  const median64 = measureMedian(LETTERS_64K, '64KB letters')
  assert.ok(
    median64 < ABSOLUTE_CEILING_MS,
    `64KB letters median ${median64.toFixed(1)}ms exceeded ${ABSOLUTE_CEILING_MS}ms`,
  )

  // Only check the size ratio when the 64KB median is slow enough for the
  // measurement to be meaningful; otherwise the tiny numbers are noise.
  if (median64 > RATIO_CHECK_THRESHOLD_MS) {
    const median128 = measureMedian(LETTERS_128K, '128KB letters')
    assert.ok(
      median128 <= median64 * MAX_SIZE_RATIO,
      `128KB median ${median128.toFixed(1)}ms is more than ${MAX_SIZE_RATIO}x the 64KB median ${median64.toFixed(1)}ms`,
    )
  }
})

test('redaction: 64KB mixed log-like input stays under the absolute ceiling', () => {
  for (const [label, input] of [
    ['mixed alphanumeric', MIXED_ALNUM_64K],
    ['realistic log line', LOG_LIKE_64K],
  ] as const) {
    const median64 = measureMedian(input, `64KB ${label}`)
    assert.ok(
      median64 < ABSOLUTE_CEILING_MS,
      `64KB ${label} median ${median64.toFixed(1)}ms exceeded ${ABSOLUTE_CEILING_MS}ms`,
    )
  }
})
