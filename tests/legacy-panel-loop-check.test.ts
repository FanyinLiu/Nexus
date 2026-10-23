/**
 * Renderer proof for the legacy panel: an overdue proactive line has to
 * offer its done / not yet / time changed answers there as well.
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

test('the legacy panel answers an overdue proactive line', { timeout: 150_000 }, async () => {
  const page = await browser.newPage()
  await page.addInitScript(() => {
    window.localStorage.setItem('nexus:settings', JSON.stringify({
      uiLanguage: 'zh-CN',
      companionName: 'Nexus',
      userName: 'User',
    }))
    window.localStorage.setItem('nexus:memory:long-term', JSON.stringify([{
      id: 'loop-1',
      content: '下周二去办护照',
      kind: 'open_loop',
      category: 'goal',
      source: 'chat',
      createdAt: '2026-10-16T03:00:00.000Z',
      enabled: true,
      status: 'active',
      loopStatus: 'open',
      slotKey: 'loop.passport',
      loopDueAt: '2026-10-20T10:00:00.000Z',
    }]))
    window.localStorage.setItem('nexus:chat', JSON.stringify([{
      id: 'message-1',
      role: 'assistant',
      content: '办好了吗？',
      createdAt: '2026-10-20T10:00:00.000Z',
      loopCheck: { memoryId: 'loop-1', status: 'pending' },
    }]))
  })
  await page.goto(`${baseUrl}/?view=panel&section=chat&uiV2=0`, { waitUntil: 'load' })

  // The legacy panel keeps its transcript in the DOM but folds it away, so
  // the card is checked by its state rather than by its size.
  const card = page.locator('.loop-outreach[data-loop-check="pending"]')
  await card.waitFor({ state: 'attached' })
  assert.deepEqual(await card.locator('button').allTextContents(), ['办好了', '还没', '改时间了'])

  await card.locator('button').filter({ hasText: '办好了' }).dispatchEvent('click')
  const done = page.locator('.loop-outreach[data-loop-check="done"]')
  await done.waitFor({ state: 'attached' })
  assert.match(await done.textContent() ?? '', /记成办好了/)
  await page.close()
})
