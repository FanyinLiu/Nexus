import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync, utimesSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  DEFAULT_THRESHOLDS,
  DEFAULT_CANDIDATE_RELEASE_DIRS,
  buildChildExitReport,
  buildHarnessSummary,
  discoverPackagedCandidates,
  evaluateProcessCountGrowth,
  evaluateVisibilityPauseSeries,
  DEFAULT_VISIBILITY_THRESHOLDS,
  evaluateRemountSeries,
  evaluateRssPlateau,
  median,
  maxOf,
  selectPackagedExecutable,
  verifyPackagedRuntimeIdentity,
  PACKAGED_RUNTIME_CDP_CONNECT_OPTIONS,
  PACKAGED_RUNTIME_REPORT_SCHEMA_VERSION,
  resolveVisibilityHiddenMs,
  writePreflightFailureReport,
} from '../scripts/packaged-sustained-runtime.mjs'
import { computeBuildInputFingerprint } from '../scripts/build-fingerprint.mjs'

test('median and maxOf handle empty and even-length arrays', () => {
  assert.equal(median([]), null)
  assert.equal(maxOf([]), null)
  assert.equal(median([3]), 3)
  assert.equal(median([1, 3, 2]), 2)
  assert.equal(median([1, 2, 3, 4]), 2.5)
  assert.equal(maxOf([1, 9, 3]), 9)
})

test('evaluateRssPlateau rejects insufficient samples for meaningful plateau', () => {
  const result = evaluateRssPlateau([
    { totalRssKb: 100 },
    { totalRssKb: 100 },
    { totalRssKb: 100 },
  ])
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'insufficient_samples')
  assert.ok((result.required ?? 0) >= 8)
  assert.ok(result.errors.some((error) => error.metric === 'minPlateauSamples'))
})

test('evaluateRssPlateau passes stable RSS series under relative budgets', () => {
  const samples = Array.from({ length: 10 }, (_, index) => ({
    totalRssKb: 100_000 + (index % 3) * 500,
  }))
  const result = evaluateRssPlateau(samples, DEFAULT_THRESHOLDS)
  assert.equal(result.ok, true)
  assert.ok((result.plateauRatio ?? 99) <= DEFAULT_THRESHOLDS.sustainedRssPlateauRatio)
  assert.equal(result.errors.length, 0)
})

test('evaluateRssPlateau fails when late RSS climbs past plateau budget', () => {
  const samples = [
    { totalRssKb: 100_000 },
    { totalRssKb: 100_000 },
    { totalRssKb: 100_000 },
    { totalRssKb: 100_000 },
    { totalRssKb: 100_000 },
    { totalRssKb: 200_000 },
    { totalRssKb: 210_000 },
    { totalRssKb: 220_000 },
    { totalRssKb: 230_000 },
    { totalRssKb: 240_000 },
  ]
  const result = evaluateRssPlateau(samples, DEFAULT_THRESHOLDS)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.metric === 'sustainedRssPlateauRatio'))
})

test('evaluateRemountSeries requires ready Live2D and stable canvas count', () => {
  const failing = evaluateRemountSeries([
    {
      cycle: 1,
      ready: true,
      canvasCount: 1,
      totalRssKb: 120_000,
    },
    {
      cycle: 2,
      ready: true,
      canvasCount: 3,
      totalRssKb: 121_000,
    },
  ], DEFAULT_THRESHOLDS, 2)
  assert.equal(failing.ok, false)
  assert.ok(failing.errors.some((error) => error.metric === 'maxCanvasPerDocument'))

  const notReady = evaluateRemountSeries([
    {
      cycle: 1,
      ready: false,
      canvasCount: 0,
      totalRssKb: 120_000,
      phase: 'booting',
    },
  ], DEFAULT_THRESHOLDS, 1)
  assert.equal(notReady.ok, false)
  assert.ok(notReady.errors.some((error) => error.metric === 'live2dReadyAfterRemount'))
})

test('evaluateRemountSeries fails when RSS growth exceeds remount budget', () => {
  const result = evaluateRemountSeries([
    { cycle: 1, ready: true, canvasCount: 1, totalRssKb: 100_000 },
    { cycle: 2, ready: true, canvasCount: 1, totalRssKb: 120_000 },
    { cycle: 3, ready: true, canvasCount: 1, totalRssKb: 180_000 },
  ], DEFAULT_THRESHOLDS, 3)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.metric === 'remountRssGrowthRatio'))
  assert.equal(result.growthRatio, 1.8)
})

test('evaluateRemountSeries passes bounded remount series', () => {
  const result = evaluateRemountSeries([
    { cycle: 1, ready: true, canvasCount: 1, totalRssKb: 100_000 },
    { cycle: 2, ready: true, canvasCount: 1, totalRssKb: 105_000 },
    { cycle: 3, ready: true, canvasCount: 1, totalRssKb: 110_000 },
    { cycle: 4, ready: true, canvasCount: 1, totalRssKb: 108_000 },
    { cycle: 5, ready: true, canvasCount: 1, totalRssKb: 112_000 },
  ], DEFAULT_THRESHOLDS, 5)
  assert.equal(result.ok, true)
  assert.equal(result.growthRatio, 1.12)
})

test('evaluateRemountSeries treats empty series as skipped incomplete', () => {
  const result = evaluateRemountSeries([], DEFAULT_THRESHOLDS, 5)
  assert.equal(result.ok, false)
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'no_remount_samples')
})

test('evaluateProcessCountGrowth flags helper process leaks', () => {
  const ok = evaluateProcessCountGrowth(
    [{ processCount: 4 }, { processCount: 5 }],
    [{ processCount: 5 }, { processCount: 6 }],
  )
  assert.equal(ok.ok, true)

  const leak = evaluateProcessCountGrowth(
    [{ processCount: 4 }, { processCount: 4 }],
    [{ processCount: 9 }, { processCount: 10 }],
  )
  assert.equal(leak.ok, false)
  assert.ok(leak.errors.some((error) => error.metric === 'maxProcessCountGrowth'))
})

test('evaluateProcessCountGrowth does not silently pass missing samples', () => {
  const result = evaluateProcessCountGrowth([], [])
  assert.equal(result.ok, false)
  assert.equal(result.skipped, true)
})

test('thresholds stay relative and do not invent absolute CPU budgets', () => {
  assert.equal('absoluteCpuPercent' in DEFAULT_THRESHOLDS, false)
  assert.equal('maxCpuPercent' in DEFAULT_THRESHOLDS, false)
  assert.ok(DEFAULT_THRESHOLDS.sustainedRssPlateauRatio > 1)
  assert.ok(DEFAULT_THRESHOLDS.remountRssGrowthRatio > 1)
  assert.ok(DEFAULT_THRESHOLDS.minPlateauSamples >= 8)
})

function makeIdentityFixture({
  sourceVersion = '9.9.9',
  packagedVersion = sourceVersion,
  packagedDigest = null,
} = {}) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'nexus-runtime-identity-'))
  const distPath = path.join(tmp, 'dist')
  const packagedRoot = path.join(tmp, 'Nexus.app', 'Contents', 'Resources', 'app')
  mkdirSync(distPath, { recursive: true })
  mkdirSync(path.join(packagedRoot, 'dist'), { recursive: true })
  writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ version: sourceVersion }))
  const fingerprint = computeBuildInputFingerprint(tmp)
  const stamp = {
    schemaVersion: 1,
    algorithm: fingerprint.algorithm,
    inputFingerprint: fingerprint.digest,
    inputFileCount: fingerprint.fileCount,
  }
  writeFileSync(path.join(distPath, 'build-integrity.json'), `${JSON.stringify(stamp)}\n`)
  writeFileSync(path.join(packagedRoot, 'package.json'), JSON.stringify({ version: packagedVersion }))
  writeFileSync(
    path.join(packagedRoot, 'dist', 'build-integrity.json'),
    `${JSON.stringify({ ...stamp, ...(packagedDigest ? { inputFingerprint: packagedDigest } : {}) })}\n`,
  )
  return { tmp, appPath: path.join(tmp, 'Nexus.app'), fingerprint }
}

test('verifyPackagedRuntimeIdentity derives productVersion from fixture package metadata', () => {
  const fixture = makeIdentityFixture({ sourceVersion: '9.9.9' })
  try {
    const result = verifyPackagedRuntimeIdentity({ root: fixture.tmp, appPath: fixture.appPath })
    assert.equal(result.ok, true)
    assert.equal(result.productVersion, '9.9.9')
    assert.equal(result.source.packageJsonVersion, '9.9.9')
    assert.equal(result.packaged.packageJsonVersion, '9.9.9')
    assert.equal(result.comparisons.allFingerprintsMatch, true)
  } finally {
    rmSync(fixture.tmp, { recursive: true, force: true })
  }
})

test('build fingerprint changes when Electron main source changes', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'nexus-build-fingerprint-'))
  try {
    const electronRoot = path.join(tmp, 'electron')
    mkdirSync(electronRoot, { recursive: true })
    writeFileSync(path.join(electronRoot, 'main.js'), 'const buildMarker = "before"\n')
    writeFileSync(path.join(electronRoot, 'preload.js'), 'window.bridge = true\n')
    const before = computeBuildInputFingerprint(tmp)
    assert.ok(before.inputPaths.includes('electron/main.js'))
    assert.ok(before.inputPaths.includes('electron/preload.js'))

    writeFileSync(path.join(electronRoot, 'main.js'), 'const buildMarker = "after"\n')
    const after = computeBuildInputFingerprint(tmp)
    assert.notEqual(after.digest, before.digest)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('build fingerprint covers browser VAD but excludes its timestamped download receipt', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'nexus-build-vad-fingerprint-'))
  try {
    const vadRoot = path.join(tmp, 'public', 'vendor', 'vad')
    mkdirSync(vadRoot, { recursive: true })
    const modelPath = path.join(vadRoot, 'silero_vad_v5.onnx')
    const receiptPath = path.join(vadRoot, '.nexus-model.json')
    writeFileSync(modelPath, 'verified-model-bytes')
    writeFileSync(receiptPath, '{"installedAt":"2026-07-15T00:00:00.000Z"}\n')

    const before = computeBuildInputFingerprint(tmp)
    assert.ok(before.inputPaths.includes('public/vendor/vad/silero_vad_v5.onnx'))
    assert.ok(!before.inputPaths.includes('public/vendor/vad/.nexus-model.json'))

    writeFileSync(receiptPath, '{"installedAt":"2026-07-15T01:00:00.000Z"}\n')
    const receiptChanged = computeBuildInputFingerprint(tmp)
    assert.equal(receiptChanged.digest, before.digest)

    writeFileSync(modelPath, 'tampered-model-bytes')
    const modelChanged = computeBuildInputFingerprint(tmp)
    assert.notEqual(modelChanged.digest, before.digest)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('build fingerprint covers packaged Python, adapter, webhook, and entitlements inputs', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'nexus-packaged-inputs-'))
  try {
    const adapterRoot = path.join(tmp, 'scripts', 'communication-adapters')
    mkdirSync(adapterRoot, { recursive: true })
    mkdirSync(path.join(tmp, 'build'), { recursive: true })
    const packagedFiles = {
      'scripts/omnivoice_server.py': 'print("voice")\n',
      'scripts/glm_asr_server.py': 'print("asr")\n',
      'scripts/send-message-webhook.mjs': 'export default true\n',
      'scripts/communication-adapters/fixture.mjs': 'export const adapter = 1\n',
      'build/entitlements.mac.plist': '<plist version="1.0" />\n',
    }
    for (const [relativePath, content] of Object.entries(packagedFiles)) {
      const filePath = path.join(tmp, relativePath)
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, content)
    }

    const before = computeBuildInputFingerprint(tmp)
    for (const relativePath of Object.keys(packagedFiles)) {
      assert.ok(before.inputPaths.includes(relativePath), `missing fingerprint input: ${relativePath}`)
    }

    writeFileSync(path.join(tmp, 'scripts', 'communication-adapters', 'fixture.mjs'), 'export const adapter = 2\n')
    const after = computeBuildInputFingerprint(tmp)
    assert.notEqual(after.digest, before.digest)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('release report schema and hidden duration floor stay fail-closed', () => {
  assert.equal(PACKAGED_RUNTIME_REPORT_SCHEMA_VERSION, 4)
  assert.deepEqual(PACKAGED_RUNTIME_CDP_CONNECT_OPTIONS, {
    timeout: 5_000,
    noDefaults: true,
  })
  assert.equal(Object.isFrozen(PACKAGED_RUNTIME_CDP_CONNECT_OPTIONS), true)
  assert.equal(resolveVisibilityHiddenMs(0), DEFAULT_VISIBILITY_THRESHOLDS.minHiddenDurationMs)
  assert.equal(resolveVisibilityHiddenMs(8_000), 8_000)
})

test('native visibility evidence uses only the pet-panel product lifecycle', () => {
  const cdpSource = readFileSync(
    new URL('../scripts/lib/packaged-sustained-runtime-cdp.mjs', import.meta.url),
    'utf8',
  )
  const harnessSource = readFileSync(
    new URL('../scripts/packaged-sustained-runtime.mjs', import.meta.url),
    'utf8',
  )

  assert.match(cdpSource, /NATIVE_VISIBILITY_METHOD = 'native_pet_panel_hide_show'/)
  assert.match(cdpSource, /NATIVE_VISIBILITY_TRANSITION_TIMEOUT_MS = 3_000/)
  assert.match(cdpSource, /NATIVE_VISIBILITY_POLL_INTERVAL_MS = 100/)
  assert.match(cdpSource, /isViewPage\(page, 'pet'\)/)
  assert.match(cdpSource, /isViewPage\(candidate, 'panel'\)/)
  assert.match(cdpSource, /await window\.desktopPet\.openPanel\('chat'\)/)
  assert.match(cdpSource, /await window\.desktopPet\.closePanel\(\)/)
  assert.match(
    harnessSource,
    /chromium\.connectOverCDP\(\s*`http:\/\/127\.0\.0\.1:\$\{port\}`\s*,\s*PACKAGED_RUNTIME_CDP_CONNECT_OPTIONS,?\s*\)/,
  )
  assert.match(harnessSource, /cdpNoDefaults:\s*PACKAGED_RUNTIME_CDP_CONNECT_OPTIONS\.noDefaults/)
  assert.doesNotMatch(cdpSource, /osascript|System Events|execFileSync|setMacProcessVisibility|rootPid/)
  assert.doesNotMatch(cdpSource, /native_process_hide_show/)
  assert.doesNotMatch(
    harnessSource,
    /setWindowHidden\(\s*browser,\s*live2dPage,\s*(?:true|false),\s*child\.pid/,
  )
})

test('verifyPackagedRuntimeIdentity fails closed on packaged fingerprint mismatch', () => {
  const fixture = makeIdentityFixture({ packagedDigest: 'f'.repeat(64) })
  try {
    const result = verifyPackagedRuntimeIdentity({ root: fixture.tmp, appPath: fixture.appPath })
    assert.equal(result.ok, false)
    assert.equal(result.comparisons.sourceToDist, true)
    assert.equal(result.comparisons.sourceToPackaged, false)
    assert.ok(result.errors.some((error) => error.metric === 'packagedBuildIntegrityFingerprint'))
    assert.equal(result.source.fingerprint.digest, fixture.fingerprint.digest)
  } finally {
    rmSync(fixture.tmp, { recursive: true, force: true })
  }
})

function makeVisibilityCycle(cycle, {
  hiddenModelDelta = 0,
  hiddenTickerDelta = 0,
  resumedModelDelta = 4,
  resumedTickerDelta = 4,
  hideMethod = 'native_pet_panel_hide_show',
  showMethod = 'native_pet_panel_hide_show',
  panelPageObserved = true,
  hiddenStartedAtMs = 10_000 + cycle * 10_000,
  hiddenEndedAtMs = hiddenStartedAtMs + 5_000,
  hiddenDurationMs = hiddenEndedAtMs - hiddenStartedAtMs,
} = {}) {
  const hiddenStart = {
    visibilityState: 'hidden',
    hidden: true,
    probeInstalled: true,
    modelUpdateCount: 100,
    tickerTickCount: 200,
  }
  const hiddenEnd = {
    ...hiddenStart,
    modelUpdateCount: hiddenStart.modelUpdateCount + hiddenModelDelta,
    tickerTickCount: hiddenStart.tickerTickCount + hiddenTickerDelta,
  }
  const resumedStart = {
    visibilityState: 'visible',
    hidden: false,
    probeInstalled: true,
    modelUpdateCount: hiddenEnd.modelUpdateCount,
    tickerTickCount: hiddenEnd.tickerTickCount,
  }
  const resumedEnd = {
    ...resumedStart,
    modelUpdateCount: resumedStart.modelUpdateCount + resumedModelDelta,
    tickerTickCount: resumedStart.tickerTickCount + resumedTickerDelta,
  }
  return {
    cycle,
    hide: {
      ok: true,
      hidden: true,
      visibilityState: 'hidden',
      method: hideMethod,
      panelPageObserved,
    },
    hidden: {
      startedAtMs: hiddenStartedAtMs,
      endedAtMs: hiddenEndedAtMs,
      durationMs: hiddenDurationMs,
      start: hiddenStart,
      end: hiddenEnd,
    },
    show: { ok: true, hidden: false, visibilityState: 'visible', method: showMethod },
    resumed: { start: resumedStart, end: resumedEnd },
  }
}

function makePassingVisibilityEvidence(requiredCycles = 5) {
  const visibilityLog = Array.from({ length: requiredCycles }, (_, index) => makeVisibilityCycle(index + 1))
  return {
    visibilityLog,
    visibilityEvaluation: evaluateVisibilityPauseSeries(
      visibilityLog,
      DEFAULT_VISIBILITY_THRESHOLDS,
      requiredCycles,
    ),
  }
}

test('evaluateVisibilityPauseSeries requires zero hidden deltas and positive resumed deltas', () => {
  assert.equal(DEFAULT_VISIBILITY_THRESHOLDS.minHiddenDurationMs, 5_000)
  const passing = evaluateVisibilityPauseSeries(
    [makeVisibilityCycle(1)],
    DEFAULT_VISIBILITY_THRESHOLDS,
    1,
  )
  assert.equal(passing.ok, true)
  assert.equal(passing.evaluations[0].hidden.modelUpdateDelta, 0)
  assert.equal(passing.evaluations[0].hidden.tickerDelta, 0)
  assert.ok(passing.evaluations[0].resumed.modelUpdateDelta > 0)
  assert.ok(passing.evaluations[0].resumed.tickerDelta > 0)

  const failing = evaluateVisibilityPauseSeries(
    [makeVisibilityCycle(1, { hiddenModelDelta: 1, resumedTickerDelta: 0 })],
    DEFAULT_VISIBILITY_THRESHOLDS,
    1,
  )
  assert.equal(failing.ok, false)
  assert.ok(failing.errors.some((error) => error.metric === 'hiddenModelUpdateDelta'))
  assert.ok(failing.errors.some((error) => error.metric === 'resumedTickerDelta'))

  const emulated = evaluateVisibilityPauseSeries(
    [makeVisibilityCycle(1, {
      hideMethod: 'Emulation.setEmulatedVisibilityState',
      showMethod: 'Emulation.setEmulatedVisibilityState',
    })],
    DEFAULT_VISIBILITY_THRESHOLDS,
    1,
  )
  assert.equal(emulated.ok, false)
  assert.ok(emulated.errors.some((error) => error.metric === 'visibilityHide'))
  assert.ok(emulated.errors.some((error) => error.metric === 'visibilityShow'))

  const legacyProcessToggle = evaluateVisibilityPauseSeries(
    [makeVisibilityCycle(1, {
      hideMethod: 'native_process_hide_show',
      showMethod: 'native_process_hide_show',
    })],
    DEFAULT_VISIBILITY_THRESHOLDS,
    1,
  )
  assert.equal(legacyProcessToggle.ok, false)
  assert.ok(legacyProcessToggle.errors.some((error) => error.metric === 'visibilityHide'))
  assert.ok(legacyProcessToggle.errors.some((error) => error.metric === 'visibilityShow'))
})

test('evaluateVisibilityPauseSeries requires the exact ordered visibility cycle sequence', () => {
  const passingCycles = [1, 2, 3, 4].map((cycle) => makeVisibilityCycle(cycle))
  const passing = evaluateVisibilityPauseSeries(
    passingCycles,
    DEFAULT_VISIBILITY_THRESHOLDS,
    4,
  )
  assert.equal(passing.ok, true)

  const duplicate = evaluateVisibilityPauseSeries(
    [1, 1, 1, 1].map((cycle) => makeVisibilityCycle(cycle)),
    DEFAULT_VISIBILITY_THRESHOLDS,
    4,
  )
  assert.equal(duplicate.ok, false)
  assert.ok(duplicate.errors.some((error) => error.metric === 'visibilityCycleSequence'))

  const gap = evaluateVisibilityPauseSeries(
    [1, 2, 4, 5].map((cycle) => makeVisibilityCycle(cycle)),
    DEFAULT_VISIBILITY_THRESHOLDS,
    4,
  )
  assert.equal(gap.ok, false)
  assert.ok(gap.errors.some((error) => error.metric === 'visibilityCycleSequence'))

  const extra = evaluateVisibilityPauseSeries(
    [1, 2, 3, 4, 5].map((cycle) => makeVisibilityCycle(cycle)),
    DEFAULT_VISIBILITY_THRESHOLDS,
    4,
  )
  assert.equal(extra.ok, false)
  assert.ok(extra.errors.some((error) => error.metric === 'visibilityCycleCount'))
})

test('evaluateVisibilityPauseSeries measures hidden duration from explicit consistent timestamps', () => {
  const forgedDuration = makeVisibilityCycle(1, {
    hiddenStartedAtMs: 10_000,
    hiddenEndedAtMs: 10_001,
    hiddenDurationMs: 5_000,
  })
  const forged = evaluateVisibilityPauseSeries(
    [forgedDuration],
    DEFAULT_VISIBILITY_THRESHOLDS,
    1,
  )
  assert.equal(forged.ok, false)
  assert.equal(forged.evaluations[0].hiddenDurationMs, 1)
  assert.ok(forged.errors.some((error) => error.metric === 'visibilityHiddenDurationConsistency'))
  assert.ok(forged.errors.some((error) => error.metric === 'visibilityHiddenDurationMs'))

  const missingTimestamp = makeVisibilityCycle(1)
  delete missingTimestamp.hidden.startedAtMs
  const missing = evaluateVisibilityPauseSeries(
    [missingTimestamp],
    DEFAULT_VISIBILITY_THRESHOLDS,
    1,
  )
  assert.equal(missing.ok, false)
  assert.ok(missing.errors.some((error) => error.metric === 'visibilityHiddenTiming'))
})

test('evaluateVisibilityPauseSeries rejects panel-only or missing native panel provenance', () => {
  const missingPanel = evaluateVisibilityPauseSeries(
    [makeVisibilityCycle(1, { panelPageObserved: false })],
    DEFAULT_VISIBILITY_THRESHOLDS,
    1,
  )
  assert.equal(missingPanel.ok, false)
  assert.ok(missingPanel.errors.some((error) => error.metric === 'visibilityHide'))

  const panelOnlyCycle = makeVisibilityCycle(1)
  panelOnlyCycle.hide.visibilityState = 'visible'
  const panelOnly = evaluateVisibilityPauseSeries(
    [panelOnlyCycle],
    DEFAULT_VISIBILITY_THRESHOLDS,
    1,
  )
  assert.equal(panelOnly.ok, false)
  assert.ok(panelOnly.errors.some((error) => error.metric === 'visibilityHide'))
})

test('evaluateVisibilityPauseSeries requires explicit visible resume endpoints and probe continuity', () => {
  const missingStartCycle = makeVisibilityCycle(1)
  missingStartCycle.resumed.start = null
  missingStartCycle.resumed.end.probeInstalled = false
  const missingStart = evaluateVisibilityPauseSeries(
    [missingStartCycle],
    DEFAULT_VISIBILITY_THRESHOLDS,
    1,
  )
  assert.equal(missingStart.ok, false)
  assert.ok(missingStart.errors.some((error) => error.metric === 'visibilityResumedStartState'))
  assert.ok(missingStart.errors.some((error) => error.metric === 'visibilityResumedProbeContinuity'))
  assert.ok(missingStart.errors.some((error) => error.metric === 'resumedModelUpdateDelta'))
  assert.ok(missingStart.errors.some((error) => error.metric === 'resumedTickerDelta'))
})

test('writePreflightFailureReport overwrites an old green report', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'nexus-runtime-report-'))
  try {
    const outputDir = path.join(tmp, 'output')
    mkdirSync(outputDir, { recursive: true })
    const reportPath = path.join(outputDir, 'report.json')
    writeFileSync(reportPath, JSON.stringify({ schemaVersion: 2, summary: { ok: true }, stale: true }))
    const written = writePreflightFailureReport({
      outputDir,
      reason: 'fixture selection failed',
      selectionResult: { ok: false, reason: 'fixture selection failed' },
    })
    const report = JSON.parse(readFileSync(written.reportPath, 'utf8'))
    assert.equal(written.reportPath, reportPath)
    assert.equal(report.schemaVersion, 4)
    assert.equal(report.config.cdpNoDefaults, true)
    assert.equal(report.summary.ok, false)
    assert.equal(report.summary.status, 'failed')
    assert.equal(report.stale, undefined)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('buildHarnessSummary: skipped CDP forces incomplete not success', () => {
  const summary = buildHarnessSummary({
    cdpConnected: false,
    skipCdp: true,
    remountEvaluation: { ok: true, skipped: true, reason: 'cdp_unavailable' },
    remountSamples: [],
    plateau: { ok: true, errors: [] },
    processGrowth: { ok: true, errors: [] },
    live2dReadyObserved: false,
  })
  assert.equal(summary.ok, false)
  assert.equal(summary.status, 'incomplete')
  assert.equal(summary.lifecycleComplete, false)
  assert.equal(summary.processMetricsOnly, true)
  assert.ok(summary.errorDetails.some((error) => error.metric === 'cdpRequired'))
  assert.ok(summary.errorDetails.some((error) => error.metric === 'remountLifecycle'))
})

test('buildHarnessSummary: CDP unavailable without skip still incomplete', () => {
  const summary = buildHarnessSummary({
    cdpConnected: false,
    skipCdp: false,
    remountEvaluation: {
      ok: false,
      skipped: true,
      reason: 'cdp_unavailable',
      errors: [{ metric: 'remountSamples', actual: 0, budget: 5 }],
    },
    remountSamples: [],
    plateau: {
      ok: true,
      plateauRatio: 1.0,
      errors: [],
    },
    processGrowth: { ok: true, growth: 0, errors: [] },
    live2dReadyObserved: false,
  })
  assert.equal(summary.ok, false)
  assert.equal(summary.status, 'incomplete')
  assert.equal(summary.processEvidence.ok, true)
  assert.equal(summary.lifecycleEvidence.ok, false)
})

test('buildHarnessSummary: full lifecycle evidence can pass', () => {
  const remountSamples = Array.from({ length: 5 }, (_, index) => ({
    cycle: index + 1,
    ready: true,
    canvasCount: 1,
    totalRssKb: 100_000 + index * 1000,
  }))
  const remountEvaluation = evaluateRemountSeries(remountSamples, DEFAULT_THRESHOLDS, 5)
  const visibility = makePassingVisibilityEvidence(5)
  const summary = buildHarnessSummary({
    cdpConnected: true,
    skipCdp: false,
    coldStart: { ok: true, elapsedMs: 1200 },
    remountEvaluation,
    remountSamples,
    requiredRemountCycles: 5,
    plateau: { ok: true, errors: [] },
    processGrowth: { ok: true, errors: [] },
    ...visibility,
    requiredVisibilityCycles: 5,
    live2dReadyObserved: true,
  })
  assert.equal(summary.ok, true)
  assert.equal(summary.status, 'ok')
  assert.equal(summary.lifecycleComplete, true)
  assert.equal(summary.processMetricsOnly, false)
})

test('buildHarnessSummary rejects an emulated visibility cycle as release success', () => {
  const visibilityLog = [makeVisibilityCycle(1, {
    hideMethod: 'Emulation.setEmulatedVisibilityState',
    showMethod: 'Emulation.setEmulatedVisibilityState',
  })]
  const visibilityEvaluation = evaluateVisibilityPauseSeries(
    visibilityLog,
    DEFAULT_VISIBILITY_THRESHOLDS,
    1,
  )
  const summary = buildHarnessSummary({
    cdpConnected: true,
    skipCdp: false,
    coldStart: { ok: true },
    remountEvaluation: { ok: true, skipped: false },
    remountSamples: [{ cycle: 1, ready: true, canvasCount: 1, totalRssKb: 100_000 }],
    requiredRemountCycles: 1,
    plateau: { ok: true, errors: [] },
    processGrowth: { ok: true, errors: [] },
    visibilityEvaluation,
    visibilityLog,
    requiredVisibilityCycles: 1,
    live2dReadyObserved: true,
  })
  assert.equal(summary.ok, false)
  assert.ok(['failed', 'incomplete'].includes(summary.status))
  assert.ok(summary.errorDetails.some((error) => error.metric === 'visibilityMethod'))
})

test('buildHarnessSummary: remount threshold failure is failed not silent ok', () => {
  const remountSamples = [
    { cycle: 1, ready: true, canvasCount: 1, totalRssKb: 100_000 },
    { cycle: 2, ready: true, canvasCount: 1, totalRssKb: 200_000 },
    { cycle: 3, ready: true, canvasCount: 1, totalRssKb: 250_000 },
    { cycle: 4, ready: true, canvasCount: 1, totalRssKb: 280_000 },
    { cycle: 5, ready: true, canvasCount: 1, totalRssKb: 300_000 },
  ]
  const remountEvaluation = evaluateRemountSeries(remountSamples, DEFAULT_THRESHOLDS, 5)
  const visibility = makePassingVisibilityEvidence(5)
  const summary = buildHarnessSummary({
    cdpConnected: true,
    skipCdp: false,
    coldStart: { ok: true },
    remountEvaluation,
    remountSamples,
    requiredRemountCycles: 5,
    plateau: { ok: true, errors: [] },
    processGrowth: { ok: true, errors: [] },
    ...visibility,
    requiredVisibilityCycles: 5,
    live2dReadyObserved: true,
  })
  assert.equal(remountEvaluation.ok, false)
  assert.equal(summary.ok, false)
  assert.equal(summary.status, 'failed')
})

test('buildChildExitReport never claims natural exit when harness killed child', () => {
  const killed = buildChildExitReport({
    exitCode: null,
    signalCode: 'SIGKILL',
    termination: {
      attempted: true,
      terminatedByHarness: true,
      method: 'SIGTERM_then_SIGKILL',
      signalSent: 'SIGKILL',
      note: 'harness escalated to SIGKILL',
    },
    waitedForExit: true,
  })
  assert.equal(killed.terminatedByHarness, true)
  assert.equal(killed.disposition, 'killed_by_harness')
  assert.match(String(killed.note), /harness/i)
  assert.notEqual(killed.disposition, 'exited_naturally')

  const killedZero = buildChildExitReport({
    exitCode: 0,
    signalCode: null,
    termination: {
      attempted: true,
      terminatedByHarness: true,
      method: 'SIGTERM_then_SIGKILL',
      signalSent: 'SIGKILL',
      note: 'harness escalated to SIGKILL after SIGTERM grace period',
    },
    waitedForExit: true,
  })
  assert.equal(killedZero.disposition, 'killed_by_harness')
  assert.equal(killedZero.terminatedByHarness, true)
  assert.match(String(killedZero.note), /must not be read as natural success/i)

  const natural = buildChildExitReport({
    exitCode: 0,
    signalCode: null,
    termination: {
      attempted: false,
      terminatedByHarness: false,
      method: null,
      signalSent: null,
      note: 'process tree already exited before harness terminate',
    },
    waitedForExit: true,
  })
  assert.equal(natural.terminatedByHarness, false)
  assert.equal(natural.disposition, 'exited_naturally')
})

function makeFakeMacApp(releaseRoot: string, platformDir: string, appName: string, execName: string, mtimeSec: number) {
  const appPath = path.join(releaseRoot, platformDir, `${appName}.app`)
  const macOsDir = path.join(appPath, 'Contents', 'MacOS')
  mkdirSync(macOsDir, { recursive: true })
  const executable = path.join(macOsDir, execName)
  writeFileSync(executable, '#!/bin/sh\nexit 0\n')
  chmodSync(executable, 0o755)
  utimesSync(executable, mtimeSec, mtimeSec)
  utimesSync(appPath, mtimeSec, mtimeSec)
  return { appPath, executable }
}

test('selectPackagedExecutable prefers newest package and rejects stale older package', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'nexus-pkg-select-'))
  try {
    const smokeRoot = path.join(tmp, 'release-smoke')
    const releaseRoot = path.join(tmp, 'release')
    const older = makeFakeMacApp(releaseRoot, 'mac-arm64', 'Nexus', 'Nexus', 1_700_000_000)
    const newer = makeFakeMacApp(smokeRoot, 'mac-arm64', 'Nexus Smoke', 'Nexus Smoke', 1_800_000_000)

    const result = selectPackagedExecutable({
      root: tmp,
      platform: 'darwin',
      forcedReleaseDir: undefined,
      candidateDirsEnv: undefined,
      defaultDirs: ['release-smoke', 'release'],
    })

    assert.equal(result.ok, true)
    assert.equal(result.executable, newer.executable)
    assert.match(result.reason || '', /newest valid package/i)
    assert.ok(result.rejected.some((entry) => entry.executable === older.executable))
    assert.ok(result.rejected.some((entry) => /older than selected/i.test(entry.reason)))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('selectPackagedExecutable forced dir does not silently pick another root', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'nexus-pkg-forced-'))
  try {
    const smokeRoot = path.join(tmp, 'release-smoke')
    const releaseRoot = path.join(tmp, 'release')
    makeFakeMacApp(smokeRoot, 'mac-arm64', 'Nexus Smoke', 'Nexus Smoke', 1_800_000_000)
    const forced = makeFakeMacApp(releaseRoot, 'mac-arm64', 'Nexus', 'Nexus', 1_700_000_000)

    const result = selectPackagedExecutable({
      root: tmp,
      platform: 'darwin',
      forcedReleaseDir: 'release',
      defaultDirs: DEFAULT_CANDIDATE_RELEASE_DIRS,
    })

    assert.equal(result.ok, true)
    assert.equal(result.executable, forced.executable)
    assert.equal(result.discovery.mode, 'forced')
    assert.ok(!result.discovery.roots.some((dir) => dir.includes('release-smoke')))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('discoverPackagedCandidates reports missing roots without inventing packages', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'nexus-pkg-missing-'))
  try {
    const discovery = discoverPackagedCandidates({
      root: tmp,
      platform: 'darwin',
      forcedReleaseDir: undefined,
      candidateDirsEnv: undefined,
      defaultDirs: ['release-smoke', 'release'],
    })
    assert.equal(discovery.candidates.length, 0)
    assert.equal(discovery.missingRoots.length, 2)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
