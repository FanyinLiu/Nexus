import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_REGRESSION_THRESHOLDS,
  buildBaseline,
  compareRuntimeToBaseline,
  extractRuntimeMetrics,
  sampleMainRendererRssKb,
} from '../scripts/lib/packaged-runtime-baseline.mjs'

function sustainedSample(mainKb: number, rendererKb: number) {
  return {
    phase: 'sustained',
    byRole: {
      main_or_other: { rssKb: mainKb },
      renderer: { rssKb: rendererKb },
      gpu: { rssKb: 50_000 },
    },
  }
}

function greenReport({ coldStartMs = 400 }: { coldStartMs?: number } = {}) {
  return {
    schemaVersion: 4,
    capturedAt: '2026-08-01T00:00:00.000Z',
    productVersion: '0.4.4',
    coldStart: { ok: true, elapsedMs: coldStartMs },
    measurements: { plateau: { ok: true, plateauRatio: 0.95 } },
    summary: { ok: true },
    environment: { platform: 'darwin', arch: 'arm64', node: 'v24.0.0' },
  }
}

function greenSamples(peakKb = 500_000) {
  return [
    sustainedSample(200_000, 250_000),
    sustainedSample(210_000, 260_000),
    sustainedSample(peakKb - 300_000, 300_000),
  ]
}

function localBaseline({ coldStartMs = 400, peakKb = 500_000, medianKb = 480_000 } = {}) {
  return {
    schemaVersion: 1,
    kind: 'packaged-runtime-baseline',
    machine: { platform: 'darwin', arch: 'arm64', node: 'v24.0.0', electron: '^43.2.0' },
    metrics: {
      coldStartMs,
      mainRendererRssKb: { peak: peakKb, median: medianKb },
      plateau: { ok: true, ratio: 0.95 },
    },
  }
}

test('sampleMainRendererRssKb sums main_or_other + renderer and excludes gpu/helpers', () => {
  assert.equal(sampleMainRendererRssKb(sustainedSample(200_000, 250_000)), 450_000)
  assert.equal(sampleMainRendererRssKb({ phase: 'sustained' }), null)
  assert.equal(sampleMainRendererRssKb({ byRole: { renderer: { rssKb: 100 } } }), 100)
})

test('compare ok: metrics within budgets report no regression', () => {
  const metrics = extractRuntimeMetrics({
    report: greenReport({ coldStartMs: 420 }),
    samples: greenSamples(520_000),
  })
  const result = compareRuntimeToBaseline({
    metrics,
    baseline: localBaseline(),
    platform: 'darwin',
    arch: 'arm64',
  })
  assert.equal(result.status, 'ok')
  assert.equal(result.regression, false)
  assert.equal(result.exceeded.length, 0)
  assert.equal(result.compared.length, 2)
})

test('compare regression: RSS peak > baseline x1.25 and cold start > baseline x1.5 are flagged', () => {
  const metrics = extractRuntimeMetrics({
    report: greenReport({ coldStartMs: 700 }),
    samples: greenSamples(640_000),
  })
  const result = compareRuntimeToBaseline({
    metrics,
    baseline: localBaseline(),
    platform: 'darwin',
    arch: 'arm64',
  })
  assert.equal(result.status, 'regression')
  assert.equal(result.regression, true)
  assert.deepEqual(
    result.exceeded.map((entry: { metric: string }) => entry.metric).sort(),
    ['coldStartMs', 'mainRendererRssKb.peak'],
  )
  const rss = result.exceeded.find((entry: { metric: string }) => entry.metric === 'mainRendererRssKb.peak')
  assert.equal(rss.budget, DEFAULT_REGRESSION_THRESHOLDS.rssPeakRatio)
})

test('compare inconclusive when baseline file is missing', () => {
  const metrics = extractRuntimeMetrics({ report: greenReport(), samples: greenSamples() })
  const result = compareRuntimeToBaseline({
    metrics,
    baseline: null,
    platform: 'darwin',
    arch: 'arm64',
  })
  assert.equal(result.status, 'inconclusive')
  assert.equal(result.regression, false)
  assert.equal(result.reason, 'baseline_missing')
})

test('compare skips missing metrics and is inconclusive when nothing is comparable', () => {
  const noColdStartReport = greenReport()
  noColdStartReport.coldStart = { ok: false, elapsedMs: null } as never
  const metrics = extractRuntimeMetrics({ report: noColdStartReport, samples: [] })
  const result = compareRuntimeToBaseline({
    metrics,
    baseline: localBaseline(),
    platform: 'darwin',
    arch: 'arm64',
  })
  assert.equal(result.status, 'inconclusive')
  assert.equal(result.reason, 'no_comparable_metrics')
  assert.equal(result.compared.length, 0)
  assert.deepEqual(
    result.skipped.map((entry: { metric: string }) => entry.metric).sort(),
    ['coldStartMs', 'mainRendererRssKb.peak'],
  )

  const partial = compareRuntimeToBaseline({
    metrics: extractRuntimeMetrics({ report: noColdStartReport, samples: greenSamples() }),
    baseline: localBaseline(),
    platform: 'darwin',
    arch: 'arm64',
  })
  assert.equal(partial.status, 'ok')
  assert.deepEqual(
    partial.compared.map((entry: { metric: string }) => entry.metric),
    ['mainRendererRssKb.peak'],
  )
  assert.deepEqual(
    partial.skipped.map((entry: { metric: string }) => entry.metric),
    ['coldStartMs'],
  )
})

test('compare inconclusive on platform/arch mismatch with the baseline machine', () => {
  const metrics = extractRuntimeMetrics({
    report: greenReport({ coldStartMs: 10_000 }),
    samples: greenSamples(10_000_000),
  })
  const result = compareRuntimeToBaseline({
    metrics,
    baseline: localBaseline(),
    platform: 'win32',
    arch: 'x64',
  })
  assert.equal(result.status, 'inconclusive')
  assert.equal(result.regression, false)
  assert.match(result.reason, /platform_mismatch/)
  assert.equal(result.compared.length, 0)
})

test('buildBaseline refuses non-green runs and records green run metrics', () => {
  const failedReport = greenReport()
  failedReport.summary = { ok: false } as never
  assert.throws(
    () => buildBaseline({ report: failedReport, samples: greenSamples() }),
    /summary\.ok/,
  )

  const baseline = buildBaseline({
    report: greenReport({ coldStartMs: 435 }),
    samples: greenSamples(519_824),
    electronVersion: '^43.2.0',
  })
  assert.equal(baseline.kind, 'packaged-runtime-baseline')
  assert.equal(baseline.metrics.coldStartMs, 435)
  assert.equal(baseline.metrics.mainRendererRssKb.peak, 519_824)
  assert.equal(baseline.machine.platform, 'darwin')
  assert.match(baseline.note, /本机参考值/)
})
