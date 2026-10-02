#!/usr/bin/env node
/**
 * Real Electron first-use smoke with a deterministic loopback provider. All
 * configuration, sending and retry actions go through the visible UI. Only the
 * test bootstrap isolates host services and injects one settings-save rejection.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { createFirstUseMockProvider } from './lib/first-use-mock-provider.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT = path.resolve(ROOT, process.env.FIRST_USE_SMOKE_OUTPUT_DIR || 'output/first-use-smoke')
const TIMEOUT = Number(process.env.FIRST_USE_SMOKE_TIMEOUT_MS || 30000)
const FIRST_PROMPT = 'First use deterministic message 731.'
const RETRY_PROMPT = 'Retry deterministic message 947.'
const FAKE_KEY = 'nexus-smoke-synthetic-key'
const LANGUAGES = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko']
const results = []
const screenshots = []
let application = null
let provider = null
let profile = null
let activePage = null
let firstOrigin = null

async function checkRendererPort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error('Port 47822 is occupied; close the other Nexus development instance before this isolated smoke')))
    server.listen(47822, '127.0.0.1', resolve)
  })
  await new Promise((resolve) => server.close(resolve))
}

async function record(label, run) {
  const evidence = await run()
  results.push({ label, status: 'passed', ...(evidence ? { evidence } : {}) })
  console.log(`[first-use-smoke] passed: ${label}`)
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUTPUT, `${name}.png`) })
  screenshots.push({ file: `${name}.png`, ...await page.evaluate(() => ({
    width: innerWidth, height: innerHeight, devicePixelRatio,
  })) })
}

async function launch() {
  await checkRendererPort()
  const env = { ...process.env, NEXUS_FIRST_USE_SMOKE_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.SMOKE_TEST
  delete env.DESKTOP_PET_USE_DEV_SERVER
  delete env.CODEX_HOME
  application = await electron.launch({
    args: ['--no-sandbox', path.join(ROOT, 'scripts', 'first-use-smoke-bootstrap.cjs')],
    cwd: profile,
    env,
    timeout: TIMEOUT,
  })
  application.process().stderr.on('data', (data) => process.stderr.write(data))
  const page = await application.firstWindow({ timeout: TIMEOUT })
  page.setDefaultTimeout(TIMEOUT)
  activePage = page
  await page.waitForURL(/view=pet/)
  const origin = new URL(page.url()).origin
  if (firstOrigin) assert.equal(origin, firstOrigin, 'Restart must retain the same localStorage origin')
  else firstOrigin = origin
  await application.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows().filter((entry) => entry.webContents.getURL().includes('view=pet'))) {
      window.setIgnoreMouseEvents(false)
      window.setSize(1000, 800)
    }
  })
  return page
}

async function quitNormally() {
  const closed = application.waitForEvent('close', { timeout: TIMEOUT })
  await application.evaluate(({ app }) => { app.quit() })
  await closed
  application = null
}

async function dismissOptionalSetup(page) {
  const dismiss = page.locator('.model-setup-card__header button')
  if (await dismiss.isVisible()) await dismiss.click()
}

async function nextGuideStep(page) {
  const progress = page.locator('.onboarding-disclosure__progress')
  const before = await progress.innerText()
  await page.locator('.onboarding-card__actions .primary-button').click()
  await page.waitForFunction((old) => {
    const current = document.querySelector('.onboarding-disclosure__progress')
    return !current || current.textContent.trim() !== old
  }, before)
}

async function finishRemainingGuide(page) {
  for (let count = 0; count < 6 && await page.locator('.onboarding-card').isVisible(); count += 1) {
    await nextGuideStep(page)
  }
  await page.locator('.onboarding-card').waitFor({ state: 'hidden' })
}

async function readSavedModel(page) {
  return page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('nexus:settings') || '{}')
    return {
      apiProviderId: saved.apiProviderId,
      apiBaseUrl: saved.apiBaseUrl,
      model: saved.model,
      uiLanguage: saved.uiLanguage,
      speechInputEnabled: saved.speechInputEnabled,
      speechOutputEnabled: saved.speechOutputEnabled,
    }
  })
}

async function openPanel(petPage) {
  await petPage.locator('.nexus-companion-v2__utility-trigger').click()
  await petPage.locator('.nexus-companion-v2__utility-item').first().click()
  return waitForPanel(petPage)
}

async function waitForPanel(petPage) {
  let panel = application.windows().find((page) => page !== petPage)
  if (!panel) panel = await application.waitForEvent('window', { timeout: TIMEOUT })
  panel.setDefaultTimeout(TIMEOUT)
  activePage = panel
  await panel.waitForURL(/view=panel/)
  const productOpenedPanel = await application.evaluate(async ({ BrowserWindow }, timeout) => {
    const panelWindow = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('view=panel'))
    if (!panelWindow) return false
    if (panelWindow.isVisible()) return true
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeout)
      panelWindow.once('show', () => {
        clearTimeout(timer)
        resolve(panelWindow.isVisible())
      })
    })
  }, TIMEOUT)
  assert.equal(productOpenedPanel, true, 'The product must show the panel before test geometry or focus changes')
  await application.evaluate(({ BrowserWindow }) => {
    const panelWindow = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('view=panel'))
    panelWindow.setSize(1100, 800)
    panelWindow.focus()
  })
  await panel.locator('.nexus-panel-v2').waitFor()
  await dismissOptionalSetup(panel)
  return panel
}

async function openChat(page) {
  await dismissOptionalSetup(page)
  if (!await page.locator('.chat-sheet-v2').isVisible()) {
    await page.locator('.nexus-panel-v2__utility').click()
    await page.locator('.nexus-panel-v2__menu button').first().click()
  }
  const input = page.locator('.chat-sheet-v2__input')
  if (!await input.isVisible()) await page.locator('.chat-sheet-v2__composer-toggle').click()
  await input.waitFor()
}

async function sendMessage(page, content) {
  await openChat(page)
  await page.locator('.chat-sheet-v2__input').fill(content)
  await page.locator('.chat-sheet-v2__send').click()
}

async function assertReply(page, content) {
  const response = `NEXUS_MOCK_REPLY: ${content}`
  await page.locator('.chat-sheet-v2__turn[data-role="assistant"] .chat-sheet-v2__message')
    .filter({ hasText: response }).waitFor()
  assert.ok(provider.requests.some((request) => request.stream && request.userMessage.includes(content) && request.status === 200), 'A real submitted user message must reach the provider')
  const texts = await page.locator('.chat-sheet-v2__turn[data-role="assistant"] .chat-sheet-v2__message').allTextContents()
  assert.ok(texts.includes(response), 'The visible answer must be the mock response, not the onboarding greeting')
  await page.waitForFunction(() => !document.querySelector('.chat-sheet-v2__send--cancel'))
}

async function openSettings(page) {
  if (await page.locator('.chat-sheet-v2').isVisible()) await page.locator('.chat-sheet-v2__back').click()
  if (!await page.locator('.settings-v2').isVisible()) {
    await page.locator('.nexus-panel-v2__utility').click()
    await page.locator('.nexus-panel-v2__menu button').nth(1).click()
  }
  await page.locator('.settings-v2').waitFor()
  if (await page.locator('.settings-v2').getAttribute('data-settings-v2-destination') !== 'home') {
    const mobileBack = page.locator('.settings-v2__mobile-back')
    if (await mobileBack.isVisible()) await mobileBack.click()
    else await page.locator('.settings-v2__nav-item').first().click()
  }
}

async function openModelSettings(page) {
  await openSettings(page)
  await page.locator('.settings-v2__home-card[data-focus-return-group="advanced"]').click()
  await page.locator('.settings-v2[data-settings-v2-destination="advanced"]').waitFor()
  await page.getByLabel('Provider', { exact: true }).waitFor()
}

async function openGuideFromSettings(page) {
  await openSettings(page)
  const entry = page.locator('.settings-v2__home-card:not([data-focus-return-group])')
  assert.ok((await entry.getAttribute('aria-label'))?.trim(), 'Guide entry must have a localized accessible name')
  await entry.click()
  await page.locator('.onboarding-card').waitFor()
  assert.match(await page.locator('.onboarding-disclosure__progress').innerText(), /^1\s*\/\s*6/)
}

async function run() {
  await fs.access(path.join(ROOT, 'dist', 'index.html'))
  await fs.mkdir(OUTPUT, { recursive: true })
  await fs.rm(path.join(OUTPUT, 'failure.png'), { force: true })
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-first-use-smoke-'))
  await fs.writeFile(path.join(profile, '.first-use-smoke-profile'), 'isolated synthetic test profile\n')
  provider = await createFirstUseMockProvider()
  let petPage = await launch()
  let panel = await waitForPanel(petPage)

  await record('clean default startup routes first-use guide to panel without seeded completion or conversation', async () => {
    await panel.locator('.onboarding-card').waitFor()
    assert.equal(await petPage.locator('.onboarding-card').count(), 0, 'The restricted pet surface must not expose an unsavable guide')
    const onboarding = await panel.evaluate(() => JSON.parse(localStorage.getItem('nexus:onboarding') || '{}'))
    assert.equal(onboarding.completedAt, undefined)
    assert.equal(onboarding.firstConversationAt, undefined)
    await screenshot(panel, '01-clean-first-use')
  })

  await record('configure provider, verify connection and save through default first-use UI', async () => {
    await nextGuideStep(panel)
    await panel.locator('.onboarding-card select').first().selectOption('en-US')
    await nextGuideStep(panel)
    await panel.locator('.onboarding-region-tabs__tab').last().click()
    await panel.locator('.onboarding-card select').first().selectOption('custom')
    await panel.locator('.onboarding-grid input').nth(0).fill(provider.baseUrl)
    await panel.locator('.onboarding-grid input').nth(1).fill(provider.model)
    await panel.locator('.onboarding-card input[type="password"]').fill(FAKE_KEY)
    await panel.locator('.onboarding-test-connection button').first().click()
    await panel.locator('.onboarding-test-connection .settings-test-result.is-success').waitFor()
    assert.ok(provider.requests.some((request) => !request.stream && request.status === 200))
    await screenshot(panel, '02-provider-connection-success')
    await nextGuideStep(panel)
    for (const checkbox of await panel.locator('.onboarding-toggle input[type="checkbox"]').all()) await checkbox.uncheck()
    await nextGuideStep(panel)
    for (const checkbox of await panel.locator('.onboarding-toggle input[type="checkbox"]').all()) await checkbox.uncheck()
    await finishRemainingGuide(panel)
    const saved = await readSavedModel(panel)
    assert.equal(saved.apiProviderId, 'custom')
    assert.equal(saved.apiBaseUrl, provider.baseUrl)
    assert.equal(saved.model, provider.model)
  })

  await record('real submitted user message receives visible deterministic mock answer', async () => {
    await sendMessage(panel, FIRST_PROMPT)
    await assertReply(panel, FIRST_PROMPT)
    const state = await panel.evaluate(() => JSON.parse(localStorage.getItem('nexus:onboarding') || '{}'))
    assert.ok(state.completedAt)
    assert.ok(state.firstConversationAt)
    await screenshot(panel, '03-first-generated-reply')
  })

  await record('settings save rejection is visible inside model settings and retains the draft', async () => {
    await openModelSettings(panel)
    await panel.getByLabel(/^Text API key/).fill(`${FAKE_KEY}-retry`)
    await application.evaluate(() => { globalThis.__nexusFirstUseSmoke.rejectNextVaultWrite = true })
    await panel.locator('.settings-v2__draft-button--primary').click()
    const error = panel.locator('.settings-v3-page > .settings-v3-notice.is-error[role="alert"]')
    await error.waitFor()
    assert.equal(await panel.getByLabel(/^Text API key/).inputValue(), `${FAKE_KEY}-retry`)
    assert.equal(await panel.getByLabel('Text endpoint URL', { exact: true }).inputValue(), provider.baseUrl)
    assert.equal(await panel.getByLabel('Text model', { exact: true }).inputValue(), provider.model)
    const visible = await error.evaluate((element) => new Promise((resolve) => {
      const observer = new IntersectionObserver(([entry]) => {
        observer.disconnect()
        resolve(entry.intersectionRatio > 0.99)
      }, { threshold: [0, 1] })
      observer.observe(element)
    }))
    assert.ok(visible, 'Save error must be inside the visible settings viewport')
    assert.equal(await application.evaluate(() => globalThis.__nexusFirstUseSmoke.rejectedVaultWrites), 1)
    await screenshot(panel, '04-settings-save-error')
  })

  await record('retry saves the retained settings draft and survives renderer reload', async () => {
    await panel.locator('.settings-v2__draft-button--primary').click()
    await panel.locator('.settings-v2').waitFor({ state: 'hidden' })
    await panel.reload()
    await panel.locator('.nexus-panel-v2').waitFor()
    await dismissOptionalSetup(panel)
    await openModelSettings(panel)
    assert.equal(await panel.getByLabel('Provider', { exact: true }).inputValue(), 'custom')
    assert.equal(await panel.getByLabel('Text endpoint URL', { exact: true }).inputValue(), provider.baseUrl)
    assert.equal(await panel.getByLabel('Text model', { exact: true }).inputValue(), provider.model)
    const vault = JSON.parse(await fs.readFile(path.join(profile, 'vault.json'), 'utf8'))
    assert.equal(vault['settings:apiKey']?.p === `${FAKE_KEY}-retry`, true, 'Retried synthetic key must persist after reload')
    await screenshot(panel, '05-settings-retry-reloaded')
    await panel.locator('.settings-v2__close').click()
  })

  await record('normal quit and same isolated profile restart preserve provider, model and conversation', async () => {
    await quitNormally()
    petPage = await launch()
    await petPage.locator('.nexus-companion-v2__utility-trigger').waitFor()
    assert.equal(await petPage.locator('.onboarding-card').count(), 0)
    const saved = await readSavedModel(petPage)
    assert.equal(saved.apiProviderId, 'custom')
    assert.equal(saved.apiBaseUrl, provider.baseUrl)
    assert.equal(saved.model, provider.model)
    panel = await openPanel(petPage)
    await openChat(panel)
    await assertReply(panel, FIRST_PROMPT)
    const userMessages = await panel.locator('.chat-sheet-v2__turn[data-role="user"] .chat-sheet-v2__message').allTextContents()
    assert.ok(userMessages.includes(FIRST_PROMPT))
    const vault = JSON.parse(await fs.readFile(path.join(profile, 'vault.json'), 'utf8'))
    assert.equal(vault['settings:apiKey']?.p === `${FAKE_KEY}-retry`, true, 'Retried synthetic key must persist after restart')
    await screenshot(panel, '06-restarted-conversation')
  })

  await record('request failure is visible and edit/retry succeeds after provider repair', async () => {
    provider.setFailure(true, 401)
    await sendMessage(panel, RETRY_PROMPT)
    await panel.locator('.chat-sheet-v2__error[role="alert"]').waitFor()
    assert.ok(provider.requests.some((request) => request.stream && request.userMessage.includes(RETRY_PROMPT) && request.status === 401))
    const replies = await panel.locator('.chat-sheet-v2__turn[data-role="assistant"] .chat-sheet-v2__message').allTextContents()
    assert.ok(!replies.includes(`NEXUS_MOCK_REPLY: ${RETRY_PROMPT}`))
    await screenshot(panel, '07-request-error')
    provider.setFailure(false)
    await panel.locator('.chat-sheet-v2__edit-retry').click()
    assert.equal(await panel.locator('.chat-sheet-v2__input').inputValue(), RETRY_PROMPT)
    await panel.locator('.chat-sheet-v2__send').click()
    await assertReply(panel, RETRY_PROMPT)
    await panel.locator('.chat-sheet-v2__error').waitFor({ state: 'hidden' })
    await screenshot(panel, '08-request-retry-success')
  })

  for (const language of LANGUAGES) {
    // Each locale exercises a fresh normal application lifecycle. Rapidly
    // saving all five in one renderer would exceed the real vault rate limit.
    await quitNormally()
    petPage = await launch()
    panel = await openPanel(petPage)
    await openGuideFromSettings(panel)
    await nextGuideStep(panel)
    await panel.locator('.onboarding-card select').first().selectOption(language)
    await finishRemainingGuide(panel)
    const before = await readSavedModel(panel)
    assert.equal(before.uiLanguage, language)
    assert.equal(before.apiProviderId, 'custom')
    assert.equal(before.apiBaseUrl, provider.baseUrl)
    assert.equal(before.model, provider.model)
    const savedSettings = await panel.evaluate(() => localStorage.getItem('nexus:settings'))
    for (const [viewport, width, height] of [['desktop', 1100, 800], ['narrow', 360, 640]]) {
      await record(`${language}/${viewport}: V2 guide entry reopens after Escape and close without resetting saved settings`, async () => {
        await application.evaluate(({ BrowserWindow }, size) => {
          const window = BrowserWindow.getAllWindows().find((entry) => entry.webContents.getURL().includes('view=panel'))
          window.setMinimumSize(320, 480)
          window.setSize(size.width, size.height)
        }, { width, height })
        await openSettings(panel)
        const entry = panel.locator('.settings-v2__home-card:not([data-focus-return-group])')
        await entry.scrollIntoViewIfNeeded()
        await screenshot(panel, `09-guide-entry-${language}-${viewport}`)
        await openGuideFromSettings(panel)
        await panel.keyboard.press('Escape')
        await panel.locator('.onboarding-card').waitFor({ state: 'hidden' })
        assert.equal(await panel.evaluate(() => localStorage.getItem('nexus:settings')), savedSettings)
        await openGuideFromSettings(panel)
        await screenshot(panel, `10-reopened-guide-${language}-${viewport}`)
        await panel.locator('.onboarding-disclosure__dismiss').click()
        await panel.locator('.onboarding-card').waitFor({ state: 'hidden' })
        assert.equal(await panel.evaluate(() => localStorage.getItem('nexus:settings')), savedSettings)
        const actual = await panel.evaluate(() => ({ width: innerWidth, height: innerHeight }))
        if (viewport === 'narrow') assert.ok(actual.width <= 600, 'Narrow case must use the responsive settings layout')
        return { requested: { width, height }, actual }
      })
    }
  }

  await quitNormally()
}

try {
  await run()
} catch (error) {
  results.push({ label: 'smoke run', status: 'failed', error: error instanceof Error ? error.message : String(error) })
  console.error('[first-use-smoke] failed:', error)
  if (activePage && !activePage.isClosed()) await screenshot(activePage, 'failure').catch(() => {})
  process.exitCode = 1
} finally {
  if (application) await quitNormally().catch(async () => { await application.close().catch(() => {}) })
  if (provider) await provider.close()
  await fs.mkdir(OUTPUT, { recursive: true })
  await fs.writeFile(path.join(OUTPUT, 'results.json'), JSON.stringify({
    passed: results.filter((entry) => entry.status === 'passed').length,
    failed: results.filter((entry) => entry.status === 'failed').length,
    results,
    screenshots,
    requests: provider?.requests ?? [],
    boundaries: ['Synthetic credentials only', 'OS permissions, Python sidecars and external network isolated', 'Development Electron with real main, preload, IPC and persistence', 'No packaged installer, signing or real-service acceptance'],
  }, null, 2))
  if (profile) await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
