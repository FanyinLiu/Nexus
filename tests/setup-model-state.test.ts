import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getModelProgressPercent,
  isModelProgressActive,
  isModelProgressComplete,
  isModelProgressError,
  mergeModelProgress,
  normalizeModelProgressEvent,
  shouldShowModelSetupOverlay,
} from '../src/features/setup/modelSetupState.ts'

test('mergeModelProgress preserves previous counters and clears stale errors on retry', () => {
  const afterError = mergeModelProgress({}, {
    modelId: 'vlm',
    phase: 'error',
    downloaded: 128,
    total: 256,
    fileName: 'model.bin',
    message: 'network failed',
  })

  const afterRetry = mergeModelProgress(afterError, {
    modelId: 'vlm',
    phase: 'downloading',
    downloaded: 192,
  })

  assert.deepEqual(afterRetry.vlm, {
    phase: 'downloading',
    downloaded: 192,
    total: 256,
    fileName: 'model.bin',
    message: undefined,
  })
})

test('mergeModelProgress resets stale counters and file labels when retry starts', () => {
  const afterError = mergeModelProgress({}, {
    modelId: 'vlm',
    phase: 'error',
    downloaded: 128,
    total: 256,
    fileName: 'old-model.bin',
    message: 'network failed',
  })

  const afterStart = mergeModelProgress(afterError, {
    modelId: 'vlm',
    phase: 'start',
  })

  assert.deepEqual(afterStart.vlm, {
    phase: 'start',
    downloaded: 0,
    total: 0,
    fileName: undefined,
    message: undefined,
  })
})

test('mergeModelProgress keeps total bytes at least downloaded bytes', () => {
  const progress = mergeModelProgress({}, {
    modelId: 'vlm',
    phase: 'downloading',
    downloaded: 512,
    total: 10,
  })

  assert.deepEqual(progress.vlm, {
    phase: 'downloading',
    downloaded: 512,
    total: 512,
    fileName: undefined,
    message: undefined,
  })
})

test('mergeModelProgress clamps later total-only updates against current downloaded bytes', () => {
  const initial = mergeModelProgress({}, {
    modelId: 'vlm',
    phase: 'downloading',
    downloaded: 512,
    total: 1024,
  })
  const progress = mergeModelProgress(initial, {
    modelId: 'vlm',
    phase: 'downloading',
    total: 10,
  })

  assert.deepEqual(progress.vlm, {
    phase: 'downloading',
    downloaded: 512,
    total: 512,
    fileName: undefined,
    message: undefined,
  })
})

test('normalizeModelProgressEvent rejects malformed progress events and clamps counters', () => {
  assert.equal(normalizeModelProgressEvent(null), null)
  assert.equal(normalizeModelProgressEvent({ modelId: 'vlm', phase: 'unknown' }), null)
  assert.equal(normalizeModelProgressEvent({ modelId: '', phase: 'downloading' }), null)

  assert.deepEqual(normalizeModelProgressEvent({
    modelId: ' vlm ',
    phase: 'downloading',
    downloaded: -5,
    total: '2048',
    fileName: ' model.bin ',
    message: ' ok ',
  }), {
    modelId: 'vlm',
    phase: 'downloading',
    downloaded: 0,
    total: 2048,
    fileName: 'model.bin',
    message: 'ok',
  })
})

test('mergeModelProgress ignores malformed progress events without polluting state', () => {
  const previous = {
    vlm: {
      phase: 'downloading' as const,
      downloaded: 1,
      total: 10,
    },
  }

  assert.equal(mergeModelProgress(previous, { phase: 'downloading', downloaded: 5 }), previous)
})

test('getModelProgressPercent clamps invalid and out-of-range download counters', () => {
  assert.equal(getModelProgressPercent(undefined), null)
  assert.equal(getModelProgressPercent({ phase: 'downloading', downloaded: 1, total: 0 }), null)
  assert.equal(getModelProgressPercent({ phase: 'downloading', downloaded: -5, total: 100 }), 0)
  assert.equal(getModelProgressPercent({ phase: 'downloading', downloaded: 250, total: 100 }), 100)
  assert.equal(getModelProgressPercent({ phase: 'downloading', downloaded: 49, total: 100 }), 49)
})

test('model progress phase helpers keep completed downloads out of pending UI state', () => {
  assert.equal(isModelProgressActive({ phase: 'start', downloaded: 0, total: 0 }), true)
  assert.equal(isModelProgressActive({ phase: 'downloading', downloaded: 1, total: 10 }), true)
  assert.equal(isModelProgressActive({ phase: 'done', downloaded: 10, total: 10 }), false)

  assert.equal(isModelProgressComplete({ phase: 'done', downloaded: 10, total: 10 }), true)
  assert.equal(isModelProgressComplete({ phase: 'installed', downloaded: 10, total: 10 }), true)
  assert.equal(isModelProgressComplete({ phase: 'error', downloaded: 5, total: 10 }), false)

  assert.equal(isModelProgressError({ phase: 'error', downloaded: 5, total: 10 }), true)
  assert.equal(isModelProgressError({ phase: 'installed', downloaded: 10, total: 10 }), false)
})

test('shouldShowModelSetupOverlay only opens for missing inventory that is not suppressed or dismissed', () => {
  assert.equal(shouldShowModelSetupOverlay({ suppressed: false, dismissed: false, inventoryReady: false }), true)
  assert.equal(shouldShowModelSetupOverlay({ suppressed: true, dismissed: false, inventoryReady: false }), false)
  assert.equal(shouldShowModelSetupOverlay({ suppressed: false, dismissed: true, inventoryReady: false }), false)
  assert.equal(shouldShowModelSetupOverlay({ suppressed: false, dismissed: false, inventoryReady: true }), false)
  assert.equal(shouldShowModelSetupOverlay({ suppressed: false, dismissed: false, inventoryReady: undefined }), false)
})
