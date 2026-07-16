/**
 * Pure analysis, thresholds, and harness summary builders for the
 * packaged sustained runtime harness. No I/O or process control.
 */

/**
 * Relative / plateau gates — intentionally not absolute CPU budgets.
 * Meaningful plateau: early vs late half of sustained samples must not climb
 * past these ratios (median + peak). Do not weaken to pass noisy runs.
 */
export const DEFAULT_THRESHOLDS = {
  /** Late-half sustained median total RSS / early-half median */
  sustainedRssPlateauRatio: 1.4,
  /** Late-half peak total RSS / early-half median */
  sustainedRssPeakRatio: 1.75,
  /** Final remount sample total RSS / first settled remount sample */
  remountRssGrowthRatio: 1.5,
  /** Allowed extra helper processes after warmup (leak signal) */
  maxProcessCountGrowth: 3,
  /** Live2D canvas elements allowed per ready document */
  maxCanvasPerDocument: 1,
  /** Minimum sustained samples for a meaningful plateau judgment */
  minPlateauSamples: 8,
}

export function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

export function maxOf(values) {
  if (!values.length) return null
  return values.reduce((best, value) => (value > best ? value : best), values[0])
}

/**
 * Split samples into early/late halves and compute relative RSS growth.
 * Requires minPlateauSamples so a short noisy window cannot claim a plateau.
 */
export function evaluateRssPlateau(samples, thresholds = DEFAULT_THRESHOLDS) {
  const minSamples = thresholds.minPlateauSamples ?? 8
  const rss = samples.map((sample) => sample.totalRssKb).filter((value) => Number.isFinite(value))
  if (rss.length < minSamples) {
    return {
      ok: false,
      reason: 'insufficient_samples',
      sampleCount: rss.length,
      required: minSamples,
      errors: [{
        metric: 'minPlateauSamples',
        actual: rss.length,
        budget: minSamples,
      }],
    }
  }
  const split = Math.floor(rss.length / 2)
  const early = rss.slice(0, split)
  const late = rss.slice(split)
  const earlyMedian = median(early)
  const lateMedian = median(late)
  const latePeak = maxOf(late)
  const plateauRatio = earlyMedian > 0 ? lateMedian / earlyMedian : null
  const peakRatio = earlyMedian > 0 ? latePeak / earlyMedian : null
  const errors = []
  if (plateauRatio != null && plateauRatio > thresholds.sustainedRssPlateauRatio) {
    errors.push({
      metric: 'sustainedRssPlateauRatio',
      actual: Number(plateauRatio.toFixed(4)),
      budget: thresholds.sustainedRssPlateauRatio,
    })
  }
  if (peakRatio != null && peakRatio > thresholds.sustainedRssPeakRatio) {
    errors.push({
      metric: 'sustainedRssPeakRatio',
      actual: Number(peakRatio.toFixed(4)),
      budget: thresholds.sustainedRssPeakRatio,
    })
  }
  return {
    ok: errors.length === 0,
    sampleCount: rss.length,
    earlyMedianRssKb: earlyMedian,
    lateMedianRssKb: lateMedian,
    latePeakRssKb: latePeak,
    plateauRatio: plateauRatio == null ? null : Number(plateauRatio.toFixed(4)),
    peakRatio: peakRatio == null ? null : Number(peakRatio.toFixed(4)),
    errors,
  }
}

export function evaluateRemountSeries(remountSamples, thresholds = DEFAULT_THRESHOLDS, requiredCycles = 5) {
  if (!remountSamples.length) {
    return {
      ok: false,
      skipped: true,
      reason: 'no_remount_samples',
      errors: [{ metric: 'remountSamples', actual: 0, budget: requiredCycles }],
    }
  }
  const errors = []
  if (remountSamples.length < requiredCycles) {
    errors.push({
      metric: 'remountCycleCount',
      actual: remountSamples.length,
      budget: requiredCycles,
    })
  }
  for (const sample of remountSamples) {
    if (sample.canvasCount != null && sample.canvasCount > thresholds.maxCanvasPerDocument) {
      errors.push({
        metric: 'maxCanvasPerDocument',
        actual: sample.canvasCount,
        budget: thresholds.maxCanvasPerDocument,
        cycle: sample.cycle,
      })
    }
    if (sample.ready !== true) {
      errors.push({
        metric: 'live2dReadyAfterRemount',
        actual: 0,
        budget: 1,
        cycle: sample.cycle,
        phase: sample.phase ?? null,
      })
    }
  }
  const firstRss = remountSamples[0]?.totalRssKb
  const lastRss = remountSamples[remountSamples.length - 1]?.totalRssKb
  let growthRatio = null
  if (Number.isFinite(firstRss) && firstRss > 0 && Number.isFinite(lastRss)) {
    growthRatio = Number((lastRss / firstRss).toFixed(4))
    if (growthRatio > thresholds.remountRssGrowthRatio) {
      errors.push({
        metric: 'remountRssGrowthRatio',
        actual: growthRatio,
        budget: thresholds.remountRssGrowthRatio,
      })
    }
  }
  return {
    ok: errors.length === 0,
    skipped: false,
    cycleCount: remountSamples.length,
    firstRssKb: firstRss ?? null,
    lastRssKb: lastRss ?? null,
    growthRatio,
    errors,
  }
}

export function evaluateProcessCountGrowth(warmupSamples, sustainedSamples, thresholds = DEFAULT_THRESHOLDS) {
  const warmupCounts = warmupSamples.map((s) => s.processCount).filter(Number.isFinite)
  const sustainedCounts = sustainedSamples.map((s) => s.processCount).filter(Number.isFinite)
  if (!warmupCounts.length || !sustainedCounts.length) {
    return {
      ok: false,
      skipped: true,
      reason: 'insufficient_samples',
      errors: [{ metric: 'processCountSamples', actual: 0, budget: 1 }],
    }
  }
  const baseline = maxOf(warmupCounts)
  const peak = maxOf(sustainedCounts)
  const growth = peak - baseline
  const errors = []
  if (growth > thresholds.maxProcessCountGrowth) {
    errors.push({
      metric: 'maxProcessCountGrowth',
      actual: growth,
      budget: thresholds.maxProcessCountGrowth,
      baseline,
      peak,
    })
  }
  return {
    ok: errors.length === 0,
    skipped: false,
    baselineProcessCount: baseline,
    peakProcessCount: peak,
    growth,
    errors,
  }
}

export const DEFAULT_VISIBILITY_THRESHOLDS = {
  /** The default acceptance window is the requested five seconds. */
  minHiddenDurationMs: 5_000,
}

function counterDelta(start, end, key) {
  if (!Number.isFinite(start?.[key]) || !Number.isFinite(end?.[key])) return null
  return end[key] - start[key]
}

/**
 * Judge one real pet -> panel -> pet hide/show cycle. Missing probe counters
 * or visibility proof are failures; they are never treated as a skipped pass.
 */
export function evaluateVisibilityPauseCycle(
  cycle,
  thresholds = DEFAULT_VISIBILITY_THRESHOLDS,
) {
  const hide = cycle?.hide ?? {}
  const show = cycle?.show ?? {}
  const hidden = cycle?.hidden ?? {}
  const resumed = cycle?.resumed ?? {}
  const hiddenStart = hidden.start ?? null
  const hiddenEnd = hidden.end ?? null
  const resumedStart = resumed.start ?? null
  const resumedEnd = resumed.end ?? null
  const errors = []

  if (
    hide.ok !== true
    || hide.hidden !== true
    || hide.visibilityState !== 'hidden'
    || hide.method !== 'native_pet_panel_hide_show'
    || hide.panelPageObserved !== true
  ) {
    errors.push({
      metric: 'visibilityHide',
      actual: {
        ok: hide.ok ?? null,
        hidden: hide.hidden ?? null,
        visibilityState: hide.visibilityState ?? null,
        method: hide.method ?? null,
        panelPageObserved: hide.panelPageObserved ?? null,
      },
      budget: {
        ok: true,
        hidden: true,
        visibilityState: 'hidden',
        method: 'native_pet_panel_hide_show',
        panelPageObserved: true,
      },
    })
  }
  if (
    show.ok !== true
    || show.hidden !== false
    || show.visibilityState !== 'visible'
    || show.method !== 'native_pet_panel_hide_show'
  ) {
    errors.push({
      metric: 'visibilityShow',
      actual: {
        ok: show.ok ?? null,
        hidden: show.hidden ?? null,
        visibilityState: show.visibilityState ?? null,
        method: show.method ?? null,
      },
      budget: { ok: true, hidden: false, visibilityState: 'visible', method: 'native_pet_panel_hide_show' },
    })
  }

  const hiddenStartedAtMs = Number.isFinite(hidden.startedAtMs) ? hidden.startedAtMs : null
  const hiddenEndedAtMs = Number.isFinite(hidden.endedAtMs) ? hidden.endedAtMs : null
  const declaredHiddenDurationMs = Number.isFinite(hidden.durationMs) ? hidden.durationMs : null
  const hiddenDurationMs = hiddenStartedAtMs != null && hiddenEndedAtMs != null
    ? hiddenEndedAtMs - hiddenStartedAtMs
    : null
  if (hiddenStartedAtMs == null || hiddenEndedAtMs == null || hiddenDurationMs < 0) {
    errors.push({
      metric: 'visibilityHiddenTiming',
      actual: {
        startedAtMs: hiddenStartedAtMs,
        endedAtMs: hiddenEndedAtMs,
      },
      budget: 'finite ordered startedAtMs and endedAtMs',
    })
  }
  if (declaredHiddenDurationMs == null || declaredHiddenDurationMs !== hiddenDurationMs) {
    errors.push({
      metric: 'visibilityHiddenDurationConsistency',
      actual: {
        declaredDurationMs: declaredHiddenDurationMs,
        timestampDurationMs: hiddenDurationMs,
      },
      budget: 'durationMs === endedAtMs - startedAtMs',
    })
  }
  if (hiddenDurationMs == null || hiddenDurationMs < thresholds.minHiddenDurationMs) {
    errors.push({
      metric: 'visibilityHiddenDurationMs',
      actual: hiddenDurationMs,
      budget: thresholds.minHiddenDurationMs,
    })
  }

  if (hiddenStart?.visibilityState !== 'hidden' || hiddenStart?.hidden !== true) {
    errors.push({
      metric: 'visibilityHiddenStartState',
      actual: { visibilityState: hiddenStart?.visibilityState ?? null, hidden: hiddenStart?.hidden ?? null },
      budget: { visibilityState: 'hidden', hidden: true },
    })
  }
  if (hiddenEnd?.visibilityState !== 'hidden' || hiddenEnd?.hidden !== true) {
    errors.push({
      metric: 'visibilityHiddenEndState',
      actual: { visibilityState: hiddenEnd?.visibilityState ?? null, hidden: hiddenEnd?.hidden ?? null },
      budget: { visibilityState: 'hidden', hidden: true },
    })
  }
  if (hiddenStart?.probeInstalled !== true || hiddenEnd?.probeInstalled !== true) {
    errors.push({
      metric: 'visibilityHiddenProbeContinuity',
      actual: {
        start: hiddenStart?.probeInstalled ?? null,
        end: hiddenEnd?.probeInstalled ?? null,
      },
      budget: { start: true, end: true },
    })
  }
  if (hidden.integrityFailure) {
    errors.push({
      metric: 'visibilityHiddenIntegrity',
      actual: hidden.integrityFailure.reason ?? 'failed',
      budget: 'no early visibility recovery or probe loss',
    })
  }

  const hiddenModelUpdateDelta = counterDelta(hiddenStart, hiddenEnd, 'modelUpdateCount')
  const hiddenTickerDelta = counterDelta(hiddenStart, hiddenEnd, 'tickerTickCount')
  if (hiddenModelUpdateDelta !== 0) {
    errors.push({ metric: 'hiddenModelUpdateDelta', actual: hiddenModelUpdateDelta, budget: 0 })
  }
  if (hiddenTickerDelta !== 0) {
    errors.push({ metric: 'hiddenTickerDelta', actual: hiddenTickerDelta, budget: 0 })
  }

  const resumedModelUpdateDelta = counterDelta(resumedStart, resumedEnd, 'modelUpdateCount')
  const resumedTickerDelta = counterDelta(resumedStart, resumedEnd, 'tickerTickCount')
  if (resumedStart?.visibilityState !== 'visible' || resumedStart?.hidden !== false) {
    errors.push({
      metric: 'visibilityResumedStartState',
      actual: { visibilityState: resumedStart?.visibilityState ?? null, hidden: resumedStart?.hidden ?? null },
      budget: { visibilityState: 'visible', hidden: false },
    })
  }
  if (resumedEnd?.visibilityState !== 'visible' || resumedEnd?.hidden !== false) {
    errors.push({
      metric: 'visibilityResumedState',
      actual: { visibilityState: resumedEnd?.visibilityState ?? null, hidden: resumedEnd?.hidden ?? null },
      budget: { visibilityState: 'visible', hidden: false },
    })
  }
  if (resumedStart?.probeInstalled !== true || resumedEnd?.probeInstalled !== true) {
    errors.push({
      metric: 'visibilityResumedProbeContinuity',
      actual: {
        start: resumedStart?.probeInstalled ?? null,
        end: resumedEnd?.probeInstalled ?? null,
      },
      budget: { start: true, end: true },
    })
  }
  if (!(resumedModelUpdateDelta > 0)) {
    errors.push({ metric: 'resumedModelUpdateDelta', actual: resumedModelUpdateDelta, budget: '>0' })
  }
  if (!(resumedTickerDelta > 0)) {
    errors.push({ metric: 'resumedTickerDelta', actual: resumedTickerDelta, budget: '>0' })
  }

  return {
    cycle: cycle?.cycle ?? null,
    ok: errors.length === 0,
    hiddenDurationMs,
    hidden: {
      start: hiddenStart,
      end: hiddenEnd,
      modelUpdateDelta: hiddenModelUpdateDelta,
      tickerDelta: hiddenTickerDelta,
    },
    resumed: {
      start: resumedStart,
      end: resumedEnd,
      modelUpdateDelta: resumedModelUpdateDelta,
      tickerDelta: resumedTickerDelta,
    },
    errors,
  }
}

export function evaluateVisibilityPauseSeries(
  cycles,
  thresholds = DEFAULT_VISIBILITY_THRESHOLDS,
  requiredCycles = 4,
) {
  if (!Array.isArray(cycles) || cycles.length === 0) {
    return {
      ok: false,
      skipped: true,
      reason: 'no_visibility_cycles',
      cycleCount: 0,
      evaluations: [],
      errors: [{ metric: 'visibilityCycles', actual: 0, budget: requiredCycles }],
    }
  }

  const evaluations = cycles.map((cycle) => evaluateVisibilityPauseCycle(cycle, thresholds))
  const errors = evaluations.flatMap((evaluation) => evaluation.errors.map((error) => ({
    ...error,
    cycle: evaluation.cycle,
  })))
  const actualCycleSequence = cycles.map((cycle) => cycle?.cycle ?? null)
  const expectedCycleSequence = Array.from({ length: requiredCycles }, (_, index) => index + 1)
  if (cycles.length !== requiredCycles) {
    errors.push({ metric: 'visibilityCycleCount', actual: cycles.length, budget: requiredCycles })
  }
  if (
    actualCycleSequence.length !== expectedCycleSequence.length
    || actualCycleSequence.some((cycle, index) => cycle !== expectedCycleSequence[index])
  ) {
    errors.push({
      metric: 'visibilityCycleSequence',
      actual: actualCycleSequence,
      budget: expectedCycleSequence,
    })
  }

  return {
    ok: errors.length === 0,
    skipped: false,
    cycleCount: cycles.length,
    evaluations,
    errors,
  }
}

/**
 * Lifecycle completeness + overall verdict.
 * Process-only evidence MUST NOT produce summary.ok === true.
 * Skipped CDP / skipped remount / missing Live2D readiness => incomplete (ok false).
 */
export function buildHarnessSummary({
  cdpConnected = false,
  skipCdp = false,
  coldStart = null,
  remountEvaluation = null,
  remountSamples = [],
  requiredRemountCycles = 5,
  plateau = null,
  processGrowth = null,
  visibilityEvaluation = null,
  visibilityLog = [],
  requiredVisibilityCycles = 4,
  thresholdErrors = [],
  live2dReadyObserved = false,
} = {}) {
  const lifecycleErrors = []
  const processErrors = [...(thresholdErrors || [])]

  if (skipCdp) {
    lifecycleErrors.push({
      metric: 'cdpRequired',
      actual: 'skipped',
      budget: 'connected',
      reason: 'PACKAGED_RUNTIME_SKIP_CDP=1 forces process-metrics-only incomplete run',
    })
  } else if (!cdpConnected) {
    lifecycleErrors.push({
      metric: 'cdpRequired',
      actual: 'unavailable',
      budget: 'connected',
      reason: 'CDP was not established; remount/Live2D lifecycle evidence missing',
    })
  }

  if (cdpConnected && !live2dReadyObserved && !(coldStart?.ok)) {
    lifecycleErrors.push({
      metric: 'live2dReady',
      actual: 0,
      budget: 1,
      reason: 'renderer/Live2D readiness not observed',
    })
  }

  if (!cdpConnected || skipCdp) {
    lifecycleErrors.push({
      metric: 'remountLifecycle',
      actual: 'skipped',
      budget: `${requiredRemountCycles}_cycles`,
      reason: 'remount cycles require CDP + Live2D page',
    })
  } else if (remountEvaluation?.skipped || remountSamples.length === 0) {
    lifecycleErrors.push({
      metric: 'remountLifecycle',
      actual: 'skipped',
      budget: `${requiredRemountCycles}_cycles`,
      reason: remountEvaluation?.reason || 'no_remount_samples',
    })
  } else if (remountSamples.length < requiredRemountCycles) {
    lifecycleErrors.push({
      metric: 'remountLifecycle',
      actual: remountSamples.length,
      budget: requiredRemountCycles,
      reason: 'incomplete remount series',
    })
  }

  if (!cdpConnected || skipCdp) {
    lifecycleErrors.push({
      metric: 'visibilityPauseLifecycle',
      actual: 'skipped',
      budget: `${requiredVisibilityCycles}_cycles`,
      reason: 'visibility pause/resume requires CDP + Live2D page',
    })
  } else if (!visibilityEvaluation || visibilityEvaluation.skipped || visibilityLog.length === 0) {
    lifecycleErrors.push({
      metric: 'visibilityPauseLifecycle',
      actual: visibilityEvaluation?.reason || 'skipped',
      budget: `${requiredVisibilityCycles}_cycles`,
      reason: 'visibility pause/resume evidence missing',
    })
  } else if (visibilityLog.length < requiredVisibilityCycles) {
    lifecycleErrors.push({
      metric: 'visibilityPauseLifecycle',
      actual: visibilityLog.length,
      budget: requiredVisibilityCycles,
      reason: 'incomplete visibility pause/resume series',
    })
  }

  const nonNativeVisibilityCycles = visibilityLog.filter((cycle) => (
    cycle?.hide?.method !== 'native_pet_panel_hide_show'
    || cycle?.show?.method !== 'native_pet_panel_hide_show'
  ))
  if (nonNativeVisibilityCycles.length > 0) {
    lifecycleErrors.push({
      metric: 'visibilityMethod',
      actual: nonNativeVisibilityCycles.map((cycle) => ({
        cycle: cycle?.cycle ?? null,
        hide: cycle?.hide?.method ?? null,
        show: cycle?.show?.method ?? null,
      })),
      budget: 'native_pet_panel_hide_show for every passing cycle',
      reason: 'emulated visibility is fixture-only and cannot produce release success',
    })
  }

  if (plateau && plateau.ok === false) {
    processErrors.push(...(plateau.errors || [{ metric: 'rssPlateau', actual: 0, budget: 1 }]))
  }
  if (processGrowth && processGrowth.ok === false) {
    processErrors.push(...(processGrowth.errors || [{ metric: 'processGrowth', actual: 0, budget: 1 }]))
  }
  if (remountEvaluation && remountEvaluation.ok === false && !remountEvaluation.skipped) {
    processErrors.push(...(remountEvaluation.errors || []))
  }
  if (visibilityEvaluation && visibilityEvaluation.ok === false && !visibilityEvaluation.skipped) {
    processErrors.push(...(visibilityEvaluation.errors || []))
  }

  // Dedupe process errors already represented as lifecycle when CDP missing.
  const allErrors = []
  const seen = new Set()
  for (const error of [...lifecycleErrors, ...processErrors]) {
    const key = `${error.metric}|${error.cycle ?? ''}|${error.actual}|${error.budget}`
    if (seen.has(key)) continue
    seen.add(key)
    allErrors.push(error)
  }

  // Lifecycle completeness = evidence was collected (CDP + Live2D + remount series).
  // Threshold failures (RSS growth, canvas count, etc.) are metric failures, not missing evidence.
  const lifecycleComplete = lifecycleErrors.length === 0
    && cdpConnected
    && !skipCdp
    && Boolean(live2dReadyObserved || coldStart?.ok)
    && remountSamples.length >= requiredRemountCycles
    && Boolean(remountEvaluation)
    && remountEvaluation.skipped !== true
    && visibilityLog.length >= requiredVisibilityCycles
    && Boolean(visibilityEvaluation)
    && visibilityEvaluation.skipped !== true

  const processMetricsOk = (plateau?.ok !== false)
    && (processGrowth?.ok !== false)
    && (remountEvaluation?.ok !== false || remountEvaluation?.skipped === true)

  const ok = lifecycleComplete && allErrors.length === 0
  let status = 'ok'
  if (!ok) {
    status = lifecycleComplete ? 'failed' : 'incomplete'
  }

  return {
    ok,
    status,
    errors: allErrors.length,
    errorDetails: allErrors,
    cdpConnected,
    lifecycleComplete,
    processMetricsOnly: !cdpConnected || skipCdp,
    processEvidence: {
      ok: processMetricsOk,
      note: 'Process RSS/CPU evidence is separate from lifecycle completeness.',
    },
    lifecycleEvidence: {
      ok: lifecycleComplete,
      required: [
        'cdp',
        'live2d_ready',
        `remount_x${requiredRemountCycles}`,
        `visibility_pause_resume_x${requiredVisibilityCycles}`,
      ],
      note: 'Lifecycle evidence requires CDP + Live2D readiness + remount and verified pet/panel hide-pause-resume cycles.',
    },
  }
}
