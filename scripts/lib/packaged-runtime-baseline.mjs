/**
 * Packaged sustained runtime baseline — record & regression compare.
 *
 * Pure logic module (unit-testable, no CLI side effects):
 * - extractRuntimeMetrics: pull the key metrics out of a sustained runtime
 *   report.json (+ its samples.jsonl) into a flat comparable shape.
 * - buildBaseline: turn a successful run into the versioned baseline file
 *   (tests/fixtures/packagedRuntimeBaseline.json).
 * - compareRuntimeToBaseline: warn-grade regression verdict.
 *
 * Semantics (《优化方案》P1, warn-only):
 * - main+renderer sustained RSS peak > baseline x 1.25  -> regression
 * - cold start ms            > baseline x 1.5           -> regression
 * - missing baseline / platform-arch mismatch / no comparable metrics
 *   -> inconclusive (never a hard failure)
 *
 * The baseline is a LOCAL MACHINE reference recorded on a specific host,
 * not a cross-machine promise — absolute RSS and cold-start values vary
 * with hardware and OS. Comparisons are only meaningful on the machine
 * that recorded the baseline (same platform + arch at minimum).
 */

import { median, maxOf } from './packaged-sustained-runtime-analysis.mjs'

export const PACKAGED_RUNTIME_BASELINE_SCHEMA_VERSION = 1

export const DEFAULT_REGRESSION_THRESHOLDS = Object.freeze({
  rssPeakRatio: 1.25,
  coldStartRatio: 1.5,
})

export const BASELINE_LOCAL_REFERENCE_NOTE =
  '本机参考值：基线记录于特定机器（platform/arch/Node/Electron 见 machine 字段），' +
  'RSS 与冷启动的绝对值随硬件与系统负载变化，不是跨机器承诺；' +
  '仅在记录基线的同环境机器上做回归比较才有意义。'

/**
 * main+renderer RSS for one process-tree sample, in KB.
 * `main_or_other` is the main process bucket (plus anything unclassified);
 * helpers/GPU/plugin/utility are intentionally excluded so the metric tracks
 * the app-owned working set. Returns null when the sample has no role data.
 */
export function sampleMainRendererRssKb(sample) {
  const byRole = sample?.byRole
  if (!byRole || typeof byRole !== 'object') return null
  const mainKb = byRole.main_or_other?.rssKb
  const rendererKb = byRole.renderer?.rssKb
  if (!Number.isFinite(mainKb) && !Number.isFinite(rendererKb)) return null
  return (Number.isFinite(mainKb) ? mainKb : 0) + (Number.isFinite(rendererKb) ? rendererKb : 0)
}

/**
 * Extract comparable metrics from a sustained runtime report + samples.
 * Missing data yields null fields (compare skips them) rather than throws.
 */
export function extractRuntimeMetrics({ report, samples } = {}) {
  const sustainedMainRenderer = (Array.isArray(samples) ? samples : [])
    .filter((sample) => sample?.phase === 'sustained')
    .map(sampleMainRendererRssKb)
    .filter(Number.isFinite)

  const coldStartMs = Number.isFinite(report?.coldStart?.elapsedMs)
    ? report.coldStart.elapsedMs
    : null

  return {
    coldStartMs,
    mainRendererRssKb: {
      peak: maxOf(sustainedMainRenderer),
      median: median(sustainedMainRenderer),
      sampleCount: sustainedMainRenderer.length,
    },
    plateau: {
      ok: report?.measurements?.plateau?.ok === true,
      ratio: Number.isFinite(report?.measurements?.plateau?.plateauRatio)
        ? report.measurements.plateau.plateauRatio
        : null,
    },
    summaryOk: report?.summary?.ok === true,
  }
}

/**
 * Build the versioned baseline record from a successful run.
 * Throws when the run is not green or required metrics are missing —
 * a baseline must never be recorded from a failed/incomplete run.
 */
export function buildBaseline({
  report,
  samples,
  recordedAt = new Date().toISOString(),
  electronVersion = null,
} = {}) {
  if (report?.summary?.ok !== true) {
    throw new Error('refusing to record baseline: report.summary.ok is not true (run was not green)')
  }
  const metrics = extractRuntimeMetrics({ report, samples })
  if (!Number.isFinite(metrics.coldStartMs)) {
    throw new Error('refusing to record baseline: coldStart.elapsedMs missing from report')
  }
  if (!Number.isFinite(metrics.mainRendererRssKb.peak) || !Number.isFinite(metrics.mainRendererRssKb.median)) {
    throw new Error('refusing to record baseline: no sustained main+renderer RSS samples (samples.jsonl missing or empty?)')
  }

  const environment = report?.environment ?? {}
  return {
    schemaVersion: PACKAGED_RUNTIME_BASELINE_SCHEMA_VERSION,
    kind: 'packaged-runtime-baseline',
    note: BASELINE_LOCAL_REFERENCE_NOTE,
    recordedAt,
    machine: {
      platform: environment.platform ?? null,
      arch: environment.arch ?? null,
      node: environment.node ?? null,
      electron: electronVersion,
      cpuCount: environment.cpuCount ?? null,
      totalMemBytes: environment.totalMemBytes ?? null,
    },
    sourceReport: {
      capturedAt: report.capturedAt ?? null,
      productVersion: report.productVersion ?? null,
      reportSchemaVersion: report.schemaVersion ?? null,
    },
    metrics: {
      coldStartMs: metrics.coldStartMs,
      mainRendererRssKb: {
        peak: metrics.mainRendererRssKb.peak,
        median: metrics.mainRendererRssKb.median,
      },
      plateau: {
        ok: metrics.plateau.ok,
        ratio: metrics.plateau.ratio,
      },
    },
  }
}

/**
 * Compare current-run metrics against a baseline record.
 *
 * Returns:
 *   { status: 'ok'|'regression'|'inconclusive', regression: boolean,
 *     reason: string|null, compared: [...], skipped: [...], exceeded: [...] }
 *
 * `compared`/`exceeded` entries: { metric, actual, baseline, ratio, budget }.
 * `skipped` entries: { metric, reason }.
 */
export function compareRuntimeToBaseline({
  metrics,
  baseline,
  thresholds = DEFAULT_REGRESSION_THRESHOLDS,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  if (!baseline || baseline.kind !== 'packaged-runtime-baseline') {
    return {
      status: 'inconclusive',
      regression: false,
      reason: 'baseline_missing',
      compared: [],
      skipped: [],
      exceeded: [],
    }
  }

  const baselinePlatform = baseline.machine?.platform ?? null
  const baselineArch = baseline.machine?.arch ?? null
  if ((baselinePlatform && baselinePlatform !== platform) || (baselineArch && baselineArch !== arch)) {
    return {
      status: 'inconclusive',
      regression: false,
      reason: `platform_mismatch (baseline ${baselinePlatform}/${baselineArch}, current ${platform}/${arch})`,
      compared: [],
      skipped: [],
      exceeded: [],
    }
  }

  const compared = []
  const skipped = []
  const exceeded = []

  const checks = [
    {
      metric: 'mainRendererRssKb.peak',
      actual: metrics?.mainRendererRssKb?.peak,
      baselineValue: baseline.metrics?.mainRendererRssKb?.peak,
      budget: thresholds.rssPeakRatio,
    },
    {
      metric: 'coldStartMs',
      actual: metrics?.coldStartMs,
      baselineValue: baseline.metrics?.coldStartMs,
      budget: thresholds.coldStartRatio,
    },
  ]

  for (const { metric, actual, baselineValue, budget } of checks) {
    if (!Number.isFinite(actual) || !Number.isFinite(baselineValue) || baselineValue <= 0) {
      skipped.push({ metric, reason: 'metric_missing' })
      continue
    }
    const ratio = actual / baselineValue
    const entry = {
      metric,
      actual,
      baseline: baselineValue,
      ratio: Number(ratio.toFixed(4)),
      budget,
    }
    compared.push(entry)
    if (ratio > budget) exceeded.push(entry)
  }

  if (compared.length === 0) {
    return {
      status: 'inconclusive',
      regression: false,
      reason: 'no_comparable_metrics',
      compared,
      skipped,
      exceeded,
    }
  }

  return {
    status: exceeded.length > 0 ? 'regression' : 'ok',
    regression: exceeded.length > 0,
    reason: null,
    compared,
    skipped,
    exceeded,
  }
}

/**
 * Format one compared/exceeded entry for humans.
 */
export function formatComparedEntry(entry) {
  return `${entry.metric}: ${entry.actual} vs baseline ${entry.baseline} (${entry.ratio}x, budget ${entry.budget}x)`
}
