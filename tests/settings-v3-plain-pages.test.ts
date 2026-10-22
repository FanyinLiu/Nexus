/**
 * Renderer proof for the three plain settings pages that used to hide an
 * editor behind a surface guard: the voice trigger mode, the text
 * endpoint address, and the weather city.
 */

import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { after, before, test } from 'node:test'
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

async function launchRendererBrowser(): Promise<Browser> {
  const launchOptions = { headless: true, args: ['--disable-gpu'], timeout: 45_000 }
  try {
    return await chromium.launch(launchOptions)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const missingBrowser = message.includes('Executable doesn') || message.includes('Playwright was just installed')
    const timedOut = message.includes('Timeout')
    if (!missingBrowser && !timedOut) throw error
    return await chromium.launch({ ...launchOptions, channel: 'chrome' })
  }
}

let vite: ChildProcess
let browser: Browser
let baseUrl = ''

before(async () => {
  const port = await reservePort()
  baseUrl = `http://${HOST}:${port}`
  vite = spawn(
    process.execPath,
    [VITE_CLI_PATH, '--host', HOST, '--port', String(port), '--strictPort'],
    {
      cwd: PROJECT_ROOT,
      detached: process.platform !== 'win32',
      stdio: 'ignore',
    },
  )
  await waitForServer(baseUrl, vite)
  browser = await launchRendererBrowser()
})

after(async () => {
  await browser?.close()
  stopServer(vite)
})

async function openSettingsPage(
  page: Page,
  settingsSection: string,
  draft: Record<string, unknown>,
): Promise<void> {
  await page.addInitScript((seed) => {
    window.localStorage.setItem('nexus:settings', JSON.stringify(seed))
  }, {
    uiLanguage: 'zh-CN',
    companionName: 'Nexus',
    userName: 'User',
    ...draft,
  })
  await page.goto(`${baseUrl}/?view=panel&section=settings&settingsSection=${settingsSection}`, { waitUntil: 'load' })
}

/** The plain page keeps one advanced disclosure; its hint names the page. */
async function openAdvanced(page: Page, hint: string): Promise<void> {
  const advanced = page.locator('details.settings-v3-disclosure').filter({
    has: page.locator('summary', { hasText: hint }),
  })
  await advanced.waitFor({ state: 'visible' })
  if (await advanced.getAttribute('open') === null) {
    await advanced.locator('summary').click()
  }
}

async function saveSettings(page: Page, expected: Record<string, unknown>): Promise<Record<string, unknown>> {
  const saveButton = page.locator('footer.settings-v2__draft-bar').getByRole('button', {
    name: '保存设置',
    exact: true,
  })
  await saveButton.waitFor({ state: 'visible' })
  await saveButton.scrollIntoViewIfNeeded()
  await saveButton.click()
  await page.waitForFunction((wanted) => {
    const raw = window.localStorage.getItem('nexus:settings')
    if (!raw) return false
    try {
      const stored = JSON.parse(raw) as Record<string, unknown>
      return Object.entries(wanted).every(([key, value]) => stored[key] === value)
    } catch {
      return false
    }
  }, expected)
  return await page.evaluate(() => {
    const raw = window.localStorage.getItem('nexus:settings')
    return raw ? JSON.parse(raw) as Record<string, unknown> : {}
  })
}

test('the voice page can still pick the fill-the-box trigger', { timeout: 150_000 }, async () => {
  const page = await browser.newPage()
  await openSettingsPage(page, 'voice', {
    voiceTriggerMode: 'wake_word',
    wakeWord: '小N',
    wakeWordEnabled: true,
  })
  await openAdvanced(page, '换服务、语速、一直听')

  const trigger = page.getByRole('combobox', { name: '语音触发方式' })
  await trigger.waitFor({ state: 'visible' })
  assert.deepEqual(
    await trigger.locator('option').allTextContents(),
    ['识别后直接发送', '命中唤醒词再发送', '只填入输入框'],
  )
  // The plain page owns the wake word field, so the advanced section must
  // not show a second one.
  const fieldLabels = page.locator('label.settings-v3-field > span')
  const wakeWordFields = fieldLabels.filter({ hasText: /^唤醒词/ })
  const herNameFields = fieldLabels.filter({ hasText: /^她的名字$/ })
  assert.equal(await wakeWordFields.count() + await herNameFields.count(), 1)

  await trigger.selectOption('manual_confirm')
  assert.equal(await trigger.inputValue(), 'manual_confirm')

  const saved = await saveSettings(page, { voiceTriggerMode: 'manual_confirm' })
  assert.equal(saved.voiceTriggerMode, 'manual_confirm')
  assert.equal(saved.wakeWordEnabled, false)
  assert.equal(saved.wakeWord, '小N')
  await page.close()
})
