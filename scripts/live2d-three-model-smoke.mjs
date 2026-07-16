#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { createServer as createViteServer } from 'vite'
import {
  LIVE2D_SMOKE_MAX_FIRST_FRAME_MS,
  LIVE2D_SMOKE_MODEL_IDS,
  LIVE2D_SMOKE_SWITCH_SEQUENCE,
  evaluateBrowserFailureGate,
  evaluateLive2DSnapshot,
  evaluateModelHashTransitions,
  evaluateScreenshotEvidence,
  evaluateScreenshotEdgeBackground,
  live2dScreenshotEdgePoints,
  parseCssBackgroundColor,
} from './lib/live2d-three-model-smoke.mjs'

const SETTINGS_STORAGE_KEY = 'nexus:settings'
const SETTINGS_UPDATED_EVENT = 'nexus:settings-updated'
const DEFAULT_VIEWPORT = { width: 1100, height: 760 }
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

export function awaitWithTimeout(operation, timeoutMs, label, {
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimer(timer)
      callback(value)
    }
    timer = setTimer(() => {
      finish(reject, new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    Promise.resolve()
      .then(operation)
      .then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      )
  })
}

function parseArgs(argv) {
  const options = {
    url: '',
    outDir: '',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--url') {
      options.url = argv[index + 1] ?? ''
      index += 1
    } else if (arg === '--out') {
      options.outDir = argv[index + 1] ?? ''
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/live2d-three-model-smoke.mjs [--url external-url] [--out artifacts/live2d-three-model-smoke/latest]')
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (argv.includes('--url') && !options.url) throw new Error('--url must not be empty')
  return options
}

export function createLive2DSmokeServer({
  url = '',
  createServer = createViteServer,
  root = REPO_ROOT,
  startTimeoutMs = 30_000,
  closeTimeoutMs = 5_000,
  timeout = awaitWithTimeout,
} = {}) {
  const external = Boolean(url)
  let server = null
  let baseUrl = external ? url.replace(/\/+$/, '') : ''
  let port = external ? (Number(new URL(baseUrl).port) || null) : null
  let closed = false
  let startPromise = null
  let startSettled = true
  let closePromise = null
  let closeRequested = false
  let closeServerPromise = null
  let lateStartCleanupPromise = null

  const closeServerOnce = (candidate = server) => {
    if (external || !candidate) return Promise.resolve({ closed: false, skipped: closed })
    if (closeServerPromise) return closeServerPromise
    closeServerPromise = (async () => {
      await timeout(() => candidate.close(), closeTimeoutMs, 'Owned Vite server close')
      closed = true
      return { closed: true, skipped: false }
    })()
    return closeServerPromise
  }

  const scheduleLateStartCleanup = () => {
    if (!startPromise || lateStartCleanupPromise) return
    lateStartCleanupPromise = startPromise.then(
      () => closeServerOnce(server),
      () => closeServerOnce(server),
    ).catch(() => null)
  }

  return {
    mode: external ? 'external' : 'owned',
    get baseUrl() { return baseUrl },
    get port() { return port },
    get closed() { return closed },
    async start() {
      if (external) return { mode: 'external', baseUrl, port, owned: false }

      if (!startPromise) {
        startSettled = false
        startPromise = (async () => {
          server = await createServer({
            root,
            server: {
              host: '127.0.0.1',
              port: 0,
              strictPort: true,
            },
          })
          if (closeRequested) {
            await closeServerOnce(server)
            throw new Error('Owned Vite server start cancelled after close request.')
          }
          await server.listen()
          if (closeRequested) {
            await closeServerOnce(server)
            throw new Error('Owned Vite server start cancelled after listen.')
          }
          const address = server.httpServer?.address?.()
          if (!address || typeof address === 'string' || !address.port) {
            throw new Error('Owned Vite server did not expose a dynamic port.')
          }
          port = address.port
          baseUrl = `http://127.0.0.1:${port}`
          return { mode: 'owned', baseUrl, port, owned: true }
        })()
        startPromise.then(
          () => { startSettled = true },
          () => { startSettled = true },
        )
      }
      return timeout(() => startPromise, startTimeoutMs, 'Owned Vite server start')
    },
    async close() {
      if (external) return { closed: false, skipped: true, reason: 'external-unowned' }
      closeRequested = true
      if (closePromise) return closePromise
      scheduleLateStartCleanup()

      closePromise = (async () => {
        let firstError = null
        if (startPromise && !startSettled) {
          try {
            await timeout(() => startPromise, closeTimeoutMs, 'Owned Vite server start cleanup')
          } catch (error) {
            firstError = error
          }
        }
        if (closed || !server) {
          if (firstError) throw firstError
          return { closed: false, skipped: closed }
        }
        try {
          const closedResult = await closeServerOnce(server)
          if (firstError) throw firstError
          return closedResult
        } catch (error) {
          firstError ??= error
        }
        if (firstError) throw firstError
        return { closed: false, skipped: closed }
      })()
      return closePromise
    },
  }
}

export function createLive2DSmokeCleanupController({
  report,
  lifecycle,
  getBrowser = () => null,
  writeReport = async () => {},
  browserCloseTimeoutMs = 5_000,
  serverCloseTimeoutMs = 5_000,
  reportWriteTimeoutMs = 5_000,
  timeout = awaitWithTimeout,
} = {}) {
  let cleanupPromise = null

  const recordFailure = (field, error) => {
    const message = errorMessage(error)
    report.cleanup[field] = message
    report.ok = false
    report.error ??= message
  }

  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      const browser = getBrowser()
      if (browser) {
        try {
          await timeout(() => browser.close(), browserCloseTimeoutMs, 'Browser close')
          report.cleanup.browserClosed = true
        } catch (error) {
          recordFailure('browserCloseError', error)
        }
      }

      try {
        const closed = await timeout(() => lifecycle.close(), serverCloseTimeoutMs, 'Owned Vite server close')
        report.cleanup.serverClosed = closed.skipped ? `skipped-${closed.reason}` : closed.closed
      } catch (error) {
        recordFailure('serverCloseError', error)
      }

      try {
        await timeout(() => writeReport(report), reportWriteTimeoutMs, 'Report write')
      } catch (error) {
        recordFailure('reportWriteError', error)
      }
    })()
    return cleanupPromise
  }

  return {
    cleanup,
    get promise() { return cleanupPromise },
  }
}

export function createLive2DSmokeSignalController({
  cleanup,
  report,
  setExitCode = (code) => { process.exitCode = code },
  terminate = (code) => process.exit(code),
} = {}) {
  let requestedSignal = null
  let exitCode = null
  let cleanupPromise = null
  const handlers = new Map()

  const handleSignal = (signal) => {
    if (cleanupPromise) return cleanupPromise
    requestedSignal = signal
    exitCode = signal === 'SIGINT' ? 130 : 143
    report.signal = signal
    report.ok = false
    report.error ??= `Interrupted by ${signal}`
    cleanupPromise = Promise.resolve()
      .then(() => cleanup())
      .then(
        () => {
          setExitCode(exitCode)
          terminate(exitCode)
          return exitCode
        },
        (error) => {
          report.cleanup.signalCleanupError = errorMessage(error)
          report.ok = false
          report.error ??= report.cleanup.signalCleanupError
          setExitCode(exitCode)
          terminate(exitCode)
          return exitCode
        },
      )
    return cleanupPromise
  }

  const install = (target = process) => {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => { handleSignal(signal) }
      handlers.set(signal, handler)
      target.on(signal, handler)
    }
  }

  const remove = (target = process) => {
    for (const [signal, handler] of handlers) target.off(signal, handler)
    handlers.clear()
  }

  return {
    handleSignal,
    install,
    remove,
    get requestedSignal() { return requestedSignal },
    get exitCode() { return exitCode },
    get promise() { return cleanupPromise },
  }
}

export function createLive2DSmokeReport(outDir) {
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    serverMode: null,
    baseUrl: null,
    port: null,
    outDir,
    browserChannel: null,
    completeSettingsKeyCount: 0,
    coldStarts: [],
    switchSequence: null,
    screenshotCount: 0,
    cleanup: {
      browserClosed: false,
      serverClosed: false,
      serverOwnership: 'unknown',
    },
    ok: false,
  }
}

function panelChatUrl(baseUrl) {
  const url = new URL(baseUrl)
  url.searchParams.set('view', 'panel')
  url.searchParams.set('section', 'chat')
  return url.toString()
}

async function assertReachable(baseUrl) {
  const response = await fetch(baseUrl, { signal: AbortSignal.timeout(3000) })
  if (!response.ok) throw new Error(`Dev server returned HTTP ${response.status}: ${baseUrl}`)
}

async function launchBrowserWithFallback() {
  const launchOptions = {
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  }

  try {
    return {
      browser: await chromium.launch(launchOptions),
      channel: 'bundled-chromium',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const missingBundledBrowser = message.includes('Executable doesn')
      || message.includes('Looks like Playwright was just installed')
    if (!missingBundledBrowser) throw error

    return {
      browser: await chromium.launch({
        ...launchOptions,
        channel: 'chrome',
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
      }),
      channel: 'chrome-fallback',
    }
  }
}

async function readCompleteCurrentSettings(browser, baseUrl) {
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    const settingsModuleUrl = new URL('/live2d/mao/Mao.model3.json', baseUrl).toString()
    await page.goto(settingsModuleUrl, { waitUntil: 'domcontentloaded' })
    return await page.evaluate(async () => {
      const { loadSettings } = await import('/src/lib/storage/settings.ts')
      return loadSettings()
    })
  } finally {
    await page.close()
    await context.close()
  }
}

async function addStorageSeed(context, completeSettings, modelId, observeCanvas = false) {
  await context.addInitScript(({ settingsKey, settings, selectedModelId }) => {
    window.localStorage.setItem(settingsKey, JSON.stringify({
      ...settings,
      petModelId: selectedModelId,
    }))
    window.localStorage.setItem('nexus:onboarding', JSON.stringify({
      completedAt: '2026-07-12T00:00:00.000Z',
      firstConversationAt: '2026-07-12T00:02:00.000Z',
      firstConversationElapsedMs: 120000,
    }))
    window.sessionStorage.setItem('nexus:startup-greeting-shown', '1')
    window.sessionStorage.setItem('nexus.modelSetup.dismissedUntilRestart', '1')
  }, {
    settingsKey: SETTINGS_STORAGE_KEY,
    settings: completeSettings,
    selectedModelId: modelId,
  })

  if (observeCanvas) {
    await context.addInitScript(() => {
      const state = {
        maxCanvasCount: 0,
        samples: [],
      }
      const sample = () => {
        const canvasCount = document.querySelectorAll('.live2d-canvas canvas').length
        state.maxCanvasCount = Math.max(state.maxCanvasCount, canvasCount)
        state.samples.push({ at: performance.now(), canvasCount })
        if (state.samples.length > 800) state.samples.splice(0, state.samples.length - 800)
      }
      const observer = new MutationObserver(sample)
      observer.observe(document, { childList: true, subtree: true })
      window.__live2dThreeModelSmokeObserver = { state, observer, sample }
      sample()
    })
  }
}

function attachBrowserFailureGate(page) {
  const failures = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
  }
  const onConsole = (message) => {
    if (message.type() !== 'error') return
    failures.consoleErrors.push({ text: message.text(), location: message.location() })
  }
  const onPageError = (error) => {
    failures.pageErrors.push({ message: error.message, stack: error.stack ?? null })
  }
  const onRequestFailed = (request) => {
    failures.requestFailures.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      errorText: request.failure()?.errorText ?? 'unknown',
    })
  }
  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  page.on('requestfailed', onRequestFailed)

  return {
    failures,
    dispose() {
      page.off('console', onConsole)
      page.off('pageerror', onPageError)
      page.off('requestfailed', onRequestFailed)
    },
  }
}

async function waitForFirstFrame(page, expectedModelId) {
  await page.waitForSelector('.live2d-canvas')
  await page.waitForFunction((modelId) => {
    const container = document.querySelector('.live2d-canvas')
    return container?.dataset.live2dPhase === 'first-frame'
      && container?.dataset.live2dModelId === modelId
  }, expectedModelId, { timeout: LIVE2D_SMOKE_MAX_FIRST_FRAME_MS })
}

async function snapshotLive2D(page) {
  return page.evaluate(() => {
    const container = document.querySelector('.live2d-canvas')
    const canvas = container?.querySelector('canvas') ?? null
    const canvasRect = canvas?.getBoundingClientRect() ?? null
    const live2dRect = container?.getBoundingClientRect() ?? null
    const debug = window.__desktopPetLive2DDebug ?? null
    return {
      phase: container?.dataset.live2dPhase ?? null,
      modelId: container?.dataset.live2dModelId ?? null,
      error: container?.dataset.live2dError ?? null,
      readyMs: container?.dataset.live2dReadyMs ?? null,
      firstFrameMs: container?.dataset.live2dFirstFrameMs ?? null,
      shellCount: document.querySelectorAll('.live2d-shell').length,
      canvasCount: document.querySelectorAll('.live2d-canvas canvas').length,
      fallbackCount: document.querySelectorAll('.live2d-fallback').length,
      appErrorFallbackCount: document.querySelectorAll('.app-error-fallback').length,
      debugPhase: debug?.phase ?? null,
      hasDebugApp: Boolean(debug?.app),
      hasDebugModel: Boolean(debug?.model),
      canvasWidth: canvasRect?.width ?? 0,
      canvasHeight: canvasRect?.height ?? 0,
      live2dRect: live2dRect ? {
        left: live2dRect.left,
        top: live2dRect.top,
        width: live2dRect.width,
        height: live2dRect.height,
      } : null,
    }
  })
}

function assertPass(label, evaluation) {
  if (!evaluation.ok) throw new Error(`${label}: ${evaluation.errors.join('; ')}`)
}

function clampCrop(rect, imageWidth, imageHeight) {
  const left = Math.max(0, Math.min(imageWidth - 1, Math.floor(rect.left)))
  const top = Math.max(0, Math.min(imageHeight - 1, Math.floor(rect.top)))
  const right = Math.max(left + 1, Math.min(imageWidth, Math.ceil(rect.left + rect.width)))
  const bottom = Math.max(top + 1, Math.min(imageHeight, Math.ceil(rect.top + rect.height)))
  return { left, top, width: right - left, height: bottom - top }
}

async function analyzeScreenshot(buffer, live2dRect) {
  const metadata = await sharp(buffer).metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (!live2dRect || !width || !height) {
    return {
      byteLength: buffer.byteLength,
      width,
      height,
      live2dWidth: 0,
      live2dHeight: 0,
      colorBucketCount: 0,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      live2dSha256: '',
    }
  }

  const crop = clampCrop(live2dRect, width, height)
  const { data, info } = await sharp(buffer)
    .extract(crop)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const buckets = new Set()
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset] >> 4
    const green = data[offset + 1] >> 4
    const blue = data[offset + 2] >> 4
    buckets.add((red << 8) | (green << 4) | blue)
  }

  return {
    byteLength: buffer.byteLength,
    width,
    height,
    live2dWidth: info.width,
    live2dHeight: info.height,
    colorBucketCount: buckets.size,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    live2dSha256: createHash('sha256').update(data).digest('hex'),
  }
}

async function readExpectedScreenshotBackground(page) {
  return page.evaluate(() => {
    const surface = document.querySelector('.nexus-panel-v2')
      || document.querySelector('.desktop-pet-root--panel')
      || document.body
    return {
      selector: surface?.className ? `.${String(surface.className).trim().split(/\s+/).join('.')}` : surface?.tagName.toLowerCase() ?? null,
      color: surface ? getComputedStyle(surface).backgroundColor : null,
    }
  })
}

async function inspectScreenshotEdges(buffer, expectedBackground) {
  const parsedExpected = expectedBackground?.parsed
    ?? parseCssBackgroundColor(expectedBackground?.color)
  const { data, info } = await sharp(buffer)
    .raw()
    .toBuffer({ resolveWithObject: true })
  const samples = live2dScreenshotEdgePoints(info.width, info.height).map(([x, y]) => {
    const offset = (y * info.width + x) * info.channels
    const alpha = info.channels >= 4 ? data[offset + 3] : 255
    return {
      x,
      y,
      rgb: [data[offset], data[offset + 1], data[offset + 2]],
      alpha,
      rgba: [data[offset], data[offset + 1], data[offset + 2], alpha],
    }
  })
  return {
    selector: expectedBackground?.selector ?? null,
    cssColor: expectedBackground?.color ?? null,
    ...evaluateScreenshotEdgeBackground(samples, parsedExpected),
    samples,
  }
}

async function captureEvidence(page, outDir, filename, snapshot) {
  await page.evaluate(async () => { await document.fonts.ready })
  const screenshotPath = path.join(outDir, filename)
  const expectedCssBackground = await readExpectedScreenshotBackground(page)
  const expectedBackground = {
    ...expectedCssBackground,
    parsed: parseCssBackgroundColor(expectedCssBackground?.color),
  }
  const attempts = []

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.evaluate(() => new Promise((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))
    }))
    const screenshot = await page.screenshot({
      fullPage: false,
      omitBackground: expectedBackground.parsed?.mode === 'transparent',
    })
    const edgeBackground = await inspectScreenshotEdges(screenshot, expectedBackground)
    attempts.push({
      attempt,
      ok: edgeBackground.ok,
      mode: edgeBackground.mode,
      expectedRgba: edgeBackground.expectedRgba,
      mismatches: edgeBackground.mismatches,
    })
    if (edgeBackground.ok) {
      await writeFile(screenshotPath, screenshot)
      const evidence = await analyzeScreenshot(screenshot, snapshot.live2dRect)
      assertPass(filename, evaluateScreenshotEvidence(evidence))
      return {
        path: filename,
        captureAttempt: attempt,
        captureAttempts: attempts,
        edgeBackground,
        ...evidence,
      }
    }
    await page.waitForTimeout(160)
  }

  throw new Error(`${filename}: screenshot background compositor holes after 3 attempts (${JSON.stringify(attempts)})`)
}

async function openSeededPage(browser, baseUrl, settings, modelId, observeCanvas = false) {
  const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT, deviceScaleFactor: 1 })
  await addStorageSeed(context, settings, modelId, observeCanvas)
  const page = await context.newPage()
  page.setDefaultTimeout(LIVE2D_SMOKE_MAX_FIRST_FRAME_MS)
  const gate = attachBrowserFailureGate(page)
  await page.goto(panelChatUrl(baseUrl), { waitUntil: 'domcontentloaded' })
  return { context, page, gate }
}

async function runColdStarts(browser, baseUrl, outDir, settings) {
  const results = []
  for (const modelId of LIVE2D_SMOKE_MODEL_IDS) {
    const runtime = await openSeededPage(browser, baseUrl, settings, modelId)
    try {
      await waitForFirstFrame(runtime.page, modelId)
      await runtime.page.waitForTimeout(250)
      const snapshot = await snapshotLive2D(runtime.page)
      const evaluation = evaluateLive2DSnapshot(snapshot, modelId)
      assertPass(`cold-${modelId}`, evaluation)
      const screenshot = await captureEvidence(
        runtime.page,
        outDir,
        `cold-${modelId}.png`,
        snapshot,
      )
      const browserGate = evaluateBrowserFailureGate(runtime.gate.failures)
      assertPass(`cold-${modelId}-browser`, browserGate)
      results.push({ modelId, snapshot, evaluation, screenshot, browserFailures: runtime.gate.failures })
    } finally {
      runtime.gate.dispose()
      await runtime.page.close().catch(() => {})
      await runtime.context.close().catch(() => {})
    }
  }

  assertPass('cold-model-hashes', evaluateModelHashTransitions(results.map((result) => ({
    modelId: result.modelId,
    live2dSha256: result.screenshot.live2dSha256,
  }))))
  return results
}

async function patchModelWithoutReload(page, modelId) {
  return page.evaluate(({ settingsKey, settingsEvent, selectedModelId }) => {
    const parsed = JSON.parse(window.localStorage.getItem(settingsKey) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Stored settings are not a complete object.')
    }
    const nextSettings = { ...parsed, petModelId: selectedModelId }
    window.localStorage.setItem(settingsKey, JSON.stringify(nextSettings))
    window.dispatchEvent(new CustomEvent(settingsEvent, { detail: nextSettings }))
    return { keyCount: Object.keys(nextSettings).length, petModelId: nextSettings.petModelId }
  }, {
    settingsKey: SETTINGS_STORAGE_KEY,
    settingsEvent: SETTINGS_UPDATED_EVENT,
    selectedModelId: modelId,
  })
}

async function stashRuntimeIdentity(page) {
  await page.evaluate(() => {
    const debug = window.__desktopPetLive2DDebug ?? null
    window.__live2dThreeModelSmokePrevious = {
      canvas: document.querySelector('.live2d-canvas canvas'),
      app: debug?.app ?? null,
      model: debug?.model ?? null,
    }
  })
}

async function readRuntimeIdentityChange(page) {
  return page.evaluate(() => {
    const previous = window.__live2dThreeModelSmokePrevious
    const debug = window.__desktopPetLive2DDebug ?? null
    const currentCanvas = document.querySelector('.live2d-canvas canvas')
    return {
      oldCanvasDetached: Boolean(previous?.canvas && !previous.canvas.isConnected),
      newCanvasObject: Boolean(currentCanvas && previous?.canvas && currentCanvas !== previous.canvas),
      appChanged: Boolean(debug?.app && previous?.app && debug.app !== previous.app),
      modelChanged: Boolean(debug?.model && previous?.model && debug.model !== previous.model),
    }
  })
}

async function readCanvasObserver(page) {
  return page.evaluate(() => {
    window.__live2dThreeModelSmokeObserver?.sample()
    const state = window.__live2dThreeModelSmokeObserver?.state
    return state ? {
      maxCanvasCount: state.maxCanvasCount,
      currentCanvasCount: document.querySelectorAll('.live2d-canvas canvas').length,
      samples: [...state.samples],
    } : null
  })
}

async function runSwitchSequence(browser, baseUrl, outDir, settings) {
  const runtime = await openSeededPage(browser, baseUrl, settings, 'mao', true)
  const steps = []
  try {
    for (let index = 0; index < LIVE2D_SMOKE_SWITCH_SEQUENCE.length; index += 1) {
      const modelId = LIVE2D_SMOKE_SWITCH_SEQUENCE[index]
      let patch = null
      if (index > 0) {
        patch = await patchModelWithoutReload(runtime.page, modelId)
      }

      await waitForFirstFrame(runtime.page, modelId)
      await runtime.page.waitForTimeout(1000)
      const snapshot = await snapshotLive2D(runtime.page)
      const evaluation = evaluateLive2DSnapshot(snapshot, modelId)
      assertPass(`switch-${index + 1}-${modelId}`, evaluation)

      const identity = index > 0 ? await readRuntimeIdentityChange(runtime.page) : null
      if (identity && !Object.values(identity).every(Boolean)) {
        throw new Error(`switch-${index + 1}-${modelId}: runtime identity did not fully change (${JSON.stringify(identity)})`)
      }

      const observer = await readCanvasObserver(runtime.page)
      if (!observer || observer.maxCanvasCount > 1 || observer.currentCanvasCount !== 1) {
        throw new Error(`switch-${index + 1}-${modelId}: canvas observer violation (${JSON.stringify(observer)})`)
      }

      const screenshot = await captureEvidence(
        runtime.page,
        outDir,
        `switch-${index + 1}-${modelId}.png`,
        snapshot,
      )
      const browserGate = evaluateBrowserFailureGate(runtime.gate.failures)
      assertPass(`switch-${index + 1}-${modelId}-browser`, browserGate)
      steps.push({
        index: index + 1,
        modelId,
        patch,
        snapshot,
        evaluation,
        identity,
        observer: {
          maxCanvasCount: observer.maxCanvasCount,
          currentCanvasCount: observer.currentCanvasCount,
          sampleCount: observer.samples.length,
        },
        screenshot,
      })
      await stashRuntimeIdentity(runtime.page)
    }

    assertPass('switch-model-hashes', evaluateModelHashTransitions(steps.map((step) => ({
      modelId: step.modelId,
      live2dSha256: step.screenshot.live2dSha256,
    }))))
    return { steps, browserFailures: runtime.gate.failures }
  } finally {
    runtime.gate.dispose()
    await runtime.page.close().catch(() => {})
    await runtime.context.close().catch(() => {})
  }
}

export async function runLive2DSmoke(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const outDir = path.resolve(options.outDir || path.join(
    process.cwd(),
    'artifacts',
    'live2d-three-model-smoke',
    new Date().toISOString().replace(/[:.]/g, '-'),
  ))
  await mkdir(outDir, { recursive: true })
  const report = createLive2DSmokeReport(outDir)
  const lifecycle = createLive2DSmokeServer({ url: options.url })
  report.serverMode = lifecycle.mode
  report.cleanup.serverOwnership = lifecycle.mode === 'owned' ? 'owned-vite' : 'external-unowned'
  let browser = null
  const writeReport = () => writeFile(
    path.join(outDir, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  const cleanupController = createLive2DSmokeCleanupController({
    report,
    lifecycle,
    getBrowser: () => browser,
    writeReport,
  })
  const signalController = createLive2DSmokeSignalController({
    report,
    cleanup: cleanupController.cleanup,
  })
  signalController.install()

  try {
    const started = await lifecycle.start()
    report.baseUrl = started.baseUrl
    report.port = started.port
    await assertReachable(report.baseUrl)
    const launched = await launchBrowserWithFallback()
    browser = launched.browser
    report.browserChannel = launched.channel
    const completeSettings = await readCompleteCurrentSettings(browser, report.baseUrl)
    report.completeSettingsKeyCount = Object.keys(completeSettings).length
    if (report.completeSettingsKeyCount < 100) {
      throw new Error(`Complete settings seed is unexpectedly small (${report.completeSettingsKeyCount} keys).`)
    }

    report.coldStarts = await runColdStarts(browser, report.baseUrl, outDir, completeSettings)
    report.switchSequence = await runSwitchSequence(browser, report.baseUrl, outDir, completeSettings)
    report.screenshotCount = report.coldStarts.length + report.switchSequence.steps.length
    if (report.screenshotCount !== 7) {
      throw new Error(`Expected 7 screenshots, received ${report.screenshotCount}.`)
    }
    report.ok = true
  } catch (error) {
    report.error = errorMessage(error)
    if (report.serverMode === 'owned' && !report.baseUrl) {
      report.cleanup.startError = report.error
    }
    process.exitCode = 1
  } finally {
    try {
      await cleanupController.cleanup()
      if (signalController.promise) await signalController.promise
    } finally {
      signalController.remove()
    }
  }

  if (!report.ok) throw new Error(report.error || 'Live2D smoke failed.')
  console.log(`Live2D three-model smoke passed: ${report.screenshotCount} screenshots`)
  console.log(`report: ${path.join(outDir, 'report.json')}`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  await runLive2DSmoke()
}
