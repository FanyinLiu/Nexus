import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

import {
  awaitWithTimeout,
  createLive2DSmokeCleanupController,
  createLive2DSmokeReport,
  createLive2DSmokeServer,
  createLive2DSmokeSignalController,
} from '../scripts/live2d-three-model-smoke.mjs'
import {
  LIVE2D_SMOKE_MODEL_IDS,
  LIVE2D_SMOKE_SWITCH_SEQUENCE,
  evaluateBrowserFailureGate,
  evaluateLive2DSnapshot,
  evaluateModelHashTransitions,
  evaluateScreenshotEvidence,
  evaluateScreenshotEdgeBackground,
  live2dScreenshotEdgePoints,
  parseCssBackgroundColor,
  parseRgbChannels,
} from '../scripts/lib/live2d-three-model-smoke.mjs'
import {
  LIVE2D_READY_PHASE,
  LIVE2D_SNAPSHOT_SCRIPT,
  isLive2DFirstFrameReady,
} from '../scripts/lib/packaged-sustained-runtime-cdp.mjs'

const READY_SNAPSHOT = {
  phase: 'first-frame',
  debugPhase: 'first-frame',
  modelId: 'mao',
  shellCount: 1,
  canvasCount: 1,
  error: '0',
  fallbackCount: 0,
  appErrorFallbackCount: 0,
  hasDebugApp: true,
  hasDebugModel: true,
  canvasWidth: 640,
  canvasHeight: 520,
  readyMs: '1250.5',
  firstFrameMs: '1300.5',
}

test('three-model catalog and same-page sequence are exact', () => {
  assert.deepEqual(LIVE2D_SMOKE_MODEL_IDS, ['mao', 'haru', 'hiyori'])
  assert.deepEqual(LIVE2D_SMOKE_SWITCH_SEQUENCE, ['mao', 'haru', 'hiyori', 'mao'])
})

test('Live2D snapshot gate requires first-frame, one owned canvas, and ordered timing', () => {
  assert.equal(evaluateLive2DSnapshot(READY_SNAPSHOT, 'mao').ok, true)

  const modelReadyOnly = evaluateLive2DSnapshot({
    ...READY_SNAPSHOT,
    phase: 'model-ready',
    debugPhase: 'model-ready',
  }, 'mao')
  assert.equal(modelReadyOnly.ok, false)
  assert.ok(modelReadyOnly.errors.some((error) => error.startsWith('phase=')))

  const duplicateCanvas = evaluateLive2DSnapshot({ ...READY_SNAPSHOT, canvasCount: 2 }, 'mao')
  assert.equal(duplicateCanvas.ok, false)
  assert.ok(duplicateCanvas.errors.includes('canvasCount=2'))

  const invertedTiming = evaluateLive2DSnapshot({
    ...READY_SNAPSHOT,
    readyMs: '2000',
    firstFrameMs: '1500',
  }, 'mao')
  assert.equal(invertedTiming.ok, false)
  assert.ok(invertedTiming.errors.includes('readyMs>1500'))
})

test('screenshot and browser failure gates reject weak or noisy evidence', () => {
  const validEvidence = {
    byteLength: 20_000,
    width: 1100,
    height: 760,
    live2dWidth: 800,
    live2dHeight: 500,
    colorBucketCount: 64,
    sha256: 'a'.repeat(64),
    live2dSha256: 'b'.repeat(64),
  }
  assert.equal(evaluateScreenshotEvidence(validEvidence).ok, true)
  assert.equal(evaluateScreenshotEvidence({ ...validEvidence, colorBucketCount: 1 }).ok, false)

  assert.equal(evaluateBrowserFailureGate({
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
  }).ok, true)
  assert.equal(evaluateBrowserFailureGate({
    consoleErrors: [{ text: 'boom' }],
    pageErrors: [],
    requestFailures: [],
  }).ok, false)
})

test('screenshot edge gate matches computed background and rejects black compositor holes', () => {
  assert.deepEqual(parseRgbChannels('rgb(247, 243, 238)'), [247, 243, 238])
  assert.deepEqual(parseRgbChannels('rgba(247, 243, 238, 0.8)'), [247, 243, 238])
  assert.equal(parseRgbChannels('transparent'), null)
  assert.deepEqual(live2dScreenshotEdgePoints(1100, 760), [
    [2, 2], [550, 2], [1097, 2], [2, 380], [1097, 380], [2, 757], [550, 757], [1097, 757],
  ])

  const expected = [247, 243, 238]
  const matchingSamples = live2dScreenshotEdgePoints(1100, 760).map(([x, y]) => ({
    x,
    y,
    rgb: [246, 244, 237],
  }))
  assert.equal(evaluateScreenshotEdgeBackground(matchingSamples, expected).ok, true)

  const blackHoleSamples = matchingSamples.map((sample, index) => (
    index === 2 ? { ...sample, rgb: [0, 0, 0] } : sample
  ))
  const failed = evaluateScreenshotEdgeBackground(blackHoleSamples, expected)
  assert.equal(failed.ok, false)
  assert.equal(failed.mismatches.length, 1)
})

test('screenshot edge gate evaluates transparent and opaque RGBA evidence', () => {
  const points = live2dScreenshotEdgePoints(1100, 760)
  const samplesFor = (rgba: number[]) => points.map(([x, y]) => ({
    x,
    y,
    rgb: rgba.slice(0, 3),
    alpha: rgba[3],
    rgba,
  }))

  assert.deepEqual(parseCssBackgroundColor('transparent'), {
    cssColor: 'transparent',
    mode: 'transparent',
    rgba: [0, 0, 0, 0],
    alpha: 0,
  })
  assert.deepEqual(parseCssBackgroundColor('rgba(247, 243, 238, 0)'), {
    cssColor: 'rgba(247, 243, 238, 0)',
    mode: 'transparent',
    rgba: [247, 243, 238, 0],
    alpha: 0,
  })
  assert.equal(parseCssBackgroundColor('rgba(247, 243, 238, 0.8)').alpha, 204)
  assert.deepEqual(parseCssBackgroundColor('rgb(247, 243, 238)').rgba, [247, 243, 238, 255])

  const transparentExpected = parseCssBackgroundColor('rgba(247, 243, 238, 0)')
  assert.equal(
    evaluateScreenshotEdgeBackground(samplesFor([0, 0, 0, 0]), transparentExpected).ok,
    true,
  )
  const opaqueBlackHole = evaluateScreenshotEdgeBackground(
    samplesFor([0, 0, 0, 255]),
    transparentExpected,
  )
  assert.equal(opaqueBlackHole.ok, false)
  assert.ok(opaqueBlackHole.mismatches.every((sample) => sample.reason === 'transparent_alpha=255'))

  const opaqueExpected = parseCssBackgroundColor('rgb(247, 243, 238)')
  assert.equal(
    evaluateScreenshotEdgeBackground(samplesFor([246, 244, 237, 255]), opaqueExpected).ok,
    true,
  )
  const wrongRgb = evaluateScreenshotEdgeBackground(samplesFor([0, 0, 0, 255]), opaqueExpected)
  assert.equal(wrongRgb.ok, false)
  assert.ok(wrongRgb.mismatches.every((sample) => sample.reason === 'rgb_mismatch'))
  const transparentOpaque = evaluateScreenshotEdgeBackground(samplesFor([247, 243, 238, 0]), opaqueExpected)
  assert.equal(transparentOpaque.ok, false)
  assert.ok(transparentOpaque.mismatches.every((sample) => sample.reason === 'opaque_alpha=0'))
})

test('model transitions cannot reuse identical Live2D screenshot hashes', () => {
  assert.equal(evaluateModelHashTransitions([
    { modelId: 'mao', live2dSha256: 'a' },
    { modelId: 'haru', live2dSha256: 'b' },
    { modelId: 'hiyori', live2dSha256: 'c' },
  ]).ok, true)
  const duplicate = evaluateModelHashTransitions([
    { modelId: 'mao', live2dSha256: 'same' },
    { modelId: 'haru', live2dSha256: 'same' },
  ])
  assert.equal(duplicate.ok, false)
})

test('dev harness source keeps cold contexts isolated and switches without reload', () => {
  const source = readFileSync(new URL('../scripts/live2d-three-model-smoke.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /DEFAULT_URL|47825/)
  assert.match(source, /createViteServer/)
  assert.match(source, /root = REPO_ROOT/)
  assert.match(source, /host: '127\.0\.0\.1'/)
  assert.match(source, /port: 0/)
  assert.match(source, /strictPort: true/)
  assert.match(source, /server\.httpServer\?\.address\?\.\(\)/)
  assert.match(source, /serverMode/)
  assert.match(source, /cleanup: \{/)
  assert.match(source, /browserClosed: false/)
  assert.match(source, /serverClosed: false/)
  assert.match(source, /createLive2DSmokeCleanupController/)
  assert.match(source, /createLive2DSmokeSignalController/)
  assert.match(source, /startTimeoutMs = 30_000/)
  assert.match(source, /closeTimeoutMs = 5_000/)
  assert.match(source, /closeRequested/)
  assert.match(source, /closeServerOnce/)
  assert.match(source, /handleSIGINT: false/)
  assert.match(source, /handleSIGTERM: false/)
  assert.match(source, /handleSIGHUP: false/)
  assert.match(source, /target\.on\(signal, handler\)/)
  assert.match(source, /target\.off\(signal, handler\)/)
  assert.match(source, /terminate = \(code\) => process\.exit\(code\)/)
  assert.match(source, /if \(invokedPath === path\.resolve\(fileURLToPath\(import\.meta\.url\)\)\)/)
  assert.match(source, /finally \{[\s\S]*await cleanupController\.cleanup\(\)[\s\S]*signalController\.remove\(\)/)
  assert.match(source, /browserCloseTimeoutMs = 5_000/)
  assert.match(source, /serverCloseTimeoutMs = 5_000/)
  assert.match(source, /reportWriteTimeoutMs = 5_000/)
  assert.match(source, /reportWriteError/)
  assert.match(source, /timeout\(\(\) => writeReport\(report\)/)
  assert.match(source, /if \(!report\.ok\) throw new Error\(report\.error/)
  assert.match(source, /await chromium\.launch\(\{[\s\S]*\.\.\.launchOptions,[\s\S]*channel: 'chrome'/)
  assert.match(source, /const \{ loadSettings \} = await import\('\/src\/lib\/storage\/settings\.ts'\)/)
  assert.match(source, /for \(const modelId of LIVE2D_SMOKE_MODEL_IDS\)/)
  assert.match(source, /omitBackground: expectedBackground\.parsed\?\.mode === 'transparent'/)
  assert.match(source, /rgba: \[data\[offset\], data\[offset \+ 1\], data\[offset \+ 2\], alpha\]/)
  assert.match(source, /const context = await browser\.newContext\(/)
  assert.match(source, /\.\.\.settings,\s*petModelId: selectedModelId/)
  assert.match(source, /window\.dispatchEvent\(new CustomEvent\(settingsEvent, \{ detail: nextSettings \}\)\)/)
  assert.doesNotMatch(source, /page\.reload\(/)
  assert.match(source, /new MutationObserver\(sample\)/)
  assert.match(source, /maxCanvasCount: state\.maxCanvasCount/)
  assert.match(source, /page\.on\('console'/)
  assert.match(source, /page\.on\('pageerror'/)
  assert.match(source, /page\.on\('requestfailed'/)
  assert.match(source, /document\.querySelector\('\.nexus-panel-v2'\)/)
  assert.match(source, /window\.requestAnimationFrame\(\(\) => window\.requestAnimationFrame\(resolve\)\)/)
  assert.match(source, /for \(let attempt = 1; attempt <= 3; attempt \+= 1\)/)
  assert.match(source, /await page\.waitForTimeout\(160\)/)
  assert.match(source, /screenshot background compositor holes after 3 attempts/)
  assert.match(source, /screenshotCount !== 7/)
})

test('Live2D smoke owns a dynamic Vite server but never closes external mode', async () => {
  const configs: Array<Record<string, unknown>> = []
  let listenCalls = 0
  let closeCalls = 0
  const ownedServer = {
    httpServer: { address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 41237 }) },
    async listen() { listenCalls += 1 },
    async close() { closeCalls += 1 },
  }

  const owned = createLive2DSmokeServer({
    createServer: async (config) => {
      configs.push(config)
      return ownedServer
    },
  })
  const started = await owned.start()
  assert.deepEqual(started, {
    mode: 'owned',
    baseUrl: 'http://127.0.0.1:41237',
    port: 41237,
    owned: true,
  })
  assert.equal(listenCalls, 1)
  assert.equal(
    configs[0].root,
    resolve(fileURLToPath(new URL('..', new URL('../scripts/live2d-three-model-smoke.mjs', import.meta.url)))),
  )
  assert.deepEqual(configs[0].server, { host: '127.0.0.1', port: 0, strictPort: true })
  assert.deepEqual(await owned.close(), { closed: true, skipped: false })
  assert.equal(closeCalls, 1)

  let externalFactoryCalls = 0
  const external = createLive2DSmokeServer({
    url: 'http://127.0.0.1:47825',
    createServer: async () => {
      externalFactoryCalls += 1
      return ownedServer
    },
  })
  assert.deepEqual(await external.start(), {
    mode: 'external',
    baseUrl: 'http://127.0.0.1:47825',
    port: 47825,
    owned: false,
  })
  assert.deepEqual(await external.close(), { closed: false, skipped: true, reason: 'external-unowned' })
  assert.equal(externalFactoryCalls, 0)
  assert.equal(closeCalls, 1)
})

test('late owned start is torn down without listening and closes exactly once', async () => {
  let resolveCreate!: (server: { httpServer: { address: () => { port: number } }, listen: () => Promise<void>, close: () => Promise<void> }) => void
  let listenCalls = 0
  let closeCalls = 0
  let resolveCloseObserved!: () => void
  const closeObserved = new Promise<void>((resolve) => { resolveCloseObserved = resolve })
  const lateServer = {
    httpServer: { address: () => ({ port: 41238 }) },
    async listen() { listenCalls += 1 },
    async close() {
      closeCalls += 1
      resolveCloseObserved()
    },
  }
  const createServerDeferred = new Promise<typeof lateServer>((resolve) => { resolveCreate = resolve })
  const owned = createLive2DSmokeServer({
    createServer: async () => createServerDeferred,
    startTimeoutMs: 5,
    closeTimeoutMs: 5,
  })

  await assert.rejects(owned.start(), /Owned Vite server start timed out after 5ms/)
  await assert.rejects(owned.close(), /timed out after 5ms/)
  resolveCreate(lateServer)
  await closeObserved
  assert.equal(listenCalls, 0)
  assert.equal(closeCalls, 1)
  await assert.rejects(owned.close())
  assert.equal(closeCalls, 1)
})

test('timeout helper settles once and clears its timer', async () => {
  let cleared = false
  const value = await awaitWithTimeout(
    async () => 'ok',
    20,
    'fixture operation',
    {
      setTimer: (callback, delay) => setTimeout(callback, delay),
      clearTimer: (timer) => {
        cleared = true
        clearTimeout(timer)
      },
    },
  )
  assert.equal(value, 'ok')
  assert.equal(cleared, true)
})

test('owned start timeout fails closed and cleanup/report remain idempotent', async () => {
  const owned = createLive2DSmokeServer({
    createServer: async () => new Promise(() => {}),
    startTimeoutMs: 5,
    closeTimeoutMs: 5,
  })
  await assert.rejects(owned.start(), /Owned Vite server start timed out after 5ms/)

  const report = createLive2DSmokeReport('/tmp/live2d-timeout')
  let reportWrites = 0
  const cleanup = createLive2DSmokeCleanupController({
    report,
    lifecycle: owned,
    writeReport: async () => { reportWrites += 1 },
    browserCloseTimeoutMs: 5,
    serverCloseTimeoutMs: 5,
  })
  await cleanup.cleanup()
  await cleanup.cleanup()
  assert.equal(reportWrites, 1)
  assert.equal(report.ok, false)
  assert.match(report.cleanup.serverCloseError, /timed out after 5ms/)
})

test('cleanup continues after browser/server reject or timeout, then writes one report', async () => {
  const rejectEvents: string[] = []
  const rejectReport = createLive2DSmokeReport('/tmp/live2d-reject')
  let rejectWrites = 0
  const rejectCleanup = createLive2DSmokeCleanupController({
    report: rejectReport,
    getBrowser: () => ({ close: async () => { rejectEvents.push('browser'); throw new Error('browser close failed') } }),
    lifecycle: { close: async () => { rejectEvents.push('server'); throw new Error('server close failed') } },
    writeReport: async () => { rejectEvents.push('report'); rejectWrites += 1 },
  })
  await rejectCleanup.cleanup()
  assert.deepEqual(rejectEvents, ['browser', 'server', 'report'])
  assert.equal(rejectWrites, 1)
  assert.match(rejectReport.cleanup.browserCloseError, /browser close failed/)
  assert.match(rejectReport.cleanup.serverCloseError, /server close failed/)

  const timeoutEvents: string[] = []
  const timeoutReport = createLive2DSmokeReport('/tmp/live2d-close-timeout')
  const timeoutCleanup = createLive2DSmokeCleanupController({
    report: timeoutReport,
    getBrowser: () => ({ close: () => new Promise(() => {}) }),
    lifecycle: { close: () => new Promise(() => {}) },
    writeReport: async () => { timeoutEvents.push('report') },
    browserCloseTimeoutMs: 5,
    serverCloseTimeoutMs: 5,
  })
  await timeoutCleanup.cleanup()
  assert.deepEqual(timeoutEvents, ['report'])
  assert.match(timeoutReport.cleanup.browserCloseError, /timed out after 5ms/)
  assert.match(timeoutReport.cleanup.serverCloseError, /timed out after 5ms/)
})

test('signal cleanup is ordered, idempotent, external-safe, and uses signal exit codes', async () => {
  const events: string[] = []
  const report = createLive2DSmokeReport('/tmp/live2d-signal')
  const cleanup = createLive2DSmokeCleanupController({
    report,
    getBrowser: () => ({ close: async () => { events.push('browser') } }),
    lifecycle: { close: async () => { events.push('server'); return { closed: true, skipped: false } } },
    writeReport: async () => { events.push('report') },
  })
  let exitCode = null
  let terminated = null
  const signals = createLive2DSmokeSignalController({
    report,
    cleanup: cleanup.cleanup,
    setExitCode: (code) => { exitCode = code },
    terminate: (code) => { terminated = code; events.push('terminate') },
  })
  const first = signals.handleSignal('SIGINT')
  const second = signals.handleSignal('SIGINT')
  assert.strictEqual(first, second)
  await Promise.all([first, second, cleanup.cleanup()])
  assert.deepEqual(events, ['browser', 'server', 'report', 'terminate'])
  assert.equal(report.cleanup.serverClosed, true)
  assert.equal(signals.requestedSignal, 'SIGINT')
  assert.equal(signals.exitCode, 130)
  assert.equal(exitCode, 130)
  assert.equal(terminated, 130)

  const termReport = createLive2DSmokeReport('/tmp/live2d-sigterm')
  let termExitCode = null
  let termTerminated = null
  const termSignals = createLive2DSmokeSignalController({
    report: termReport,
    cleanup: async () => {},
    setExitCode: (code) => { termExitCode = code },
    terminate: (code) => { termTerminated = code },
  })
  await termSignals.handleSignal('SIGTERM')
  assert.equal(termExitCode, 143)
  assert.equal(termTerminated, 143)
})

test('signal waits for a bounded report write before terminating', async () => {
  const events: string[] = []
  const report = createLive2DSmokeReport('/tmp/live2d-report-timeout')
  const cleanup = createLive2DSmokeCleanupController({
    report,
    getBrowser: () => ({ close: async () => { events.push('browser') } }),
    lifecycle: { close: async () => { events.push('server'); return { closed: true, skipped: false } } },
    writeReport: () => new Promise<void>(() => {}),
    reportWriteTimeoutMs: 5,
  })
  let terminated = null
  let exitCode = null
  const signals = createLive2DSmokeSignalController({
    report,
    cleanup: cleanup.cleanup,
    setExitCode: (code) => { exitCode = code },
    terminate: (code) => { terminated = code },
  })
  await signals.handleSignal('SIGTERM')
  assert.deepEqual(events, ['browser', 'server'])
  assert.match(report.cleanup.reportWriteError, /timed out after 5ms/)
  assert.equal(report.ok, false)
  assert.equal(exitCode, 143)
  assert.equal(terminated, 143)
})

test('real child signal handlers exit 130/143 after browser-server-report cleanup order', {
  skip: process.platform === 'win32'
    ? 'Windows does not provide POSIX SIGINT/SIGTERM child exit-code semantics'
    : false,
}, () => {
  assert.equal(process.exitCode, undefined, 'test worker starts without a termination code')
  const smokeUrl = pathToFileURL(fileURLToPath(new URL('../scripts/live2d-three-model-smoke.mjs', import.meta.url))).href
  const evidenceDir = mkdtempSync(join(tmpdir(), 'nexus-live2d-signal-'))
  try {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const evidencePath = join(evidenceDir, `${signal}.txt`)
      const childSource = `
        import { appendFileSync } from 'node:fs'
        const { createLive2DSmokeCleanupController, createLive2DSmokeReport, createLive2DSmokeSignalController } = await import(${JSON.stringify(smokeUrl)})
        const record = (event) => {
          appendFileSync(process.env.NEXUS_SIGNAL_EVIDENCE, event + '\\n')
          process.stdout.write(event + '\\n')
        }
        const report = createLive2DSmokeReport('child-signal')
        const cleanup = createLive2DSmokeCleanupController({
          report,
          getBrowser: () => ({ close: async () => record('browser') }),
          lifecycle: { close: async () => { record('server'); return { closed: true, skipped: false } } },
          writeReport: async () => record('report'),
        })
        const signals = createLive2DSmokeSignalController({ report, cleanup: cleanup.cleanup })
        signals.install()
        process.kill(process.pid, ${JSON.stringify(signal)})
        await new Promise((resolve) => setImmediate(resolve))
        await signals.promise
      `
      const childEnv = { ...process.env, NEXUS_SIGNAL_EVIDENCE: evidencePath }
      delete childEnv.NODE_TEST_CONTEXT
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', childSource], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: childEnv,
        timeout: 10_000,
      })
      assert.equal(result.status, signal === 'SIGINT' ? 130 : 143, `${signal} child status`)
      assert.equal(result.signal, null)
      assert.equal(process.exitCode, undefined, `${signal} child must not set the parent exit code`)
      const evidence = readFileSync(evidencePath, 'utf8').trim().split('\n')
      assert.deepEqual(evidence, ['browser', 'server', 'report'], `${signal} cleanup order`)
      assert.match(result.stdout, /browser[\s\S]*server[\s\S]*report/)
    }
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true })
  }
})

test('smoke report starts fail-closed and records cleanup fields', () => {
  const report = createLive2DSmokeReport('/tmp/live2d-smoke')
  assert.equal(report.ok, false)
  assert.deepEqual(report.cleanup, {
    browserClosed: false,
    serverClosed: false,
    serverOwnership: 'unknown',
  })
  report.serverMode = 'external'
  report.cleanup.serverOwnership = 'external-unowned'
  report.cleanup.serverClosed = 'skipped-external-unowned'
  report.error = 'synthetic failure'
  assert.equal(report.cleanup.serverClosed, 'skipped-external-unowned')
  assert.equal(report.error, 'synthetic failure')
})

test('packaged CDP snapshot reads real canvas markers and only first-frame is ready', () => {
  assert.equal(LIVE2D_READY_PHASE, 'first-frame')
  assert.equal(isLive2DFirstFrameReady('first-frame'), true)
  assert.equal(isLive2DFirstFrameReady('model-ready'), false)
  assert.equal(isLive2DFirstFrameReady(null), false)
  assert.match(LIVE2D_SNAPSHOT_SCRIPT, /document\.querySelector\('\.live2d-canvas'\)/)
  assert.match(LIVE2D_SNAPSHOT_SCRIPT, /document\.querySelectorAll\('\.live2d-canvas canvas'\)/)
  assert.match(LIVE2D_SNAPSHOT_SCRIPT, /const ready = phase === "first-frame"/)
  assert.doesNotMatch(LIVE2D_SNAPSHOT_SCRIPT, /phase === 'model-ready'/)
  assert.doesNotMatch(LIVE2D_SNAPSHOT_SCRIPT, /Boolean\(container\?\.dataset\?\.live2dReadyMs\)/)
})
