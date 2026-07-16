import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))
const VITE_CLI_PATH = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const HOST = '127.0.0.1'

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, HOST, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not reserve a renderer test port.'))
        return
      }
      const { port } = address
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForServer(url: string, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Vite exited before renderer test setup completed (${process.exitCode}).`)
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) })
      if (response.ok || response.status < 500) return
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  throw new Error(`Timed out waiting for renderer test server at ${url}.`)
}

function stopServer(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
      return
    } catch {
      // Fall through to the direct child when the process group is gone.
    }
  }
  child.kill('SIGTERM')
}

async function rowText(page: Page, label: string): Promise<string> {
  const row = page.locator('.settings-v3-row', {
    has: page.locator('.settings-v3-row__copy strong', { hasText: label }),
  }).first()
  await row.waitFor({ state: 'visible' })
  return (await row.textContent())?.replace(/\s+/g, ' ').trim() ?? ''
}

async function launchRendererBrowser(): Promise<Browser> {
  const launchOptions = { headless: true, args: ['--disable-gpu'] }
  try {
    return await chromium.launch(launchOptions)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('Executable doesn') && !message.includes('Playwright was just installed')) {
      throw error
    }
    return await chromium.launch({ ...launchOptions, channel: 'chrome' })
  }
}

test('active Memory V3 preserves paused recent state and clears it explicitly', { timeout: 45_000 }, async (t) => {
  const port = await reservePort()
  const baseUrl = `http://${HOST}:${port}`
  const vite = spawn(
    process.execPath,
    [VITE_CLI_PATH, '--host', HOST, '--port', String(port), '--strictPort'],
    {
      cwd: PROJECT_ROOT,
      detached: process.platform !== 'win32',
      stdio: 'ignore',
    },
  )
  let browser: Browser | null = null

  t.after(async () => {
    await browser?.close()
    stopServer(vite)
  })

  await waitForServer(baseUrl, vite)
  browser = await launchRendererBrowser()
  const context = await browser.newContext({ viewport: { width: 920, height: 760 } })
  await context.addInitScript(() => {
    window.localStorage.setItem('nexus:settings', JSON.stringify({
      themeId: 'warm-day',
      uiLanguage: 'zh-CN',
      companionName: 'Nexus',
      userName: 'User',
      contextAwarenessEnabled: true,
      activeWindowContextEnabled: true,
      companionAwarenessPaused: false,
    }))
  })

  const page = await context.newPage()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  let observedStoreUrl = ''
  const captureStoreUrl = (url: string) => {
    if (url.includes('/src/features/context/companionSummaryStore.ts')) {
      observedStoreUrl = url
    }
  }
  page.on('request', (request) => captureStoreUrl(request.url()))
  page.on('response', (response) => captureStoreUrl(response.url()))
  await page.goto(`${baseUrl}/?view=panel&section=settings&settingsSection=memory`, { waitUntil: 'networkidle' })
  await page.locator('.settings-v3-memory:not(.is-hidden)').waitFor({ state: 'visible' })
  assert.ok(observedStoreUrl, 'The active renderer must request companionSummaryStore before the lifecycle proof.')
  const storeUrl = observedStoreUrl

  const memorySwitch = page.getByRole('checkbox', { name: '记忆召回和学习', exact: true })
  const memoryStatusRow = memorySwitch.locator(
    'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " settings-v3-row ")][1]',
  )
  await memorySwitch.waitFor({ state: 'visible' })
  assert.equal(await memorySwitch.isChecked(), true, 'memoryPaused=false should expose the enabled checkbox value')
  assert.match(await memoryStatusRow.textContent() ?? '', /运行中/)
  await memorySwitch.press('Space')
  assert.equal(await memorySwitch.isChecked(), false, 'memoryPaused=true should expose the disabled checkbox value')
  assert.match(await memoryStatusRow.textContent() ?? '', /已暂停/)
  await memorySwitch.press('Space')
  assert.equal(await memorySwitch.isChecked(), true)
  assert.match(await memoryStatusRow.textContent() ?? '', /运行中/)

  await page.locator('.settings-v2__nav-item', { hasText: '语音' }).click()
  await page.locator('.settings-v3-voice:not(.is-hidden)').waitFor({ state: 'visible' })

  const saved = await page.evaluate(async (moduleUrl) => {
    const store = await import(moduleUrl)
    const now = new Date()
    return {
      summary: Boolean(store.saveRecentCompanionSummary({
        elapsedBucket: 'about_half_hour',
        elapsedLabel: '半小时左右',
        activityClass: 'coding',
        userDeepFocused: false,
        activeElsewhere: true,
        shouldStaySilent: true,
      }, now)),
      decision: Boolean(store.saveRecentCompanionCheckInDecision({
        shouldCheckIn: false,
        reason: 'active_chat',
        surface: 'none',
        priority: 'none',
        signalKey: 'renderer-proof-private-signal',
      }, now)),
    }
  }, storeUrl)
  assert.deepEqual(saved, { summary: true, decision: true })

  await page.locator('.settings-v2__nav-item', { hasText: '记忆与隐私' }).click()
  await page.locator('.settings-v3-memory:not(.is-hidden)').waitFor({ state: 'visible' })

  const continuityDisclosure = page.locator('details.settings-v3-disclosure', { hasText: '陪伴连续感' }).first()
  await continuityDisclosure.locator('summary').click()
  const loadedBeforePause = await page.evaluate(async (moduleUrl) => {
    const store = await import(moduleUrl)
    return {
      summary: Boolean(store.loadRecentCompanionSummary()),
      decision: Boolean(store.loadRecentCompanionCheckInDecision()),
    }
  }, storeUrl)
  assert.deepEqual(loadedBeforePause, { summary: true, decision: true })
  const pauseInput = page.getByRole('checkbox', { name: '暂停桌面陪伴连续性' })
  await page.locator('label.settings-v3-switch', { hasText: '暂停桌面陪伴连续性' }).click()
  assert.equal(await pauseInput.isChecked(), true)

  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('.settings-v3-row')]
    return rows.some((row) => row.textContent?.includes('陪伴感知透明度') && row.textContent.includes('已暂停'))
  })

  assert.match(await rowText(page, '陪伴感知透明度'), /已暂停/)
  assert.match(await rowText(page, '最近陪伴摘要'), /已记录/)
  assert.match(await rowText(page, '最近陪伴摘要'), /半小时左右/)
  assert.match(await rowText(page, '会进入模型'), /已有摘要留在本地，不会进入模型/)

  const clearButton = page.getByRole('button', { name: '清理近期陪伴数据' })
  assert.equal(await clearButton.isEnabled(), true)

  const retained = await page.evaluate(async (moduleUrl) => {
    const store = await import(moduleUrl)
    return {
      summary: Boolean(store.loadRecentCompanionSummary()),
      decision: Boolean(store.loadRecentCompanionCheckInDecision()),
    }
  }, storeUrl)
  assert.deepEqual(retained, { summary: true, decision: true })

  const renderedText = await continuityDisclosure.textContent() ?? ''
  assert.equal(renderedText.includes('rawContentVisible'), false)
  assert.equal(renderedText.includes('renderer-proof-private-signal'), false)

  await clearButton.click()
  await clearButton.waitFor({ state: 'visible' })
  assert.equal(await clearButton.isDisabled(), true)
  assert.match(await rowText(page, '最近陪伴摘要'), /暂无/)

  const cleared = await page.evaluate(async (moduleUrl) => {
    const store = await import(moduleUrl)
    return {
      summary: store.loadRecentCompanionSummary(),
      decision: store.loadRecentCompanionCheckInDecision(),
    }
  }, storeUrl)
  assert.deepEqual(cleared, { summary: null, decision: null })

  await page.evaluate(async (moduleUrl) => {
    const store = await import(moduleUrl)
    const now = new Date()
    store.saveRecentCompanionSummary({
      elapsedBucket: 'about_half_hour',
      elapsedLabel: '半小时左右',
      activityClass: 'coding',
      userDeepFocused: false,
      activeElsewhere: true,
      shouldStaySilent: true,
    }, now)
    store.saveRecentCompanionCheckInDecision({
      shouldCheckIn: false,
      reason: 'active_chat',
      surface: 'none',
      priority: 'none',
      signalKey: 'renderer-proof-private-signal-after-clear',
    }, now)
  }, storeUrl)

  await page.locator('.settings-v2__nav-item', { hasText: '语音' }).click()
  await page.locator('.settings-v3-voice:not(.is-hidden)').waitFor({ state: 'visible' })
  await page.locator('.settings-v2__nav-item', { hasText: '记忆与隐私' }).click()
  await page.locator('.settings-v3-memory:not(.is-hidden)').waitFor({ state: 'visible' })

  const sourcesDisclosure = page.locator('details.settings-v3-disclosure', { hasText: '桌面感知来源' }).first()
  await sourcesDisclosure.locator('summary').click()
  const awarenessInput = page.getByRole('checkbox', { name: '启用上下文感知' })
  assert.equal(await awarenessInput.isChecked(), true)

  await page.locator('label.settings-v3-switch', { hasText: '启用上下文感知' }).click()
  assert.equal(await awarenessInput.isChecked(), false)
  const draftBar = page.locator('footer.settings-v2__draft-bar')
  const discardDraftButton = draftBar.getByRole('button', { name: '取消', exact: true })
  await discardDraftButton.waitFor({ state: 'visible' })
  assert.equal(await discardDraftButton.isEnabled(), true)
  await discardDraftButton.scrollIntoViewIfNeeded()
  await discardDraftButton.click()
  assert.equal(await awarenessInput.isChecked(), true)

  const retainedAfterDiscard = await page.evaluate(async (moduleUrl) => {
    const store = await import(moduleUrl)
    return {
      summary: Boolean(store.loadRecentCompanionSummary()),
      decision: Boolean(store.loadRecentCompanionCheckInDecision()),
    }
  }, storeUrl)
  assert.deepEqual(retainedAfterDiscard, { summary: true, decision: true })

  await page.locator('label.settings-v3-switch', { hasText: '启用上下文感知' }).click()
  const saveDraftButton = page.locator('footer.settings-v2__draft-bar').getByRole('button', {
    name: '保存设置',
    exact: true,
  })
  await saveDraftButton.waitFor({ state: 'visible' })
  assert.equal(await saveDraftButton.isEnabled(), true)
  await saveDraftButton.scrollIntoViewIfNeeded()
  await saveDraftButton.click()

  const purgedAfterSave = await page.evaluate(async (moduleUrl) => {
    const store = await import(moduleUrl)
    return {
      summary: store.loadRecentCompanionSummary(),
      decision: store.loadRecentCompanionCheckInDecision(),
    }
  }, storeUrl)
  assert.deepEqual(purgedAfterSave, { summary: null, decision: null })
})
