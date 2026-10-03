#!/usr/bin/env node
/**
 * Real Electron portrait settings smoke, intentionally not a first-use test.
 * A private profile has completed onboarding; UI actions traverse the normal
 * panel/settings/preload route. Transport/success fixtures do not validate model
 * downloading or inference quality; native cancellation and image rejection do.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import sharp from 'sharp'
import { describePortraitModel, selectPortraitModels } from '../shared/portraitModels.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT = path.resolve(ROOT, process.env.PORTRAIT_FLOW_SMOKE_OUTPUT_DIR || 'output/portrait-flow-smoke')
const TIMEOUT = Number(process.env.PORTRAIT_FLOW_SMOKE_TIMEOUT_MS || 30000)
const LANGUAGES = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko']
const results = []
const screenshots = []
const ipcEvidence = []
let application = null
let activePage = null
let profile = null

async function record(label, run) {
  const evidence = await run()
  results.push({ label, status: 'passed', ...(evidence ? { evidence } : {}) })
  console.log(`[portrait-flow-smoke] passed: ${label}`)
}

async function screenshot(page, name) {
  if (await page.locator('.settings-v2').isVisible()) {
    await page.waitForFunction(() => {
      let element = document.querySelector('.settings-v2')
      while (element) {
        const style = getComputedStyle(element)
        if (Number(style.opacity) < 0.99 || style.visibility === 'hidden') return false
        element = element.parentElement
      }
      return true
    })
  }
  await page.screenshot({ path: path.join(OUTPUT, `${name}.png`) })
  screenshots.push({ file: `${name}.png`, ...await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio })) })
}

async function readFixture() {
  return application.evaluate(() => {
    const { installed, statusCalls, downloadCalls, generateCalls, nativeCancelCalls, nativeRejectCalls, rejectedReason } = globalThis.__nexusPortraitFlowSmoke
    return { installed, statusCalls, downloadCalls, generateCalls, nativeCancelCalls, nativeRejectCalls, rejectedReason }
  })
}

async function finishGeneration() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const finished = await application.evaluate(() => {
      if (!globalThis.__nexusPortraitFlowSmoke.releaseGeneration) return false
      globalThis.__nexusPortraitFlowSmoke.releaseGeneration()
      return true
    })
    if (finished) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('The UI did not invoke the expected mock generation')
}

async function launch(language) {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error('Port 47822 is occupied; stop another Nexus development instance before the isolated smoke')))
    server.listen(47822, '127.0.0.1', resolve)
  })
  await new Promise((resolve) => server.close(resolve))
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-portrait-flow-'))
  await fs.writeFile(path.join(profile, '.portrait-flow-smoke-profile'), 'UI smoke only\n')
  await sharp({ create: { width: 16, height: 16, channels: 4, background: '#e8c8a4' } }).png().toFile(path.join(profile, 'synthetic-small.png'))
  const previewSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="384"><path fill="#7770b5" d="M52 384v-62a108 108 0 0 1 216 0v62z"/><ellipse cx="160" cy="150" rx="93" ry="110" fill="#544964"/><ellipse cx="160" cy="168" rx="68" ry="83" fill="#f3cfae"/><path fill="#544964" d="M86 132q10-126 146-6l-58-27-25 48-18-37z"/><circle cx="137" cy="169" r="5" fill="#42374b"/><circle cx="183" cy="169" r="5" fill="#42374b"/><path d="M145 202q15 14 30 0" fill="none" stroke="#865267" stroke-width="4"/></svg>'
  await sharp(Buffer.from(previewSvg)).png().toFile(path.join(profile, 'synthetic-preview.png'))
  const env = { ...process.env, NEXUS_PORTRAIT_FLOW_SMOKE_PROFILE: profile,
    HOME: path.join(profile, 'home'), USERPROFILE: path.join(profile, 'home') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.SMOKE_TEST
  delete env.DESKTOP_PET_USE_DEV_SERVER
  delete env.CODEX_HOME
  application = await electron.launch({ args: ['--no-sandbox', path.join(ROOT, 'scripts', 'portrait-flow-smoke-bootstrap.cjs')], cwd: profile, env, timeout: TIMEOUT })
  application.process().stderr.on('data', (data) => process.stderr.write(data))
  const pet = await application.firstWindow({ timeout: TIMEOUT })
  activePage = pet
  pet.setDefaultTimeout(TIMEOUT)
  await pet.waitForURL(/view=pet/)
  // This fixture only verifies settings; completion is explicit test setup and
  // must never be reported as evidence of successful first-use onboarding.
  await application.context().addInitScript((uiLanguage) => {
    localStorage.setItem('nexus:onboarding', JSON.stringify({ completedAt: '2026-01-01T00:00:00.000Z', firstConversationAt: '2026-01-01T00:02:00.000Z' }))
    const saved = JSON.parse(localStorage.getItem('nexus:settings') || '{}')
    localStorage.setItem('nexus:settings', JSON.stringify({ ...saved, uiLanguage, speechInputEnabled: false, speechOutputEnabled: false }))
    sessionStorage.setItem('nexus:startup-greeting-shown', '1')
    sessionStorage.setItem('nexus.modelSetup.dismissedUntilRestart', '1')
  }, language)
  await pet.reload()
  await pet.locator('.nexus-companion-v2__utility-trigger').waitFor()
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((entry) => entry.webContents.getURL().includes('view=pet'))
    window.setIgnoreMouseEvents(false)
    window.setSize(1000, 800)
  })
  await pet.locator('.nexus-companion-v2__utility-trigger').click()
  await pet.locator('.nexus-companion-v2__utility-item').first().click()
  let panel = application.windows().find((page) => page !== pet)
  if (!panel) panel = await application.waitForEvent('window', { timeout: TIMEOUT })
  activePage = panel
  panel.setDefaultTimeout(TIMEOUT)
  await panel.waitForURL(/view=panel/)
  await panel.locator('.nexus-panel-v2').waitFor()
  await panel.locator('.chat-sheet-v2').waitFor()
  await resize(1100, 800)
  return panel
}

async function resize(width, height) {
  await application.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows().find((entry) => entry.webContents.getURL().includes('view=panel'))
    window.setSize(size.width, size.height)
    window.focus()
  }, { width, height })
}

async function quitNormally() {
  ipcEvidence.push(await readFixture())
  const closed = application.waitForEvent('close', { timeout: TIMEOUT })
  await application.evaluate(({ app }) => { app.quit() })
  await closed
  application = null
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  profile = null
}

async function openPortrait(page) {
  if (await page.locator('.chat-sheet-v2').isVisible()) {
    await page.locator('.chat-sheet-v2__back').click()
    await page.locator('.chat-sheet-v2').waitFor({ state: 'hidden' })
  }
  if (!await page.locator('.settings-v2').isVisible()) {
    await page.locator('.nexus-panel-v2__utility').click()
    await page.locator('.nexus-panel-v2__menu button').nth(1).click()
  }
  if (await page.locator('.settings-v2').getAttribute('data-settings-v2-destination') !== 'companion') {
    if (await page.locator('.settings-v2__home-card[data-focus-return-group="companion"]').isVisible()) {
      await page.locator('.settings-v2__home-card[data-focus-return-group="companion"]').click()
    } else {
      await page.locator('.settings-v2__nav-item').nth(1).click()
    }
  }
  await page.getByTestId('portrait-flow-disclosure').waitFor()
}

async function expand(page) {
  const disclosure = page.getByTestId('portrait-flow-disclosure')
  if (!await disclosure.evaluate((element) => element.open)) {
    const before = (await readFixture()).statusCalls
    await disclosure.locator('summary').click()
    // Native details toggle is queued after the click. A retained ready state
    // can otherwise make the button look idle before the new refresh begins.
    for (let attempt = 0; attempt < 100 && (await readFixture()).statusCalls <= before; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.ok((await readFixture()).statusCalls > before, 'Opening portrait setup must refresh model status')
  }
  await page.waitForFunction(() => !document.querySelector('[data-testid="portrait-model-refresh"]').disabled)
}

async function petState(page) {
  return page.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem('nexus:settings') || '{}').petModelId ?? null,
    draft: document.querySelector('.settings-v3-chat select')?.value,
  }))
}

async function waitForPreview(page) {
  await page.getByTestId('portrait-draft-preview').waitFor()
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-testid="portrait-preview-image"]')
    return image?.complete && image.naturalWidth > 0
  })
  assert.equal(await page.getByTestId('portrait-draft-preview').locator('img').count(), 1, 'Preview must transform one union texture, not individual layers')
  assert.equal(await page.getByTestId('portrait-preview-image').getAttribute('data-moving'), 'false')
}

async function assertMoving(page, moving) {
  await page.waitForFunction((expected) => document.querySelector('[data-testid="portrait-preview-image"]')?.getAttribute('data-moving') === String(expected), moving, { polling: 50 })
  const state = await page.getByTestId('portrait-preview-image').evaluate((element) => ({
    animation: getComputedStyle(element).animationName,
    transform: getComputedStyle(element).transform,
  }))
  assert.equal(state.animation === 'none', !moving)
  if (moving) {
    await page.waitForTimeout(450)
    const nextTransform = await page.getByTestId('portrait-preview-image').evaluate((element) => getComputedStyle(element).transform)
    assert.notEqual(nextTransform, state.transform, 'The single preview texture must actually animate after an explicit start')
  }
  return state
}

async function assertLayout(page) {
  const metrics = await page.getByTestId('portrait-flow-disclosure').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const body = element.querySelector('.settings-v3-disclosure__body')
    return { width: innerWidth, height: innerHeight, left: rect.left, right: rect.right,
      disclosureOverflow: element.scrollWidth - element.clientWidth,
      bodyOverflow: body.scrollWidth - body.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - innerWidth }
  })
  assert.ok(metrics.left >= -1 && metrics.right <= metrics.width + 1, JSON.stringify(metrics))
  assert.ok(metrics.disclosureOverflow <= 2 && metrics.bodyOverflow <= 2 && metrics.pageOverflow <= 2, JSON.stringify(metrics))
  return metrics
}

async function assertDisclosure(page) {
  const disclosure = page.getByTestId('portrait-flow-disclosure')
  const text = await disclosure.innerText()
  assert.ok(!text.includes('settings.chat.portrait_flow.'), 'All portrait copy must be localized')
  for (const model of selectPortraitModels().map(describePortraitModel)) {
    const row = disclosure.locator(`[data-model-id="${model.id}"]`)
    assert.equal(await row.locator('a').first().getAttribute('href'), model.sourceUrl)
    assert.equal(await row.locator('a').last().getAttribute('href'), model.licenseUrl)
    assert.ok((await row.innerText()).includes(model.licenseSpdx))
  }
  const megabytes = Math.ceil(selectPortraitModels().reduce((sum, model) => sum + model.sizeBytes, 0) / 1_000_000)
  assert.ok(text.includes(String(megabytes)), 'The expected total model size must be disclosed')
  assert.ok((await disclosure.locator('.settings-v3-notice').first().innerText()).trim().length > 20)
  assert.equal(await page.getByTestId('portrait-model-consent').isChecked(), false)
  assert.equal(await page.getByTestId('portrait-model-download').isDisabled(), true)
  return { modelCount: selectPortraitModels().length, downloadMegabytes: megabytes }
}

async function coreChecks(page) {
  await record('collapsed settings does not query models or download', async () => {
    await openPortrait(page)
    assert.equal(await page.getByTestId('portrait-flow-disclosure').evaluate((element) => element.open), false)
    assert.equal((await readFixture()).statusCalls, 0)
    assert.equal((await readFixture()).downloadCalls, 0)
    await screenshot(page, '01-collapsed')
  })
  await record('expanded consent discloses model size, sources, licenses and local draft limits', async () => {
    await expand(page)
    const evidence = await assertDisclosure(page)
    const text = await page.getByTestId('portrait-flow-disclosure').innerText()
    assert.match(text, /computer|local/i)
    assert.match(text, /training/i)
    assert.match(text, /draft/i)
    await screenshot(page, '02-consent-before-download')
    return evidence
  })
  await record('explicit consent shows download progress and injected failure is retryable', async () => {
    await page.getByTestId('portrait-model-consent').check()
    await page.getByTestId('portrait-model-download').click()
    await page.getByTestId('portrait-model-progress').waitFor()
    assert.equal(await page.getByTestId('portrait-model-progress').getAttribute('value'), '25')
    assert.equal(await page.getByTestId('portrait-model-download').isDisabled(), true)
    await screenshot(page, '03-download-progress')
    await application.evaluate(() => globalThis.__nexusPortraitFlowSmoke.releaseDownload(false))
    await page.getByTestId('portrait-flow-disclosure').locator('[role="alert"]').waitFor()
    assert.equal((await readFixture()).downloadCalls, 1)
    await screenshot(page, '04-download-failure')
  })
  await record('download retry succeeds and rapid repeated activation remains one request', async () => {
    await page.getByTestId('portrait-model-download').evaluate((button) => { button.click(); button.click() })
    await page.getByTestId('portrait-model-progress').waitFor()
    assert.equal((await readFixture()).downloadCalls, 2)
    await application.evaluate(() => globalThis.__nexusPortraitFlowSmoke.releaseDownload(true))
    await page.waitForFunction(() => !document.querySelector('[data-testid="portrait-draft-generate"]').disabled)
    assert.equal(await page.getByTestId('portrait-model-download').count(), 0)
    assert.equal((await readFixture()).installed, true)
  })
  await record('close and reopen refreshes installation without a repeated download', async () => {
    const before = await readFixture()
    await page.locator('.settings-v2__close').click()
    await page.locator('.settings-v2').waitFor({ state: 'hidden' })
    await openPortrait(page)
    await expand(page)
    assert.ok((await readFixture()).statusCalls > before.statusCalls)
    assert.equal((await readFixture()).downloadCalls, before.downloadCalls)
    assert.equal(await page.getByTestId('portrait-model-download').count(), 0)
  })
  const beforePet = await petState(page)
  await record('native picker cancel returns visible feedback without changing the selected pet', async () => {
    await page.getByTestId('portrait-draft-generate').click()
    await page.getByTestId('portrait-draft-result').waitFor()
    assert.equal((await readFixture()).nativeCancelCalls, 1)
    assert.deepEqual(await petState(page), beforePet)
    await screenshot(page, '05-native-cancel')
  })
  await record('synthetic small image is rejected by the real production image gate', async () => {
    await application.evaluate(() => { globalThis.__nexusPortraitFlowSmoke.pickerMode = 'small' })
    await page.getByTestId('portrait-draft-generate').click()
    await page.getByTestId('portrait-draft-result').locator('[role="alert"]').waitFor()
    assert.equal((await readFixture()).nativeRejectCalls, 1)
    assert.equal((await readFixture()).rejectedReason, 'too_small')
    assert.deepEqual(await petState(page), beforePet)
    await screenshot(page, '06-real-small-image-rejection')
  })
  await record('mock accepted draft is announced once and does not install or select a pet', async () => {
    await application.evaluate(() => { globalThis.__nexusPortraitFlowSmoke.mockGeneration = true })
    await page.getByTestId('portrait-draft-generate').evaluate((button) => { button.click(); button.click() })
    await page.waitForFunction(() => document.querySelector('[data-testid="portrait-draft-generate"]').disabled)
    assert.equal((await readFixture()).generateCalls, 3)
    await finishGeneration()
    await page.getByTestId('portrait-draft-result').locator('[role="status"]').waitFor()
    await waitForPreview(page)
    assert.deepEqual(await petState(page), beforePet)
    await screenshot(page, '07-mock-draft-success')
  })
  await record('single-texture preview starts only on request, respects motion/visibility settings and clears on close', async () => {
    const before = await petState(page)
    await page.getByTestId('portrait-preview-motion').click()
    await assertMoving(page, true)
    await page.getByTestId('portrait-draft-preview').scrollIntoViewIfNeeded()
    await screenshot(page, '12-preview-moving-desktop')
    await page.getByTestId('portrait-preview-motion').click()
    await assertMoving(page, false)
    await page.getByTestId('portrait-preview-motion').click()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await assertMoving(page, false)
    assert.equal(await page.getByTestId('portrait-preview-motion').isDisabled(), true)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await assertMoving(page, true)
    // The pinned Playwright version forces visibility on its own CDP session;
    // a new CDP session cannot undo it. Remove only that automation override
    // before observing native hide/show, and fail if its internal API changes.
    const automationSession = page._connection?.toImpl?.(page)?.delegate?._mainFrameSession?._client
    assert.ok(automationSession?.send, 'Unsupported Playwright internals: native visibility verification requires the original CDP session')
    await automationSession.send('Emulation.setFocusEmulationEnabled', { enabled: false })
    const hiddenWindow = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((entry) => entry.webContents.getURL().includes('view=panel'))
      window.hide()
      return { visible: window.isVisible(), minimized: window.isMinimized() }
    })
    await new Promise((resolve) => setTimeout(resolve, 500))
    const hiddenRenderer = await page.evaluate(() => {
      const image = document.querySelector('[data-testid="portrait-preview-image"]')
      return { hidden: document.hidden, visibilityState: document.visibilityState, moving: image?.dataset.moving,
        animation: image ? getComputedStyle(image).animationName : null }
    })
    console.log('[portrait-flow-smoke] hidden lifecycle:', JSON.stringify({ window: hiddenWindow, renderer: hiddenRenderer }))
    // Hidden windows suspend requestAnimationFrame, including Playwright's
    // default polling loop. Timer polling still observes the real lifecycle.
    await page.waitForFunction(() => document.hidden, null, { polling: 50 })
    await assertMoving(page, false)
    await application.evaluate(({ BrowserWindow }) => {
      const panel = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('view=panel'))
      panel.show(); panel.focus()
    })
    await page.waitForFunction(() => !document.hidden)
    await assertMoving(page, true)
    await page.getByTestId('portrait-flow-disclosure').locator('summary').click()
    await page.getByTestId('portrait-draft-preview').waitFor({ state: 'hidden' })
    await expand(page)
    assert.equal(await page.getByTestId('portrait-draft-preview').count(), 0)
    await page.getByTestId('portrait-draft-generate').click()
    await finishGeneration()
    await waitForPreview(page)
    await application.evaluate(() => { globalThis.__nexusPortraitFlowSmoke.mockGeneration = false; globalThis.__nexusPortraitFlowSmoke.pickerMode = 'cancel' })
    await page.getByTestId('portrait-draft-generate').click()
    await page.getByTestId('portrait-draft-result').locator('[role="status"]').waitFor()
    assert.equal(await page.getByTestId('portrait-draft-preview').count(), 0, 'Native cancellation must clear previously returned pixels')
    await application.evaluate(() => { globalThis.__nexusPortraitFlowSmoke.mockGeneration = true })
    await page.getByTestId('portrait-draft-generate').click()
    await finishGeneration()
    await waitForPreview(page)
    await page.locator('.settings-v2__close').click()
    await page.locator('.settings-v2').waitFor({ state: 'hidden' })
    await openPortrait(page)
    await expand(page)
    assert.equal(await page.getByTestId('portrait-draft-preview').count(), 0, 'Closed settings must not revive retained pixels or motion')
    assert.deepEqual(await petState(page), before)
    return { nativeWindowAfterHide: hiddenWindow, rendererAfterHide: hiddenRenderer }
  })
}

async function run() {
  await fs.mkdir(OUTPUT, { recursive: true })
  await fs.access(path.join(ROOT, 'dist', 'index.html'))
  await coreChecks(await launch('en-US'))
  await quitNormally()
  for (const language of LANGUAGES) {
    for (const [viewport, width, height] of [['desktop', 1100, 800], ['narrow', 400, 640]]) {
      // A separate private lifecycle keeps earlier accepted-draft notices out
      // of consent screenshots and exercises each locale from a closed setup.
      const page = await launch(language)
      await record(`${language}/${viewport}: localized consent and draft feedback fit the real settings viewport`, async () => {
        await resize(width, height)
        await openPortrait(page)
        const disclosure = page.getByTestId('portrait-flow-disclosure')
        if (await disclosure.evaluate((element) => element.open)) await disclosure.locator('summary').click()
        await application.evaluate(() => { globalThis.__nexusPortraitFlowSmoke.installed = false })
        await expand(page)
        await assertDisclosure(page)
        await disclosure.locator('summary').scrollIntoViewIfNeeded()
        await screenshot(page, `08-consent-${language}-${viewport}`)
        const metrics = await assertLayout(page)
        await page.getByTestId('portrait-model-consent').scrollIntoViewIfNeeded()
        await screenshot(page, `09-consent-action-${language}-${viewport}`)
        await application.evaluate(() => { globalThis.__nexusPortraitFlowSmoke.installed = true; globalThis.__nexusPortraitFlowSmoke.mockGeneration = true })
        await page.getByTestId('portrait-model-refresh').click()
        await page.waitForFunction(() => !document.querySelector('[data-testid="portrait-draft-generate"]').disabled)
        const before = await petState(page)
        await page.getByTestId('portrait-draft-generate').click()
        await finishGeneration()
        await page.getByTestId('portrait-draft-result').locator('[role="status"]').waitFor()
        await waitForPreview(page)
        await page.getByTestId('portrait-draft-preview').scrollIntoViewIfNeeded()
        await screenshot(page, `10-draft-result-${language}-${viewport}`)
        await page.getByTestId('portrait-preview-motion').click()
        await assertMoving(page, true)
        await screenshot(page, `12-preview-moving-${language}-${viewport}`)
        await page.getByTestId('portrait-preview-motion').click()
        await assertMoving(page, false)
        assert.deepEqual(await petState(page), before)
        assert.ok(!(await disclosure.innerText()).includes('settings.chat.portrait_flow.'))
        await application.evaluate(() => {
          globalThis.__nexusPortraitFlowSmoke.mockGeneration = false
          globalThis.__nexusPortraitFlowSmoke.pickerMode = 'small'
        })
        await page.getByTestId('portrait-draft-generate').click()
        await page.getByTestId('portrait-draft-result').locator('[role="alert"]').waitFor()
        assert.equal(await page.getByTestId('portrait-draft-preview').count(), 0, 'Rejected selection must clear the previous preview')
        assert.equal((await readFixture()).rejectedReason, 'too_small')
        await page.getByTestId('portrait-draft-result').scrollIntoViewIfNeeded()
        await screenshot(page, `11-native-rejection-${language}-${viewport}`)
        assert.deepEqual(await petState(page), before)
        assert.ok(!(await disclosure.innerText()).includes('settings.pet.portrait_gate.'))
        await assertLayout(page)
        if (viewport === 'narrow') assert.ok(metrics.width <= 600)
        return { requested: { width, height }, actual: metrics, mockTransport: true, mockGeneration: true }
      })
      await quitNormally()
    }
  }
}

try {
  await run()
} catch (error) {
  results.push({ label: 'smoke run', status: 'failed', error: error instanceof Error ? error.message : String(error) })
  console.error('[portrait-flow-smoke] failed:', error)
  if (application) await application.evaluate(({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('view=panel'))
    panel?.show()
  }).catch(() => {})
  if (activePage && !activePage.isClosed()) await screenshot(activePage, 'failure').catch(() => {})
  process.exitCode = 1
} finally {
  if (application) await quitNormally().catch(async () => { if (application) await application.close().catch(() => {}) })
  await fs.mkdir(OUTPUT, { recursive: true })
  await fs.writeFile(path.join(OUTPUT, 'results.json'), JSON.stringify({
    passed: results.filter((entry) => entry.status === 'passed').length,
    failed: results.filter((entry) => entry.status === 'failed').length,
    mockTransport: true,
    mockGeneration: true,
    results, screenshots, ipcEvidence,
    boundaries: ['Onboarding completion is seeded: this is not a first-use test', 'Real Electron main/preload/settings and sender capability checks', 'Download transport and accepted drafts are deterministic IPC fixtures, not real inference or release-download acceptance', 'Native cancel and synthetic 16x16 rejection use the production generation handler', 'Isolated temporary profile/home/session/vault; no real images, credentials, external network, sidecars or OS permission prompts'],
  }, null, 2))
  if (profile) await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
