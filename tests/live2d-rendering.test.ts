import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createLive2DApplicationOptions,
  LIVE2D_CONTEXT_RECOVERY_LIMIT,
  planLive2DContextRecovery,
} from '../src/features/pet/components/live2d/rendering.ts'

test('Live2D Pixi options preserve straight alpha for transparent Electron compositing', () => {
  const host = {} as HTMLElement

  assert.deepEqual(createLive2DApplicationOptions(host), {
    autoStart: true,
    resizeTo: host,
    backgroundAlpha: 0,
    antialias: true,
    premultipliedAlpha: false,
    preference: 'webgl',
  })
})

test('Live2D context recovery restarts twice before keeping a readable fallback', () => {
  const firstLoss = planLive2DContextRecovery(0)
  const secondLoss = planLive2DContextRecovery(firstLoss.attempts)
  const exhausted = planLive2DContextRecovery(secondLoss.attempts)

  assert.deepEqual(firstLoss, { action: 'restart', attempts: 1 })
  assert.deepEqual(secondLoss, { action: 'restart', attempts: 2 })
  assert.deepEqual(exhausted, {
    action: 'fallback',
    attempts: LIVE2D_CONTEXT_RECOVERY_LIMIT,
  })
})

test('Live2D context recovery normalizes invalid counters without growing the budget', () => {
  assert.deepEqual(planLive2DContextRecovery(Number.NaN), {
    action: 'restart',
    attempts: 1,
  })
  assert.deepEqual(planLive2DContextRecovery(-4, 0), {
    action: 'fallback',
    attempts: 0,
  })
})
