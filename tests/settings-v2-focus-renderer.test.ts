/**
 * Renderer proof for the settings V2 focus flow: a section heading takes
 * the focus when a page opens, and the home card gets it back.
 */

import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'

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

test('a settings page takes the focus and gives it back to the home card', { timeout: 150_000 }, async () => {
  const page = await browser.newPage()
  await page.addInitScript(() => {
    window.localStorage.setItem('nexus:settings', JSON.stringify({
      uiLanguage: 'zh-CN',
      companionName: 'Nexus',
      userName: 'User',
    }))
  })
  await page.goto(`${baseUrl}/?view=panel&section=settings`, { waitUntil: 'load' })

  const connectCard = page.locator('.settings-v2__home-card[data-focus-return-group="connect"]')
  await connectCard.waitFor({ state: 'visible' })
  // A keyboard activation is the one that moves the route context focus.
  await connectCard.focus()
  await page.keyboard.press('Enter')
  await page.locator('.settings-v2[data-settings-v2-destination="connect"]').waitFor({ state: 'visible' })

  await page.waitForFunction(() => document.activeElement?.tagName === 'H1')
  const headingText = await page.locator('.settings-v2__heading h1').textContent()
  assert.equal(headingText?.trim(), '连接')

  const homeButton = page.locator('.settings-v2__nav').getByRole('button').first()
  await homeButton.focus()
  await page.keyboard.press('Enter')
  await page.locator('.settings-v2__home').waitFor({ state: 'visible' })
  await page.waitForFunction(() => (
    document.activeElement?.getAttribute('data-focus-return-group') === 'connect'
  ))
  await page.close()
})
