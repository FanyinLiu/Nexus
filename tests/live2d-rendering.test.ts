import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createLive2DApplicationOptions,
  LIVE2D_BOOT_FRAME_TIMEOUT_MS,
  LIVE2D_CONTEXT_RECOVERY_LIMIT,
  planLive2DContextRecovery,
  planLive2DVisibilityRecovery,
  resolveLive2DBootFrameWait,
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
    gcActive: false,
  })
})

test('Live2D canvas disables Pixi texture GC so cached WebGL handles stay valid', () => {
  const options = createLive2DApplicationOptions({} as HTMLElement)
  // Live2D draws through raw WebGL, so Pixi GC treats its textures as idle and
  // deletes them after the idle window. Binding those deleted handles is the
  // source of the post-restore INVALID_OPERATION flood.
  assert.equal(options.gcActive, false)
})

test('hidden Live2D boot does not wait for a suspended animation frame', () => {
  assert.deepEqual(resolveLive2DBootFrameWait({ visibilityState: 'hidden' }), {
    awaitFrame: false,
    timeoutMs: 0,
  })
  assert.deepEqual(resolveLive2DBootFrameWait({ visibilityState: 'visible' }), {
    awaitFrame: true,
    timeoutMs: LIVE2D_BOOT_FRAME_TIMEOUT_MS,
  })
  assert.equal(LIVE2D_BOOT_FRAME_TIMEOUT_MS > 0, true)
})

test('visibility recovery restarts a window that returns with a lost context', () => {
  assert.equal(planLive2DVisibilityRecovery({
    disposed: false,
    visibilityState: 'hidden',
    paused: false,
    contextLost: true,
  }), 'stop')
  assert.equal(planLive2DVisibilityRecovery({
    disposed: false,
    visibilityState: 'visible',
    paused: true,
    contextLost: false,
  }), 'stop')
  assert.equal(planLive2DVisibilityRecovery({
    disposed: false,
    visibilityState: 'visible',
    paused: false,
    contextLost: true,
  }), 'restart')
  assert.equal(planLive2DVisibilityRecovery({
    disposed: false,
    visibilityState: 'visible',
    paused: false,
    contextLost: false,
  }), 'start')
  assert.equal(planLive2DVisibilityRecovery({
    disposed: true,
    visibilityState: 'visible',
    paused: false,
    contextLost: true,
  }), 'stop')
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
