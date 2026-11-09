#!/usr/bin/env node
/**
 * Packaged first-use lifecycle measurement (macOS-first).
 *
 * Unlike `runtime:packaged-sustained`, this harness does not seed onboarding
 * through localStorage. It completes the real first-use guide through the
 * product UI, verifies the completion marker, hides the panel through the
 * product API, and samples the process tree through the completed-hidden and
 * reopened-panel phases.
 *
 * Output: output/packaged-first-use-lifecycle/report.json + samples.jsonl
 *
 * Env:
 *   PACKAGED_SMOKE_RELEASE_DIR   single release dir (default: release-smoke,release)
 *   FIRST_USE_RUNTIME_PORT       remote debugging port (default: random free)
 *   FIRST_USE_RUNTIME_HIDDEN_MS  completed-hidden sample window (default: 30000)
 *   FIRST_USE_RUNTIME_OPEN_MS    panel-open sample window (default: 10000)
 *   FIRST_USE_RUNTIME_INTERVAL_MS sample interval (default: 1000)
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { selectPackagedExecutable } from './lib/packaged-sustained-runtime-selection.mjs'
import {
  allocatePort,
  wait,
  waitForCdpHttp,
} from './lib/packaged-sustained-runtime-cdp.mjs'
import {
  sampleProcessTree,
  terminateTree,
} from './lib/packaged-sustained-runtime-process.mjs'
import { createFirstUseMockProvider } from './lib/first-use-mock-provider.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'output', 'packaged-first-use-lifecycle')
const CONFIG = {
  hiddenMs: envInt('FIRST_USE_RUNTIME_HIDDEN_MS', 30_000),
  openMs: envInt('FIRST_USE_RUNTIME_OPEN_MS', 10_000),
  intervalMs: envInt('FIRST_USE_RUNTIME_INTERVAL_MS', 1_000),
  cdpConnectTimeoutMs: envInt('FIRST_USE_RUNTIME_CDP_TIMEOUT_MS', 30_000),
  uiTimeoutMs: envInt('FIRST_USE_RUNTIME_UI_TIMEOUT_MS', 30_000),
}

function envInt(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function pageUrl(page) {
  try { return page.url() } catch { return '' }
}

function viewOf(page) {
  try { return new URL(page.url()).searchParams.get('view') } catch { return null }
}

function pagesOf(browser) {
  return browser.contexts().flatMap((context) => context.pages())
}

async function waitForPages(browser, timeoutMs, predicate) {
  const started = Date.now()
  for (;;) {
    const pages = pagesOf(browser)
    const match = predicate(pages)
    if (match) return { ok: true, pages, match, elapsedMs: Date.now() - started }
    if (Date.now() - started >= timeoutMs) return { ok: false, pages, match: null, elapsedMs: Date.now() - started }
    await wait(200)
  }
}

async function nextGuideStep(page) {
  const progress = page.locator('.onboarding-disclosure__progress')
  const before = await progress.innerText()
  await page.locator('.onboarding-card__actions .primary-button').click()
  await page.waitForFunction((old) => {
    const current = document.querySelector('.onboarding-disclosure__progress')
    if (!current) return true
    return current.textContent.trim() !== old
  }, before)
}

async function finishRemainingGuide(page) {
  for (let count = 0; count < 8 && await page.locator('.onboarding-card').isVisible(); count += 1) {
    await nextGuideStep(page)
  }
  await page.locator('.onboarding-card').waitFor({ state: 'hidden' })
}

async function ensureChatOpen(page) {
  if (!await page.locator('.chat-sheet-v2').isVisible()) {
    await page.locator('.nexus-panel-v2__utility').click()
    await page.locator('.nexus-panel-v2__menu button').first().click()
  }
  const input = page.locator('.chat-sheet-v2__input')
  if (!await input.isVisible()) await page.locator('.chat-sheet-v2__composer-toggle').click()
  await input.waitFor()
}

async function sendLifecycleChat(page) {
  await ensureChatOpen(page)
  const marker = `Lifecycle chat ${Date.now()}`
  await page.locator('.chat-sheet-v2__input').fill(marker)
  await page.locator('.chat-sheet-v2__send').click()
  await page.locator('.chat-sheet-v2__turn[data-role="assistant"] .chat-sheet-v2__message')
    .filter({ hasText: `NEXUS_MOCK_REPLY: ${marker}` })
    .waitFor()
  return marker
}

async function chooseGuideLanguage(page, label) {
  await page.getByRole('radio', { name: label, exact: true }).click()
  await page.waitForFunction((expected) => {
    const selected = document.querySelector('.onboarding-relationship__chip[aria-checked="true"]')
    return selected?.textContent?.trim() === expected
  }, label)
}

async function completeFirstUse(panel, provider) {
  await panel.locator('.onboarding-card').waitFor()
  await chooseGuideLanguage(panel, 'English')
  await nextGuideStep(panel)
  await nextGuideStep(panel)
  await nextGuideStep(panel)
  await panel.locator('.onboarding-region-tabs__tab').last().click()
  await panel.locator('.onboarding-card select').first().selectOption('custom')
  const endpointInputs = panel.locator('.onboarding-grid--two input')
  await endpointInputs.nth(0).waitFor()
  await endpointInputs.nth(0).fill(provider.baseUrl)
  await endpointInputs.nth(1).fill(provider.model)
  await panel.locator('.onboarding-card input[type="password"]').fill('nexus-smoke-synthetic-key')
  const testButton = panel.locator('.onboarding-test-connection button').first()
  await testButton.scrollIntoViewIfNeeded()
  await testButton.click()
  await panel.locator('.onboarding-test-connection .settings-test-result.is-success').waitFor()
  await nextGuideStep(panel)
  for (const checkbox of await panel.locator('.onboarding-toggle input[type="checkbox"]').all()) await checkbox.uncheck()
  await nextGuideStep(panel)
  for (const checkbox of await panel.locator('.onboarding-toggle input[type="checkbox"]').all()) await checkbox.uncheck()
  await finishRemainingGuide(panel)
  return panel.evaluate(() => {
    const onboarding = JSON.parse(localStorage.getItem('nexus:onboarding') || '{}')
    const settings = JSON.parse(localStorage.getItem('nexus:settings') || '{}')
    return {
      completedAt: onboarding.completedAt ?? null,
      firstConversationAt: onboarding.firstConversationAt ?? null,
      apiProviderId: settings.apiProviderId ?? null,
      model: settings.model ?? null,
      onboardingCardVisible: Boolean(document.querySelector('.onboarding-card')),
    }
  })
}

async function readPageState(page) {
  try {
    return await page.evaluate(() => ({
      visibility: document.visibilityState,
      live2dCanvasCount: document.querySelectorAll('.live2d-canvas canvas').length,
      live2dPhase: document.querySelector('.live2d-canvas')?.dataset?.live2dPhase ?? null,
      onboarding: Boolean(document.querySelector('.onboarding-card, .onboarding-backdrop')),
      chatSheet: Boolean(document.querySelector('.chat-sheet-v2')),
      settings: Boolean(document.querySelector('.settings-v2, .sd')),
    }))
  } catch {
    return { visibility: null }
  }
}

async function samplePhase(browser, child, phase, durationMs, samples, extra = {}, beforeSample = null) {
  const started = Date.now()
  const rows = []
  while (Date.now() - started < durationMs) {
    if (beforeSample) await beforeSample()
    const tree = sampleProcessTree(child.pid)
    const pages = []
    for (const page of pagesOf(browser)) {
      pages.push({
        url: pageUrl(page),
        view: viewOf(page),
        ...await readPageState(page),
      })
    }
    const row = {
      phase,
      tMs: Date.now() - started,
      pages,
      ...(tree ?? {}),
      ...extra,
    }
    samples.push(row)
    appendFileSync(path.join(OUT, 'samples.jsonl'), `${JSON.stringify(row)}\n`)
    rows.push(row)
    await wait(CONFIG.intervalMs)
  }
  return rows
}

function median(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (finite.length === 0) return null
  const middle = Math.floor(finite.length / 2)
  return finite.length % 2 === 0
    ? Math.round((finite[middle - 1] + finite[middle]) / 2)
    : finite[middle]
}

function maxOf(values) {
  const finite = values.filter(Number.isFinite)
  return finite.length ? Math.max(...finite) : null
}

function summarize(rows) {
  const mainRenderer = rows.map((row) => (
    (row.byRole?.main_or_other?.rssKb ?? 0) + (row.byRole?.renderer?.rssKb ?? 0)
  ))
  return {
    sampleCount: rows.length,
    processCounts: [...new Set(rows.map((row) => row.processCount).filter(Number.isFinite))],
    mainRendererRssKb: { median: median(mainRenderer), peak: maxOf(mainRenderer) },
    totalRssKb: { median: median(rows.map((row) => row.totalRssKb)), peak: maxOf(rows.map((row) => row.totalRssKb)) },
    byRoleMedianRssKb: Object.fromEntries(['main_or_other', 'renderer', 'gpu', 'helper', 'utility', 'plugin']
      .map((role) => [role, median(rows.map((row) => row.byRole?.[role]?.rssKb ?? 0))])
      .filter(([, value]) => Number.isFinite(value) && value > 0)),
  }
}

async function run() {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(path.join(OUT, 'samples.jsonl'), '')
  const selection = selectPackagedExecutable()
  if (!selection.ok || !selection.executable) throw new Error(selection.reason || 'no packaged executable')
  const executable = selection.executable
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'nexus-first-use-runtime-'))
  const port = process.env.FIRST_USE_RUNTIME_PORT
    ? Number.parseInt(process.env.FIRST_USE_RUNTIME_PORT, 10)
    : await allocatePort()
  const provider = await createFirstUseMockProvider()
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${userDataDir}`,
  ], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
  let browser = null
  let termination = null
  const samples = []
  const report = {
    schemaVersion: 1,
    kind: 'packaged-first-use-lifecycle',
    capturedAt: new Date().toISOString(),
    executable,
    releaseDir: selection.selection?.releaseDir ?? null,
    config: CONFIG,
    electronVersion: null,
    completion: null,
    hide: null,
    reopen: null,
    reopenAgain: null,
    chat: null,
    persistence: null,
    vaultFile: null,
    phases: {},
    samplesPath: path.join(OUT, 'samples.jsonl'),
    limitations: [
      'Onboarding is driven through the real packaged panel UI with a deterministic loopback provider; no localStorage seed is used for completion.',
      'The panel is hidden through the product closePanel API, not by CDP page.close.',
      'RSS is macOS ps RSS; shared Electron framework pages are counted per process.',
      '30s windows are steady-state observations, not long-term leak proof.',
    ],
    privacy: {
      userDataDirTemporary: true,
      readsUserStorage: false,
      syntheticProviderOnly: true,
    },
    childExit: null,
    logTail: null,
  }
  try {
    const httpReady = await waitForCdpHttp(port, CONFIG.cdpConnectTimeoutMs)
    if (!httpReady.ok) throw new Error(`CDP HTTP not ready: ${httpReady.error}`)
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5_000, noDefaults: true })
        break
      } catch { await wait(400) }
    }
    if (!browser) throw new Error('connectOverCDP failed')
    const first = await waitForPages(browser, CONFIG.uiTimeoutMs, (pages) => (
      pages.some((page) => viewOf(page) === 'pet') && pages.some((page) => viewOf(page) === 'panel')
    ))
    if (!first.ok) throw new Error('pet/panel pages did not appear')

    const pet = first.pages.find((page) => viewOf(page) === 'pet')
    const panel = first.pages.find((page) => viewOf(page) === 'panel')
    panel.setDefaultTimeout(CONFIG.uiTimeoutMs)
    report.electronVersion = await panel.evaluate(() => {
      const match = navigator.userAgent.match(/Electron\/([\d.]+)/)
      return match ? match[1] : null
    }).catch(() => null)

    const firstUseRows = await samplePhase(browser, child, 'first-use', 1000, samples)
    report.phases['first-use'] = summarize(firstUseRows)

    report.completion = await completeFirstUse(panel, provider)
    if (!report.completion.completedAt) throw new Error('onboarding completion marker missing after UI finish')
    const vaultPath = path.join(userDataDir, 'vault.json')
    report.vaultFile = existsSync(vaultPath)
      ? { exists: true, bytes: statSync(vaultPath).size }
      : { exists: false, bytes: 0 }

    // The completed panel may stay visible, auto-hide on blur, or retire on a
    // pristine first-use hide. Let the product settle before measuring hidden.
    await wait(1_000)
    await samplePhase(browser, child, 'post-completion', 2_000, samples)
    report.phases['post-completion'] = summarize(samples.filter((row) => row.phase === 'post-completion'))
    const panelBeforeHide = pagesOf(browser).find((page) => viewOf(page) === 'panel')
    report.hide = panelBeforeHide && !panelBeforeHide.isClosed()
      ? await panelBeforeHide.evaluate(() => {
        if (!window.desktopPet?.closePanel) return { ok: false, reason: 'closePanel unavailable' }
        return window.desktopPet.closePanel().then(() => ({ ok: true })).catch((error) => ({ ok: false, reason: String(error) }))
      }).catch((error) => ({ ok: false, reason: String(error) }))
      : { ok: true, reason: 'product_retired_before_close' }
    await wait(2_000)
    const hiddenRows = await samplePhase(browser, child, 'completed-hidden', CONFIG.hiddenMs, samples)
    report.phases['completed-hidden'] = summarize(hiddenRows)

    const reopenStarted = Date.now()
    await pet.evaluate(() => window.desktopPet.openPanel('chat'))
    const reopened = await waitForPages(browser, CONFIG.uiTimeoutMs, (pages) => (
      pages.find((page) => viewOf(page) === 'panel')
    ))
    if (!reopened.ok) throw new Error('panel did not reopen')
    const nextPanel = reopened.match
    nextPanel.setDefaultTimeout(CONFIG.uiTimeoutMs)
    await nextPanel.locator('.nexus-panel-v2').waitFor()
    const readyMs = Date.now() - reopenStarted
    const pageState = await readPageState(nextPanel)
    await wait(500)
    report.reopen = {
      elapsedMs: readyMs,
      readyMs,
      settledMs: Date.now() - reopenStarted,
      pageAppearedMs: reopened.elapsedMs,
      url: pageUrl(nextPanel),
      ...pageState,
      onboardingCardVisible: await nextPanel.locator('.onboarding-card').count(),
    }

    const ensurePanelVisible = async () => {
      const current = pagesOf(browser).find((page) => viewOf(page) === 'panel')
      if (!current) return
      const state = await readPageState(current)
      if (state.visibility === 'visible') return
      await pet.evaluate(() => window.desktopPet.openPanel('chat'))
      await wait(300)
    }
    const openRows = await samplePhase(
      browser,
      child,
      'panel-open',
      CONFIG.openMs,
      samples,
      {},
      ensurePanelVisible,
    )
    report.phases['panel-open'] = summarize(openRows)

    // Exercise the ordinary chat path after the reopen. This runs after the
    // completed-hidden measurement so the measured steady state stays pristine.
    await ensurePanelVisible()
    report.chat = { marker: await sendLifecycleChat(nextPanel), ok: true }
    report.persistence = await nextPanel.evaluate(() => {
      const onboarding = JSON.parse(localStorage.getItem('nexus:onboarding') || '{}')
      const settings = JSON.parse(localStorage.getItem('nexus:settings') || '{}')
      return {
        completedAt: onboarding.completedAt ?? null,
        apiProviderId: settings.apiProviderId ?? null,
        model: settings.model ?? null,
      }
    })

    await nextPanel.evaluate(() => window.desktopPet.closePanel())
    await wait(1_500)
    const hiddenAgainRows = await samplePhase(browser, child, 'completed-hidden-again', 8_000, samples)
    report.phases['completed-hidden-again'] = summarize(hiddenAgainRows)

    // Ordinary hide/reopen after real use must keep the same panel state.
    const secondReopenStarted = Date.now()
    await pet.evaluate(() => window.desktopPet.openPanel('chat'))
    const reopenedAgain = await waitForPages(browser, CONFIG.uiTimeoutMs, (pages) => (
      pages.find((page) => viewOf(page) === 'panel')
    ))
    if (!reopenedAgain.ok) throw new Error('used panel did not reopen')
    const finalPanel = reopenedAgain.match
    finalPanel.setDefaultTimeout(CONFIG.uiTimeoutMs)
    await finalPanel.locator('.nexus-panel-v2').waitFor()
    const finalReadyMs = Date.now() - secondReopenStarted
    await ensureChatOpen(finalPanel)
    const userMessages = await finalPanel
      .locator('.chat-sheet-v2__turn[data-role="user"] .chat-sheet-v2__message')
      .allTextContents()
    report.reopenAgain = {
      readyMs: finalReadyMs,
      chatMarkerPresent: userMessages.some((text) => text.includes(report.chat.marker)),
      url: pageUrl(finalPanel),
      ...await readPageState(finalPanel),
    }

    await browser.close()
    browser = null
    termination = terminateTree(child.pid)
    try { if (child.exitCode == null) child.kill('SIGKILL') } catch { /* ignore */ }
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), wait(2_000)])
    report.childExit = {
      code: child.exitCode,
      signal: child.signalCode,
      terminatedByHarness: Boolean(termination?.terminatedByHarness),
      method: termination?.method ?? null,
    }
    report.logTail = { stdout: stdout.slice(-4000), stderr: stderr.slice(-4000) }
    writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write([
      'Packaged first-use lifecycle',
      `- electron: ${report.electronVersion}`,
      `- complete: ${report.completion?.completedAt}`,
      `- completed-hidden main+renderer median/peak: ${report.phases['completed-hidden']?.mainRendererRssKb.median}/${report.phases['completed-hidden']?.mainRendererRssKb.peak} KB`,
      `- completed-hidden processes: ${report.phases['completed-hidden']?.processCounts.join(',')}`,
      `- post-completion main+renderer peak: ${report.phases['post-completion']?.mainRendererRssKb.peak} KB`,
      `- panel-open main+renderer peak: ${report.phases['panel-open']?.mainRendererRssKb.peak} KB`,
      `- reopen ms: ${report.reopen?.elapsedMs}`,
      `- ordinary reopen ms: ${report.reopenAgain?.readyMs}`,
      `- ordinary reopen chat state: ${report.reopenAgain?.chatMarkerPresent}`,
      `- report: ${path.join(OUT, 'report.json')}`,
    ].join('\n') + '\n')
    return 0
  } finally {
    try { await browser?.close() } catch { /* ignore */ }
    if (!termination) {
      terminateTree(child.pid)
      try { if (child.exitCode == null) child.kill('SIGKILL') } catch { /* ignore */ }
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), wait(2_000)])
    }
    await provider.close()
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

run().then((code) => process.exit(code ?? 0)).catch((error) => {
  process.stderr.write(`[packaged-first-use-lifecycle] ${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(1)
})
