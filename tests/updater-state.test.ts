import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyUpdaterStatus,
  createInitialUpdaterState,
  isUpdaterBusyEvent,
  normalizeUpdaterEvent,
  reduceUpdaterCheckResult,
  reduceUpdaterEvent,
} from '../src/features/updater/state.ts'

test('updater busy state covers checking, available, and progress phases', () => {
  assert.equal(isUpdaterBusyEvent({ type: 'idle' }), false)
  assert.equal(isUpdaterBusyEvent({ type: 'checking' }), true)
  assert.equal(isUpdaterBusyEvent({ type: 'available', version: '0.4.0', releaseNotes: null }), true)
  assert.equal(isUpdaterBusyEvent({
    type: 'progress',
    percent: 42,
    transferred: 42,
    total: 100,
    bytesPerSecond: 10,
  }), true)
  assert.equal(isUpdaterBusyEvent({ type: 'downloaded', version: '0.4.0', releaseNotes: null }), false)
  assert.equal(isUpdaterBusyEvent({
    type: 'manual-update',
    version: '0.4.0',
    releaseUrl: 'https://github.com/FanyinLiu/Nexus/releases/tag/v0.4.0',
    reason: 'macos-unsigned',
  }), false)
  assert.equal(isUpdaterBusyEvent({ type: 'not-available', version: '0.3.2' }), false)
  assert.equal(isUpdaterBusyEvent({ type: 'error', message: 'network failed' }), false)
  assert.equal(isUpdaterBusyEvent(null), false)
  assert.equal(isUpdaterBusyEvent({ type: 'unknown' }), false)
})

test('reduceUpdaterEvent updates the latest event and releases busy on terminal events', () => {
  const initial = createInitialUpdaterState()
  const available = reduceUpdaterEvent(initial, { type: 'available', version: '0.4.0', releaseNotes: null })
  assert.equal(available.busy, true)
  assert.deepEqual(available.event, { type: 'available', version: '0.4.0', releaseNotes: null })

  const downloaded = reduceUpdaterEvent(available, { type: 'downloaded', version: '0.4.0', releaseNotes: null })
  assert.equal(downloaded.busy, false)
  assert.deepEqual(downloaded.event, { type: 'downloaded', version: '0.4.0', releaseNotes: null })
})

test('normalizeUpdaterEvent clamps progress and ignores malformed display fields', () => {
  assert.deepEqual(normalizeUpdaterEvent({
    type: 'progress',
    percent: 143.4,
    transferred: 512,
    total: 10,
    bytesPerSecond: '2048',
  }), {
    type: 'progress',
    percent: 100,
    transferred: 512,
    total: 512,
    bytesPerSecond: 2048,
  })

  assert.deepEqual(normalizeUpdaterEvent({
    type: 'available',
    version: ' 0.4.0 ',
    releaseNotes: { html: '<p>notes</p>' },
  }), {
    type: 'available',
    version: '0.4.0',
    releaseNotes: null,
  })

  assert.deepEqual(normalizeUpdaterEvent({
    type: 'manual-update',
    version: ' 0.4.0 ',
    releaseUrl: 'https://example.com/not-allowed',
    reason: ' macos-unsigned ',
  }), {
    type: 'manual-update',
    version: '0.4.0',
    releaseUrl: 'https://github.com/FanyinLiu/Nexus/releases/latest',
    reason: 'macos-unsigned',
  })
})

test('normalizeUpdaterEvent derives progress percent from bytes when percent is missing', () => {
  assert.deepEqual(normalizeUpdaterEvent({
    type: 'progress',
    transferred: 25,
    total: 100,
    bytesPerSecond: 2048,
  }), {
    type: 'progress',
    percent: 25,
    transferred: 25,
    total: 100,
    bytesPerSecond: 2048,
  })

  assert.deepEqual(normalizeUpdaterEvent({
    type: 'progress',
    percent: -5,
    transferred: 25,
    total: 100,
    bytesPerSecond: 2048,
  }), {
    type: 'progress',
    percent: 0,
    transferred: 25,
    total: 100,
    bytesPerSecond: 2048,
  })
})

test('reduceUpdaterEvent turns malformed live events into terminal errors', () => {
  const busy = reduceUpdaterEvent(createInitialUpdaterState(), { type: 'checking' })
  const state = reduceUpdaterEvent(busy, { type: 'unexpected' })

  assert.equal(state.busy, false)
  assert.deepEqual(state.event, { type: 'error', message: 'Invalid updater event' })
})

test('applyUpdaterStatus imports packaged status and derives busy from the last event', () => {
  const state = applyUpdaterStatus(createInitialUpdaterState(), {
    currentVersion: '0.3.2',
    isPackaged: true,
    last: { type: 'available', version: '0.4.0', releaseNotes: null },
  })

  assert.equal(state.currentVersion, '0.3.2')
  assert.equal(state.isPackaged, true)
  assert.equal(state.updateMode, 'unknown')
  assert.equal(state.busy, true)
  assert.deepEqual(state.event, { type: 'available', version: '0.4.0', releaseNotes: null })
})

test('applyUpdaterStatus preserves known fields when status snapshots are partial or malformed', () => {
  const previous = applyUpdaterStatus(createInitialUpdaterState(), {
    currentVersion: '0.3.2',
    isPackaged: true,
    last: { type: 'checking' },
  })

  const state = applyUpdaterStatus(previous, {
    updateMode: 'manual-download',
    last: {
      type: 'progress',
      percent: Number.NaN,
      transferred: -10,
      total: Number.POSITIVE_INFINITY,
      bytesPerSecond: -1,
    },
  } as never)

  assert.equal(state.currentVersion, '0.3.2')
  assert.equal(state.isPackaged, true)
  assert.equal(state.updateMode, 'manual-download')
  assert.deepEqual(state.event, {
    type: 'progress',
    percent: 0,
    transferred: 0,
    total: 0,
    bytesPerSecond: 0,
  })
})

test('reduceUpdaterCheckResult records manual download updates without entering busy download state', () => {
  const state = reduceUpdaterCheckResult(createInitialUpdaterState(), {
    ok: true,
    currentVersion: '0.3.2',
    latestVersion: '0.4.0',
    updateMode: 'manual-download',
    manualDownload: true,
    releaseUrl: 'https://github.com/FanyinLiu/Nexus/releases/tag/v0.4.0',
    reason: 'macos-unsigned',
  }, 'check failed')

  assert.equal(state.currentVersion, '0.3.2')
  assert.equal(state.updateMode, 'manual-download')
  assert.equal(state.busy, false)
  assert.deepEqual(state.event, {
    type: 'manual-update',
    version: '0.4.0',
    releaseUrl: 'https://github.com/FanyinLiu/Nexus/releases/tag/v0.4.0',
    reason: 'macos-unsigned',
  })
})

test('reduceUpdaterCheckResult records available updates without waiting for push events', () => {
  const state = reduceUpdaterCheckResult(createInitialUpdaterState(), {
    ok: true,
    currentVersion: '0.3.2',
    latestVersion: '0.4.0',
  }, 'check failed')

  assert.equal(state.currentVersion, '0.3.2')
  assert.equal(state.busy, true)
  assert.deepEqual(state.event, { type: 'available', version: '0.4.0', releaseNotes: null })
})

test('reduceUpdaterCheckResult does not regress download progress from a late check result', () => {
  const progress = reduceUpdaterEvent(createInitialUpdaterState(), {
    type: 'progress',
    percent: 42,
    transferred: 42,
    total: 100,
    bytesPerSecond: 10,
  })
  const state = reduceUpdaterCheckResult(progress, {
    ok: true,
    currentVersion: '0.3.2',
    latestVersion: '0.4.0',
  }, 'check failed')

  assert.equal(state.busy, true)
  assert.deepEqual(state.event, progress.event)
})

test('reduceUpdaterCheckResult clears busy for no-update and failed checks', () => {
  const checking = reduceUpdaterEvent(createInitialUpdaterState(), { type: 'checking' })
  const upToDate = reduceUpdaterCheckResult(checking, {
    ok: true,
    currentVersion: '0.3.2',
    latestVersion: '0.3.2',
  }, 'check failed')

  assert.equal(upToDate.busy, false)
  assert.deepEqual(upToDate.event, { type: 'not-available', version: '0.3.2' })

  const failed = reduceUpdaterCheckResult(checking, {
    ok: false,
    currentVersion: '0.3.2',
    reason: 'network failed',
  }, 'check failed')

  assert.equal(failed.busy, false)
  assert.deepEqual(failed.event, { type: 'error', message: 'network failed' })
})

test('reduceUpdaterCheckResult falls back safely for malformed results and blank reasons', () => {
  const previous = applyUpdaterStatus(createInitialUpdaterState(), {
    currentVersion: '0.3.2',
    isPackaged: true,
    last: { type: 'checking' },
  })

  const upToDate = reduceUpdaterCheckResult(previous, {
    ok: true,
    latestVersion: '0.3.2',
  } as never, 'check failed')

  assert.equal(upToDate.busy, false)
  assert.equal(upToDate.currentVersion, '0.3.2')
  assert.deepEqual(upToDate.event, { type: 'not-available', version: '0.3.2' })

  const failed = reduceUpdaterCheckResult(previous, {
    ok: false,
    currentVersion: '0.3.2',
    reason: '   ',
  }, 'check failed')

  assert.equal(failed.busy, false)
  assert.deepEqual(failed.event, { type: 'error', message: 'check failed' })
})
