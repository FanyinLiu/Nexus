#!/usr/bin/env node

/**
 * Packaged sustained runtime harness (macOS-first, cross-platform best-effort).
 *
 * Measures the real packaged Electron process tree over time:
 * - cold-start until Live2D first-frame / model-ready (when CDP can reach a page)
 * - sustained CPU% and RSS samples (main / renderer / GPU helpers when classifiable)
 * - visibility pause/resume cycles through the real pet -> panel -> pet product path
 * - Live2D remount cycles via page reload + canvas/phase settle checks
 * - relative plateau / growth thresholds (not absolute machine-bound CPU promises)
 *
 * Explicit non-claims:
 * - Does not measure GPU VRAM / Metal private memory (not reliably exposed).
 * - Does not prove pixel presentation, only process metrics + DOM Live2D markers.
 *
 * Output: output/packaged-sustained-runtime/report.json (+ samples.jsonl)
 *
 * Env:
 *   PACKAGED_SMOKE_RELEASE_DIR   single release dir (disables multi-root auto-select)
 *   PACKAGED_RUNTIME_CANDIDATE_DIRS  comma-separated roots (default: release-smoke,release)
 *   PACKAGED_RUNTIME_PORT        remote debugging port (default: random free)
 *   PACKAGED_RUNTIME_WARMUP_MS   discard window (default: 8000)
 *   PACKAGED_RUNTIME_SUSTAINED_MS sustained sample window (default: 30000)
 *   PACKAGED_RUNTIME_INTERVAL_MS sample interval (default: 1000)
 *   PACKAGED_RUNTIME_VIS_CYCLES  visibility cycles (default: 4)
 *   PACKAGED_RUNTIME_VIS_HIDDEN_MS hidden pause window (default: 5000)
 *   PACKAGED_RUNTIME_VISIBILITY_MODE native|emulated (default: native; explicit, never fallback)
 *   PACKAGED_RUNTIME_REMOUNT_CYCLES remount cycles (default: 5)
 *   PACKAGED_RUNTIME_SKIP_CDP=1  process-metrics only (forces incomplete; never summary.ok)
 *
 * Implementation modules (source-size budget):
 *   scripts/lib/packaged-sustained-runtime-selection.mjs
 *   scripts/lib/packaged-sustained-runtime-process.mjs
 *   scripts/lib/packaged-sustained-runtime-analysis.mjs
 *   scripts/lib/packaged-sustained-runtime-cdp.mjs
 */

import {
  appendFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

import {
  DEFAULT_THRESHOLDS,
  median,
  maxOf,
  evaluateRssPlateau,
  evaluateRemountSeries,
  evaluateProcessCountGrowth,
  evaluateVisibilityPauseSeries,
  DEFAULT_VISIBILITY_THRESHOLDS,
  buildHarnessSummary,
} from './lib/packaged-sustained-runtime-analysis.mjs'
import {
  DEFAULT_CANDIDATE_RELEASE_DIRS,
  discoverPackagedCandidates,
  selectPackagedExecutable,
  findPackagedExecutable,
} from './lib/packaged-sustained-runtime-selection.mjs'
import {
  terminateTree,
  buildChildExitReport,
  sampleProcessTree,
} from './lib/packaged-sustained-runtime-process.mjs'
import {
  wait,
  allocatePort,
  seedPages,
  installLive2DPauseProbe,
  snapshotLive2D,
  pickLive2DPage,
  waitForLive2DReady,
  setWindowHidden,
  waitForCdpHttp,
} from './lib/packaged-sustained-runtime-cdp.mjs'
import { verifyPackagedRuntimeIdentity } from './lib/packaged-sustained-runtime-integrity.mjs'

// Re-export public surface used by unit tests and external importers.
export {
  DEFAULT_THRESHOLDS,
  DEFAULT_CANDIDATE_RELEASE_DIRS,
  median,
  maxOf,
  evaluateRssPlateau,
  evaluateRemountSeries,
  evaluateProcessCountGrowth,
  evaluateVisibilityPauseSeries,
  DEFAULT_VISIBILITY_THRESHOLDS,
  buildHarnessSummary,
  discoverPackagedCandidates,
  selectPackagedExecutable,
  findPackagedExecutable,
  terminateTree,
  buildChildExitReport,
  sampleProcessTree,
  verifyPackagedRuntimeIdentity,
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT_DIR = path.join(ROOT, 'output', 'packaged-sustained-runtime')
export const PACKAGED_RUNTIME_REPORT_SCHEMA_VERSION = 4
export const PACKAGED_RUNTIME_CDP_CONNECT_OPTIONS = Object.freeze({
  timeout: 5_000,
  noDefaults: true,
})

export function resolveVisibilityHiddenMs(configuredMs) {
  const configured = Number.isFinite(configuredMs) && configuredMs >= 0
    ? configuredMs
    : DEFAULT_VISIBILITY_THRESHOLDS.minHiddenDurationMs
  return Math.max(DEFAULT_VISIBILITY_THRESHOLDS.minHiddenDurationMs, configured)
}

const configuredVisibilityHiddenMs = envInt(
  'PACKAGED_RUNTIME_VIS_HIDDEN_MS',
  DEFAULT_VISIBILITY_THRESHOLDS.minHiddenDurationMs,
)
const CONFIG = {
  warmupMs: envInt('PACKAGED_RUNTIME_WARMUP_MS', 8_000),
  sustainedMs: envInt('PACKAGED_RUNTIME_SUSTAINED_MS', 30_000),
  intervalMs: envInt('PACKAGED_RUNTIME_INTERVAL_MS', 1_000),
  visibilityCycles: envInt('PACKAGED_RUNTIME_VIS_CYCLES', 4),
  visibilityConfiguredHiddenMs: configuredVisibilityHiddenMs,
  visibilityHiddenMs: resolveVisibilityHiddenMs(configuredVisibilityHiddenMs),
  visibilityResumeMs: envInt('PACKAGED_RUNTIME_VIS_RESUME_MS', 1_000),
  visibilityMode: process.env.PACKAGED_RUNTIME_VISIBILITY_MODE || 'native',
  cdpNoDefaults: PACKAGED_RUNTIME_CDP_CONNECT_OPTIONS.noDefaults,
  remountCycles: envInt('PACKAGED_RUNTIME_REMOUNT_CYCLES', 5),
  settleTimeoutMs: envInt('PACKAGED_RUNTIME_SETTLE_TIMEOUT_MS', 45_000),
  cdpConnectTimeoutMs: envInt('PACKAGED_RUNTIME_CDP_CONNECT_TIMEOUT_MS', 30_000),
  skipCdp: process.env.PACKAGED_RUNTIME_SKIP_CDP === '1',
}

function envInt(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function appendSample(samplesPath, sample) {
  appendFileSync(samplesPath, `${JSON.stringify(sample)}\n`)
}

function readSourcePackageVersion() {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    return typeof packageJson.version === 'string' ? packageJson.version : null
  } catch {
    return null
  }
}

export function writePreflightFailureReport({
  outputDir = OUTPUT_DIR,
  samplesPath = path.join(outputDir, 'samples.jsonl'),
  selectionResult = null,
  buildIdentity = null,
  reason = 'packaged runtime preflight failed',
} = {}) {
  mkdirSync(outputDir, { recursive: true })
  const reportPath = path.join(outputDir, 'report.json')

  // Invalidate any previous green report before writing the new failure.
  rmSync(reportPath, { force: true })

  const errorDetails = buildIdentity?.errors?.length
    ? buildIdentity.errors
    : [{ metric: 'packageSelection', actual: reason, budget: 'valid packaged executable' }]
  const summary = {
    ok: false,
    status: 'failed',
    errors: errorDetails.length,
    errorDetails,
    cdpConnected: false,
    lifecycleComplete: false,
    processMetricsOnly: false,
    processEvidence: { ok: false, note: 'Packaged app was not launched because preflight failed closed.' },
    lifecycleEvidence: { ok: false, required: ['source_dist_packaged_fingerprint_match'] },
  }
  const report = {
    schemaVersion: PACKAGED_RUNTIME_REPORT_SCHEMA_VERSION,
    kind: 'packaged-sustained-runtime',
    capturedAt: new Date().toISOString(),
    productVersion: buildIdentity?.productVersion ?? readSourcePackageVersion(),
    executable: selectionResult?.executable ?? null,
    packageSelection: {
      selected: selectionResult?.selection ?? null,
      rejected: selectionResult?.rejected ?? [],
      discoveryMode: selectionResult?.discovery?.mode ?? null,
      discoveryReason: selectionResult?.discovery?.reason ?? null,
      roots: selectionResult?.discovery?.roots ?? [],
      why: selectionResult?.reason ?? reason,
    },
    releaseDir: selectionResult?.selection?.releaseDir ?? null,
    buildIdentity,
    config: CONFIG,
    error: reason,
    errors: errorDetails,
    summary,
    artifacts: { reportPath, samplesPath },
    limitations: ['Packaged app was not launched because preflight failed closed.'],
  }
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  return { reportPath, report }
}

function readMachineEnvironment() {
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpus: os.cpus().map((cpu) => cpu.model),
    cpuCount: os.cpus().length,
    totalMemBytes: os.totalmem(),
    freeMemBytes: os.freemem(),
    osRelease: os.release(),
    osType: os.type(),
    loadAvg: os.loadavg(),
    hostnameRedacted: true,
  }
}

async function runHarness() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const samplesPath = path.join(OUTPUT_DIR, 'samples.jsonl')
  writeFileSync(samplesPath, '')

  const selectionResult = selectPackagedExecutable()
  if (!selectionResult.ok || !selectionResult.executable) {
    const failure = writePreflightFailureReport({
      samplesPath,
      selectionResult,
      reason: selectionResult.reason || 'No packaged executable found',
    })
    process.stdout.write(`PACKAGED SELECTION FAIL CLOSED: ${selectionResult.reason || 'No packaged executable found'}\n`)
    process.stdout.write(`- report: ${failure.reportPath}\n`)
    return 1
  }

  const executable = selectionResult.executable
  const selection = selectionResult.selection

  const buildIdentity = verifyPackagedRuntimeIdentity({
    root: ROOT,
    appPath: selection.appPath,
  })
  if (!buildIdentity.ok) {
    const failure = writePreflightFailureReport({
      samplesPath,
      selectionResult,
      buildIdentity,
      reason: 'Build identity failed before packaged launch.',
    })
    process.stdout.write(`BUILD IDENTITY FAIL CLOSED: ${buildIdentity.errors.map((error) => error.metric).join(', ')}\n`)
    process.stdout.write(`- report: ${failure.reportPath}\n`)
    return 1
  }

  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'nexus-packaged-runtime-'))
  const port = process.env.PACKAGED_RUNTIME_PORT
    ? Number.parseInt(process.env.PACKAGED_RUNTIME_PORT, 10)
    : await allocatePort()

  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${userDataDir}`,
  ]
  if (process.platform === 'linux' && process.env.CI === 'true') {
    args.unshift('--no-sandbox')
  }

  const launchedAt = Date.now()
  const child = spawn(executable, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      // Intentionally NOT SMOKE_TEST — smoke mode exits after first load.
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: false,
  })

  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })

  let naturalExitCode = null
  let naturalSignalCode = null
  let exitedBeforeCleanup = false
  child.on('exit', (code, signal) => {
    if (!exitedBeforeCleanup) {
      naturalExitCode = code
      naturalSignalCode = signal
    }
  })

  let browser = null
  const samples = []
  const visibilityLog = []
  const remountSamples = []
  let coldStart = null
  let cdpConnected = false
  let live2dPage = null
  let live2dReadyObserved = false
  let termination = null
  let finalExitCode = null
  let finalSignalCode = null
  const limitations = [
    'GPU VRAM / Metal private memory is not measured; macOS and Electron do not expose a stable cross-process VRAM counter usable here.',
    'CPU% from ps is scheduler-relative and machine-load-sensitive; gates use RSS plateau and remount growth, not absolute CPU budgets.',
    'Remount cycles use full page reload of a Live2D-bearing renderer (product boot path), not an in-React key flip.',
  ]

  const record = (phase, processSample, extra = {}) => {
    if (!processSample) return
    const row = {
      phase,
      tMs: Date.now() - launchedAt,
      ...processSample,
      ...extra,
    }
    samples.push(row)
    appendSample(samplesPath, row)
  }

  try {
    await wait(1500)
    if (child.exitCode != null) {
      exitedBeforeCleanup = true
      throw new Error(`packaged app exited early code=${child.exitCode} signal=${child.signalCode}`)
    }

    if (!CONFIG.skipCdp) {
      const httpReady = await waitForCdpHttp(port, CONFIG.cdpConnectTimeoutMs)
      if (!httpReady.ok) {
        limitations.push(
          `CDP HTTP /json/version not ready within ${CONFIG.cdpConnectTimeoutMs}ms (${httpReady.error}); process-metrics-only evidence retained.`,
        )
      } else {
        const cdpDeadline = Date.now() + 15_000
        let lastCdpError = null
        while (Date.now() < cdpDeadline) {
          try {
            browser = await chromium.connectOverCDP(
              `http://127.0.0.1:${port}`,
              PACKAGED_RUNTIME_CDP_CONNECT_OPTIONS,
            )
            cdpConnected = true
            break
          } catch (error) {
            lastCdpError = error
            await wait(400)
          }
        }
        if (!cdpConnected) {
          limitations.push(
            `CDP HTTP was up but Playwright connectOverCDP failed (${lastCdpError instanceof Error ? lastCdpError.message : String(lastCdpError)}).`,
          )
        }
      }
    } else {
      limitations.push('PACKAGED_RUNTIME_SKIP_CDP=1: Live2D DOM, visibility, and remount cycles skipped; summary cannot be ok.')
    }

    const getPages = () => {
      if (!browser) return []
      return browser.contexts().flatMap((context) => context.pages())
    }

    if (cdpConnected) {
      const ready = await waitForLive2DReady(getPages, CONFIG.settleTimeoutMs)
      coldStart = {
        ok: ready.ok,
        elapsedMs: ready.elapsedMs,
        snapshots: ready.snapshots,
      }
      live2dReadyObserved = ready.ok
      const pages = getPages()
      live2dPage = pickLive2DPage(pages, ready.snapshots)
      if (!ready.ok) {
        limitations.push('Live2D ready marker not observed within settle timeout; lifecycle incomplete.')
      } else if (live2dPage && !live2dPage.isClosed()) {
        const probe = await installLive2DPauseProbe(live2dPage)
        if (!probe.ok || !probe.installed) {
          limitations.push(`Live2D pause probe unavailable: ${probe.reason || 'unknown reason'}; visibility evidence will fail closed.`)
        }
      }
    }

    const sampleOnce = (phase, extra = {}) => {
      const tree = sampleProcessTree(child.pid)
      record(phase, tree, extra)
      return tree
    }

    const warmupUntil = Date.now() + CONFIG.warmupMs
    while (Date.now() < warmupUntil) {
      sampleOnce('warmup')
      await wait(CONFIG.intervalMs)
    }

    const sustainedUntil = Date.now() + CONFIG.sustainedMs
    while (Date.now() < sustainedUntil) {
      let live2d = null
      if (cdpConnected) {
        try {
          live2d = await snapshotLive2D(getPages())
          if (live2d.some((snap) => snap.ready)) live2dReadyObserved = true
        } catch {
          live2d = null
        }
      }
      sampleOnce('sustained', { live2d })
      await wait(CONFIG.intervalMs)
    }

    if (cdpConnected && live2dPage && !live2dPage.isClosed()) {
      for (let cycle = 1; cycle <= CONFIG.visibilityCycles; cycle += 1) {
        const captureLive2D = async () => {
          const snapshots = await snapshotLive2D(getPages()).catch(() => [])
          return snapshots.find((snapshot) => snapshot.url === live2dPage.url())
            || null
        }

        const hideResult = await setWindowHidden(
          browser,
          live2dPage,
          true,
          { mode: CONFIG.visibilityMode },
        )
        if (!hideResult.ok) {
          visibilityLog.push({
            cycle,
            hide: { ...hideResult, tMs: Date.now() - launchedAt },
            hidden: { durationMs: 0, start: null, end: null },
            show: {
              ok: false,
              hidden: false,
              visibilityState: null,
              reason: 'hide_failed_not_attempted',
            },
            resumed: { start: null, end: null },
          })
          limitations.push('Native/explicit visibility hide failed; visibility evidence stopped and summary will fail closed.')
          break
        }

        const hiddenStart = await captureLive2D()
        const hiddenStartedAtMs = Date.now()
        const hiddenDeadlineMs = hiddenStartedAtMs + CONFIG.visibilityHiddenMs
        let hiddenEnd = hiddenStart
        let hiddenIntegrityFailure = null
        while (Date.now() < hiddenDeadlineMs) {
          await wait(Math.min(100, Math.max(1, hiddenDeadlineMs - Date.now())))
          hiddenEnd = await captureLive2D()
          if (
            hiddenEnd?.visibilityState !== 'hidden'
            || hiddenEnd?.hidden !== true
            || hiddenEnd?.probeInstalled !== true
          ) {
            hiddenIntegrityFailure = {
              reason: hiddenEnd?.probeInstalled === false
                ? 'native_pet_live2d_probe_lost_during_pause'
                : 'native_pet_visibility_recovered_early',
              observedAtMs: Date.now() - launchedAt,
              snapshot: hiddenEnd,
            }
            break
          }
        }
        const hiddenEndedAtMs = Date.now()
        const hiddenDurationMs = hiddenEndedAtMs - hiddenStartedAtMs
        sampleOnce('visibility_hidden', {
          cycle,
          windowToggleOk: hideResult.ok === true,
          windowToggleMethod: hideResult.method ?? null,
          visibility: {
            hidden: hiddenEnd?.hidden === true,
            visibilityState: hiddenEnd?.visibilityState ?? hideResult.visibilityState ?? null,
            durationMs: hiddenDurationMs,
          },
          live2d: hiddenEnd,
        })

        if (hiddenIntegrityFailure) {
          visibilityLog.push({
            cycle,
            hide: { ...hideResult, tMs: Date.now() - launchedAt },
            hidden: {
              startedAtMs: hiddenStartedAtMs,
              endedAtMs: hiddenEndedAtMs,
              durationMs: hiddenDurationMs,
              start: hiddenStart,
              end: hiddenEnd,
              integrityFailure: hiddenIntegrityFailure,
            },
            show: {
              ok: false,
              hidden: false,
              visibilityState: null,
              method: 'native_pet_panel_hide_show',
              reason: 'hidden_pause_failed_show_not_attempted',
            },
            resumed: { start: null, end: null },
          })
          limitations.push('Pet visibility or Live2D probe recovered/lost before the requested hidden window elapsed; visibility evidence stopped and failed closed.')
          break
        }

        const showResult = await setWindowHidden(
          browser,
          live2dPage,
          false,
          { mode: CONFIG.visibilityMode },
        )
        const resumedStart = await captureLive2D()
        await wait(CONFIG.visibilityResumeMs)
        const resumedEnd = await captureLive2D()
        sampleOnce('visibility_visible', {
          cycle,
          windowToggleOk: showResult.ok === true,
          windowToggleMethod: showResult.method ?? null,
          visibility: {
            hidden: resumedEnd?.hidden === true,
            visibilityState: resumedEnd?.visibilityState ?? showResult.visibilityState ?? null,
            resumed: showResult.ok === true,
          },
          live2d: resumedEnd,
        })

        visibilityLog.push({
          cycle,
          hide: { ...hideResult, tMs: Date.now() - launchedAt },
          hidden: {
            startedAtMs: hiddenStartedAtMs,
            endedAtMs: hiddenEndedAtMs,
            durationMs: hiddenDurationMs,
            start: hiddenStart,
            end: hiddenEnd,
          },
          show: { ...showResult, tMs: Date.now() - launchedAt },
          resumed: {
            start: resumedStart,
            end: resumedEnd,
          },
        })

        if (!showResult.ok) {
          limitations.push('Native/explicit visibility show failed; visibility evidence stopped and summary will fail closed.')
          break
        }
      }
    } else if (cdpConnected) {
      limitations.push('No Live2D page available for visibility cycles.')
    }

    if (cdpConnected && live2dPage && !live2dPage.isClosed()) {
      for (let cycle = 1; cycle <= CONFIG.remountCycles; cycle += 1) {
        try {
          await live2dPage.reload({ waitUntil: 'domcontentloaded' })
        } catch (error) {
          remountSamples.push({
            cycle,
            ready: false,
            error: error instanceof Error ? error.message : String(error),
            totalRssKb: null,
            processCount: null,
          })
          continue
        }
        await seedPages(getPages())
        const settleStarted = Date.now()
        let snapshot = null
        while (Date.now() - settleStarted < CONFIG.settleTimeoutMs) {
          const snaps = await snapshotLive2D(getPages())
          snapshot = snaps.find((snap) => snap.url === live2dPage.url()) || snaps[0] || null
          if (snapshot?.ready && !snapshot.hasOnboarding && !snapshot.hasModelSetup) break
          await wait(300)
        }
        await wait(1000)
        const tree = sampleOnce('remount', {
          cycle,
          live2d: snapshot,
        })
        if (snapshot?.ready) live2dReadyObserved = true
        remountSamples.push({
          cycle,
          ready: Boolean(snapshot?.ready),
          phase: snapshot?.phase ?? null,
          canvasCount: snapshot?.canvasCount ?? null,
          shellCount: snapshot?.shellCount ?? null,
          firstFrameMs: snapshot?.firstFrameMs ?? null,
          readyMs: snapshot?.readyMs ?? null,
          totalRssKb: tree?.totalRssKb ?? null,
          processCount: tree?.processCount ?? null,
          visibilityState: snapshot?.visibilityState ?? null,
        })
      }
    }

    const warmupSamples = samples.filter((s) => s.phase === 'warmup')
    const sustainedSamples = samples.filter((s) => s.phase === 'sustained')
    const thresholds = DEFAULT_THRESHOLDS
    const plateau = evaluateRssPlateau(sustainedSamples, thresholds)
    const remount = cdpConnected
      ? evaluateRemountSeries(remountSamples, thresholds, CONFIG.remountCycles)
      : {
          ok: false,
          skipped: true,
          reason: 'cdp_unavailable',
          errors: [{ metric: 'remountSamples', actual: 0, budget: CONFIG.remountCycles }],
        }
    const processGrowth = evaluateProcessCountGrowth(warmupSamples, sustainedSamples, thresholds)
    const visibilityThresholds = {
      ...DEFAULT_VISIBILITY_THRESHOLDS,
      minHiddenDurationMs: CONFIG.visibilityHiddenMs,
    }
    const visibilityEvaluation = cdpConnected
      ? evaluateVisibilityPauseSeries(
        visibilityLog,
        visibilityThresholds,
        CONFIG.visibilityCycles,
      )
      : evaluateVisibilityPauseSeries([], visibilityThresholds, CONFIG.visibilityCycles)

    const sustainedCpu = sustainedSamples.map((s) => s.totalCpuPercent).filter(Number.isFinite)
    const hiddenCpu = samples.filter((s) => s.phase === 'visibility_hidden').map((s) => s.totalCpuPercent)
    const visibleCpu = samples.filter((s) => s.phase === 'visibility_visible').map((s) => s.totalCpuPercent)

    if (cdpConnected && coldStart && !coldStart.ok) {
      limitations.push(`Cold-start Live2D ready not observed (${coldStart.elapsedMs}ms).`)
    }

    // Close CDP before killing the app so disconnect is clean.
    try { await browser?.close() } catch { /* ignore */ }
    browser = null

    exitedBeforeCleanup = true
    termination = terminateTree(child.pid)
    try {
      if (child.exitCode == null) {
        child.kill('SIGKILL')
        if (!termination?.terminatedByHarness) {
          termination = {
            attempted: true,
            terminatedByHarness: true,
            method: 'SIGKILL',
            signalSent: 'SIGKILL',
            note: 'harness sent SIGKILL to child handle',
          }
        }
      }
    } catch { /* ignore */ }

    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      wait(2000),
    ])
    finalExitCode = child.exitCode
    finalSignalCode = child.signalCode

    const childExit = buildChildExitReport({
      exitCode: finalExitCode ?? naturalExitCode,
      signalCode: finalSignalCode ?? naturalSignalCode,
      termination,
      waitedForExit: true,
    })

    const summary = buildHarnessSummary({
      cdpConnected,
      skipCdp: CONFIG.skipCdp,
      coldStart,
      remountEvaluation: remount,
      remountSamples,
      requiredRemountCycles: CONFIG.remountCycles,
      plateau,
      processGrowth,
      visibilityEvaluation,
      visibilityLog,
      requiredVisibilityCycles: CONFIG.visibilityCycles,
      live2dReadyObserved,
    })

    const report = {
      schemaVersion: PACKAGED_RUNTIME_REPORT_SCHEMA_VERSION,
      kind: 'packaged-sustained-runtime',
      capturedAt: new Date().toISOString(),
      productVersion: buildIdentity.productVersion,
      buildIdentity,
      executable,
      packageSelection: {
        selected: selection,
        rejected: selectionResult.rejected,
        discoveryMode: selectionResult.discovery.mode,
        discoveryReason: selectionResult.discovery.reason,
        roots: selectionResult.discovery.roots,
        why: selectionResult.reason,
      },
      releaseDir: selection.releaseDir,
      remoteDebuggingPort: port,
      config: CONFIG,
      thresholds,
      environment: readMachineEnvironment(),
      cdpConnected,
      coldStart,
      visibilityLog,
      remountSamples,
      measurements: {
        sampleCount: samples.length,
        warmupSampleCount: warmupSamples.length,
        sustainedSampleCount: sustainedSamples.length,
        sustained: {
          medianTotalCpuPercent: median(sustainedCpu),
          peakTotalCpuPercent: maxOf(sustainedCpu),
          medianTotalRssKb: median(sustainedSamples.map((s) => s.totalRssKb)),
          peakTotalRssKb: maxOf(sustainedSamples.map((s) => s.totalRssKb)),
        },
        visibilityCpu: {
          hiddenMedianTotalCpuPercent: median(hiddenCpu),
          visibleMedianTotalCpuPercent: median(visibleCpu),
          note: 'CPU medians are observational; not gated absolutely.',
        },
        plateau,
        remount,
        processGrowth,
        visibilityPause: visibilityEvaluation,
      },
      errors: summary.errorDetails,
      limitations,
      artifacts: {
        reportPath: path.join(OUTPUT_DIR, 'report.json'),
        samplesPath,
      },
      privacy: {
        userDataDirTemporary: true,
        hostnameOmitted: true,
        readsUserStorage: false,
        seededIsolatedOnboardingOnly: true,
      },
      summary,
      childExit,
      logTail: {
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
      },
    }

    const reportPath = path.join(OUTPUT_DIR, 'report.json')
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)

    const lines = [
      'Packaged sustained runtime',
      `- package: ${selection.appName} (${selection.releaseDir})`,
      `- why: ${selection.why}`,
      `- executable: ${executable}`,
      `- cdp: ${cdpConnected}`,
      `- samples: ${samples.length} (warmup ${warmupSamples.length}, sustained ${sustainedSamples.length})`,
      `- sustained median RSS: ${report.measurements.sustained.medianTotalRssKb} KB`,
      `- sustained median CPU%: ${report.measurements.sustained.medianTotalCpuPercent}`,
      `- plateau ratio: ${plateau.plateauRatio} (budget ${thresholds.sustainedRssPlateauRatio})`,
      `- remount growth: ${remount.growthRatio ?? 'n/a'} (budget ${thresholds.remountRssGrowthRatio})`,
      `- remount cycles: ${remountSamples.length}/${CONFIG.remountCycles}`,
      `- visibility pause (pet -> panel -> pet): ok=${visibilityEvaluation.ok} cycles=${visibilityLog.length}/${CONFIG.visibilityCycles} hiddenMs>=${CONFIG.visibilityHiddenMs}`,
      `- coldStart ms: ${coldStart?.elapsedMs ?? 'n/a'} ok=${coldStart?.ok ?? 'n/a'}`,
      `- summary: ok=${summary.ok} status=${summary.status} lifecycleComplete=${summary.lifecycleComplete}`,
      `- childExit: ${childExit.disposition} terminatedByHarness=${childExit.terminatedByHarness}`,
      `- errors: ${summary.errors}`,
      `- report: ${reportPath}`,
    ]
    process.stdout.write(`${lines.join('\n')}\n`)

    if (!report.summary.ok) {
      process.stdout.write(
        `INCOMPLETE/FAIL: ${summary.errorDetails.map((e) => `${e.metric}=${e.actual}/${e.budget}`).join(', ')}\n`,
      )
      return 1
    }
    return 0
  } catch (error) {
    // Ensure cleanup path still writes a failure report when possible.
    try { await browser?.close() } catch { /* ignore */ }
    if (!termination) {
      termination = terminateTree(child.pid)
      try {
        if (child.exitCode == null) child.kill('SIGKILL')
      } catch { /* ignore */ }
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        wait(2000),
      ])
    }
    finalExitCode = child.exitCode
    finalSignalCode = child.signalCode
    const childExit = buildChildExitReport({
      exitCode: finalExitCode ?? naturalExitCode,
      signalCode: finalSignalCode ?? naturalSignalCode,
      termination,
      waitedForExit: true,
    })
    const visibilityEvaluation = evaluateVisibilityPauseSeries(
      visibilityLog,
      { ...DEFAULT_VISIBILITY_THRESHOLDS, minHiddenDurationMs: CONFIG.visibilityHiddenMs },
      CONFIG.visibilityCycles,
    )
    const summary = buildHarnessSummary({
      cdpConnected,
      skipCdp: CONFIG.skipCdp,
      coldStart,
      remountEvaluation: {
        ok: false,
        skipped: true,
        reason: 'harness_error',
        errors: [{ metric: 'harnessError', actual: 1, budget: 0 }],
      },
      remountSamples,
      requiredRemountCycles: CONFIG.remountCycles,
      visibilityEvaluation,
      visibilityLog,
      requiredVisibilityCycles: CONFIG.visibilityCycles,
      live2dReadyObserved,
    })
    const failReport = {
      schemaVersion: PACKAGED_RUNTIME_REPORT_SCHEMA_VERSION,
      kind: 'packaged-sustained-runtime',
      capturedAt: new Date().toISOString(),
      productVersion: buildIdentity.productVersion,
      buildIdentity,
      executable,
      config: CONFIG,
      packageSelection: {
        selected: selection,
        rejected: selectionResult.rejected,
        why: selectionResult.reason,
      },
      error: error instanceof Error ? error.message : String(error),
      cdpConnected,
      coldStart,
      visibilityLog,
      remountSamples,
      measurements: { visibilityPause: visibilityEvaluation },
      samplesCollected: samples.length,
      summary: {
        ...summary,
        ok: false,
        status: 'failed',
      },
      childExit,
      limitations,
      logTail: {
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
      },
    }
    try {
      const reportPath = path.join(OUTPUT_DIR, 'report.json')
      rmSync(reportPath, { force: true })
      writeFileSync(reportPath, `${JSON.stringify(failReport, null, 2)}\n`)
    } catch { /* ignore */ }
    throw error
  } finally {
    try { await browser?.close() } catch { /* ignore */ }
    if (!termination && child.pid) {
      termination = terminateTree(child.pid)
      try {
        if (child.exitCode == null) child.kill('SIGKILL')
      } catch { /* ignore */ }
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath && path.resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  runHarness()
    .then((code) => {
      process.exit(code ?? 0)
    })
    .catch((error) => {
      console.error(`[packaged-sustained-runtime] ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    })
}
