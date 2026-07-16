#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { chromium } from 'playwright'
import sharp from 'sharp'
import {
  SETTINGS_VISUAL_DEFAULT_LANGUAGE_CASES as LANGUAGE_CASES,
  SETTINGS_VISUAL_SECTIONS as SECTIONS,
  SETTINGS_VISUAL_THEMES as THEMES,
  SETTINGS_VISUAL_VIEWPORTS as VIEWPORTS,
  resolveSettingsVisualLanguageCases,
} from './settings-visual-matrix.mjs'

const SETTINGS_STORAGE_KEY = 'nexus:settings'
const DEFAULT_PORT = 47821
const DEFAULT_HOST = '127.0.0.1'

function parseArgs(argv) {
  const options = {
    url: '',
    outDir: '',
    channel: '',
    headed: false,
    keepServer: false,
    quick: false,
    sections: [],
    locales: [],
    themes: [],
    viewports: [],
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--url') {
      options.url = argv[i + 1] ?? ''
      i += 1
    } else if (arg === '--out') {
      options.outDir = argv[i + 1] ?? ''
      i += 1
    } else if (arg === '--channel') {
      options.channel = argv[i + 1] ?? ''
      i += 1
    } else if (arg === '--headed') {
      options.headed = true
    } else if (arg === '--keep-server') {
      options.keepServer = true
    } else if (arg === '--quick') {
      options.quick = true
    } else if (['--sections', '--locales', '--themes', '--viewports'].includes(arg)) {
      const key = arg.slice(2)
      options[key] = (argv[i + 1] ?? '').split(',').map((value) => value.trim()).filter(Boolean)
      i += 1
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function printHelp() {
  console.log(`Usage: npm run settings:visual -- [--url http://127.0.0.1:47821] [--out artifacts/settings-visual/latest] [--channel chrome] [--headed] [--quick]

Optional comma-separated filters:
  --sections home,chat,voice
  --locales zh-CN,en-US
  --themes warm-day,system-dark
  --viewports desktop-720,short

Quick mode checks home + all 12 subpages at 720x640 and 300x480 in zh-CN/warm-day.
The default remains the complete locale/theme/viewport matrix.

Captures settings screenshots for:
  sections: ${SECTIONS.map((section) => section.id).join(', ')}
  themes:   ${THEMES.map((theme) => theme.id).join(', ')}
  sizes:    ${VIEWPORTS.map((viewport) => `${viewport.id}:${viewport.width}x${viewport.height}`).join(', ')}
  locales:  ${LANGUAGE_CASES.map((languageCase) => languageCase.id).join(', ')}
`)
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(800) })
    return response.ok || response.status < 500
  } catch {
    return false
  }
}

async function isPortAvailable(host, port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, host)
  })
}

function stopServer(server) {
  if (!server || server.killed) return
  if (process.platform !== 'win32' && server.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM')
      return
    } catch {
      // Fall back to killing the parent process if the group is already gone.
    }
  }
  server.kill('SIGTERM')
}

async function resolveBaseUrl(options) {
  if (options.url) return { baseUrl: options.url.replace(/\/+$/, ''), server: null }

  let port = DEFAULT_PORT
  for (; port < DEFAULT_PORT + 20; port += 1) {
    if (await isPortAvailable(DEFAULT_HOST, port)) break
  }
  if (port >= DEFAULT_PORT + 20) {
    throw new Error(`No free dev-server port found from ${DEFAULT_PORT} to ${DEFAULT_PORT + 19}`)
  }
  const baseUrl = `http://${DEFAULT_HOST}:${port}`

  let serverExited = false
  let serverExitMessage = ''
  const server = spawn(
    'npm',
    ['run', 'dev', '--', '--host', DEFAULT_HOST, '--port', String(port), '--strictPort'],
    {
      cwd: process.cwd(),
      env: { ...process.env, BROWSER: 'none' },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  server.stdout.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`))
  server.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`))
  server.once('exit', (code, signal) => {
    serverExited = true
    serverExitMessage = `dev server exited before becoming reachable (code ${code ?? 'null'}, signal ${signal ?? 'null'})`
  })

  try {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (serverExited) throw new Error(serverExitMessage)
      if (await isReachable(baseUrl)) return { baseUrl, server }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`Timed out waiting for dev server at ${baseUrl}`)
  } catch (error) {
    stopServer(server)
    throw error
  }
}

function settingsUrl(baseUrl, section) {
  const url = new URL(baseUrl)
  url.searchParams.set('view', 'panel')
  url.searchParams.set('section', 'settings')
  for (const [key, value] of Object.entries(section.query)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

async function auditLayout(page, sectionId) {
  return page.evaluate((expectedSectionId) => {
    const issues = []
    const rectFor = (element) => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }
    }
    const overlaps = (a, b) => Boolean(
      a && b && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1,
    )

    const backdrop = document.querySelector('.settings-backdrop')
    const backdropRect = rectFor(backdrop)
    if (!backdrop || !backdropRect) {
      return ['settings backdrop did not render']
    }
    const backdropStyle = getComputedStyle(backdrop)
    if (
      backdropRect.left > 1
      || backdropRect.top > 1
      || backdropRect.right < window.innerWidth - 1
      || backdropRect.bottom < window.innerHeight - 1
    ) {
      issues.push('settings backdrop does not cover viewport')
    }
    const allowsTransparentV2HomeBackdrop = expectedSectionId === 'home'
      && backdrop.classList.contains('settings-backdrop--v2')
      && Boolean(backdrop.querySelector('.settings-drawer--home.settings-drawer--v2'))
    if (backdropStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && !allowsTransparentV2HomeBackdrop) {
      issues.push('settings backdrop is transparent')
    }

    const drawer = document.querySelector('.settings-drawer')
    const drawerRect = rectFor(drawer)
    if (!drawer || !drawerRect) {
      return ['settings drawer did not render']
    }
    const drawerStyle = getComputedStyle(drawer)
    if (drawerStyle.visibility !== 'visible' || drawerStyle.display === 'none' || Number(drawerStyle.opacity) < 0.98) {
      issues.push('settings drawer is not fully visible')
    }

    if (drawerRect.left < -1 || drawerRect.top < -1 || drawerRect.right > window.innerWidth + 1 || drawerRect.bottom > window.innerHeight + 1) {
      issues.push('settings drawer extends outside viewport')
    }

    if (drawer.classList.contains('settings-drawer--v2')) {
      const shell = drawer.querySelector(':scope > .settings-v2')
      const shellRect = rectFor(shell)
      if (!shellRect) {
        issues.push('settings V2 shell did not render')
      } else if (Math.abs(shellRect.height - drawerRect.height) > 2 || Math.abs(shellRect.bottom - drawerRect.bottom) > 2) {
        issues.push(`settings V2 shell does not fill drawer (${Math.round(shellRect.height)}px / ${Math.round(drawerRect.height)}px)`)
      }

      const content = drawer.querySelector('.settings-v2__content')
      const sections = drawer.querySelector('.settings-v2__active-section > .settings-drawer__sections')
      if (content && getComputedStyle(content).overflowY !== 'clip') {
        issues.push('settings V2 content must delegate scrolling to the active sections wrapper')
      }
      if (sections && !['auto', 'scroll'].includes(getComputedStyle(sections).overflowY)) {
        issues.push('settings active sections wrapper is not the scroll container')
      }
    }

    const shellHeadings = [...drawer.querySelectorAll('.settings-v2__heading h1')]
      .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
    if (shellHeadings.length !== 1 || !shellHeadings[0]?.textContent?.trim()) {
      issues.push(`settings shell must expose exactly one visible h1 (found ${shellHeadings.length})`)
    }

    const visibleV3Pages = [...drawer.querySelectorAll('.settings-v3-page:not(.is-hidden)')]
      .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
    if (expectedSectionId === 'home') {
      const homes = [...drawer.querySelectorAll('.settings-v2__home')]
        .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
      if (homes.length !== 1) issues.push(`settings home contract did not render exactly once (found ${homes.length})`)
      if (visibleV3Pages.length) issues.push('a V3 subpage is visible while settings home is active')
    } else {
      if (visibleV3Pages.length !== 1) {
        issues.push(`expected exactly one V3 settings root for ${expectedSectionId} (found ${visibleV3Pages.length})`)
      }
      const activePage = visibleV3Pages[0]
      const pageHeadings = activePage
        ? [...activePage.querySelectorAll('h2, h3')].filter((element) => element instanceof HTMLElement && element.offsetParent !== null && element.textContent?.trim())
        : []
      const groupHeading = drawer.querySelector('.settings-v2__active-heading h2')
      if (!pageHeadings.length && (!(groupHeading instanceof HTMLElement) || groupHeading.offsetParent === null || !groupHeading.textContent?.trim())) {
        issues.push(`V3 page heading is missing: ${expectedSectionId}`)
      }
      const activeContent = drawer.querySelector('.settings-drawer__sections')
      const visibleLegacyRoots = activeContent
        ? [...activeContent.children].filter((element) => (
          element instanceof HTMLElement
          && element.offsetParent !== null
          && !element.classList.contains('settings-v3-page')
        ))
        : []
      if (visibleLegacyRoots.length) {
        issues.push(`legacy settings root is mounted instead of V3: ${visibleLegacyRoots[0].className || visibleLegacyRoots[0].tagName}`)
      }
    }

    const headerRect = rectFor(document.querySelector('.settings-v2__header'))
    const bodyRect = rectFor(document.querySelector('.settings-v2__content'))
    const actionsRect = rectFor(document.querySelector('.settings-v2__draft-bar'))
    if (overlaps(headerRect, bodyRect)) issues.push('settings header overlaps body')
    if (overlaps(bodyRect, actionsRect)) issues.push('settings body overlaps save area')

    const title = document.querySelector('.settings-v2__heading h1')
    if (title && title.scrollWidth > title.clientWidth + 2) {
      issues.push('settings title is horizontally clipped')
    }

    const activeSettingsPage = document.querySelector('.settings-v3-page:not(.is-hidden), .settings-v2__home')
    const pageRect = rectFor(activeSettingsPage)
    if (pageRect && drawerRect && (pageRect.left < drawerRect.left - 1 || pageRect.right > drawerRect.right + 1)) {
      issues.push('settings page content escapes drawer horizontally')
    }

    const checkedSelectors = [
      '.settings-control-card',
      '.settings-toggle',
      '.settings-test-result',
      '.settings-inline-note',
      'input:not([type="checkbox"]):not([type="range"])',
      'select',
      'textarea',
      'button',
    ]
    const escapesDrawerBounds = (rect) => Boolean(
      rect.width > drawerRect.width + 2
      || rect.left < drawerRect.left - 2
      || rect.right > drawerRect.right + 2,
    )
    const inlineScrollContainers = [...drawer.querySelectorAll('*')]
      .filter((element) => {
        if (!(element instanceof HTMLElement) || element.offsetParent === null) return false
        const overflowX = getComputedStyle(element).overflowX
        return overflowX === 'auto' || overflowX === 'scroll'
      })
    for (const scrollContainer of inlineScrollContainers) {
      const scrollContainerRect = rectFor(scrollContainer)
      if (!scrollContainerRect || !escapesDrawerBounds(scrollContainerRect)) continue
      const label = scrollContainer.className || scrollContainer.tagName.toLowerCase()
      issues.push(`horizontal scroll container escapes drawer bounds: ${String(label).slice(0, 80)}`)
      break
    }
    const isContainedInlineScrollClip = (element, rect) => {
      if (!(element instanceof HTMLButtonElement)) return false
      let ancestor = element.parentElement
      while (ancestor && ancestor !== drawer) {
        const overflowX = getComputedStyle(ancestor).overflowX
        if (overflowX === 'auto' || overflowX === 'scroll') {
          const ancestorRect = rectFor(ancestor)
          if (
            ancestorRect
            && !escapesDrawerBounds(ancestorRect)
            && (rect.left < ancestorRect.left - 2 || rect.right > ancestorRect.right + 2)
          ) {
            return true
          }
        }
        ancestor = ancestor.parentElement
      }
      return false
    }
    for (const element of drawer.querySelectorAll(checkedSelectors.join(','))) {
      const rect = rectFor(element)
      if (!rect) continue
      if (rect.width < 1 || rect.height < 1) continue
      if (escapesDrawerBounds(rect) && !isContainedInlineScrollClip(element, rect)) {
        const label = element.className || element.tagName.toLowerCase()
        issues.push(`control escapes drawer bounds: ${String(label).slice(0, 80)}`)
        break
      }
    }

    if (document.documentElement.scrollWidth > window.innerWidth + 2) {
      issues.push('document has horizontal page overflow')
    }

    const body = document.querySelector('.settings-v2__content')
    if (body && body.scrollWidth > body.clientWidth + 2) {
      issues.push('settings body has horizontal overflow')
    }

    for (const element of drawer.querySelectorAll('button, label, [role="menuitemradio"], [role="tab"]')) {
      if (!(element instanceof HTMLElement) || element.offsetParent === null) continue
      const style = getComputedStyle(element)
      const clipsInline = style.overflowX === 'hidden' || style.overflowX === 'clip'
      if (clipsInline && element.scrollWidth > element.clientWidth + 2) {
        issues.push(`visible control text is clipped: ${(element.textContent ?? element.className).trim().slice(0, 80)}`)
        break
      }
    }

    const touchScope = expectedSectionId === 'home'
      ? drawer.querySelector('.settings-v2__home')
      : visibleV3Pages[0]
    if (touchScope) {
      const touchSelectors = [
        'button',
        'a[href]',
        'summary',
        'select',
        'textarea',
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
        'label.settings-v3-switch',
        '[role="button"]',
        '[role="tab"]',
      ]
      for (const element of touchScope.querySelectorAll(touchSelectors.join(','))) {
        if (!(element instanceof HTMLElement) || element.offsetParent === null) continue
        if (element.matches(':disabled, [aria-disabled="true"]')) continue
        const rect = element.getBoundingClientRect()
        if (rect.width < 43.5 || rect.height < 43.5) {
          const label = element.getAttribute('aria-label') || element.textContent || element.className || element.tagName
          issues.push(`interactive target is smaller than 44px (${Math.round(rect.width)}x${Math.round(rect.height)}): ${String(label).trim().slice(0, 80)}`)
          break
        }
      }
    }

    return issues
  }, sectionId)
}

function parseRgb(color) {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  return channels?.length === 3 ? channels : null
}

async function backdropPixelsMatch(page, screenshot, sectionId) {
  const backdropState = await page.evaluate((expectedSectionId) => {
    const backdrop = document.querySelector('.settings-backdrop')
    const backgroundColor = backdrop ? getComputedStyle(backdrop).backgroundColor : ''
    return {
      backgroundColor,
      allowsTransparentV2HomeBackdrop: expectedSectionId === 'home'
        && backgroundColor === 'rgba(0, 0, 0, 0)'
        && Boolean(backdrop?.classList.contains('settings-backdrop--v2'))
        && Boolean(backdrop?.querySelector('.settings-drawer--home.settings-drawer--v2')),
    }
  }, sectionId)
  if (backdropState.allowsTransparentV2HomeBackdrop) return true

  const expectedRgb = parseRgb(backdropState.backgroundColor)
  if (!expectedRgb) return false

  const { data, info } = await sharp(screenshot)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const points = [
    [2, 2],
    [info.width - 3, 2],
    [2, Math.floor(info.height / 2)],
    [info.width - 3, Math.floor(info.height / 2)],
    [2, info.height - 3],
    [info.width - 3, info.height - 3],
  ]

  return points.every(([x, y]) => {
    const offset = (y * info.width + x) * info.channels
    return expectedRgb.every((channel, index) => Math.abs(data[offset + index] - channel) <= 24)
  })
}

async function captureStableScreenshot(page, screenshotPath, sectionId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.evaluate(() => new Promise((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))
    }))
    const screenshot = await page.screenshot({ fullPage: false })
    if (await backdropPixelsMatch(page, screenshot, sectionId)) {
      await writeFile(screenshotPath, screenshot)
      return
    }
    await page.waitForTimeout(160)
  }

  throw new Error('settings screenshot contains compositor holes in the backdrop')
}

async function withSettingsContext({ browser, viewport, theme, languageCase }, run) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    colorScheme: theme.id === 'system-dark' ? 'dark' : 'light',
  })
  await context.addInitScript(({ settingsKey, themeId, uiLanguage }) => {
    window.localStorage.setItem(settingsKey, JSON.stringify({
      themeId,
      uiLanguage,
      companionName: 'Nexus',
      userName: 'User',
    }))
  }, { settingsKey: SETTINGS_STORAGE_KEY, themeId: theme.id, uiLanguage: languageCase.id })

  try {
    return await run(context)
  } finally {
    await context.close()
  }
}

async function captureMatrix({ browser, baseUrl, outDir, languageCases }) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    screenshots: [],
  }

  for (const languageCase of languageCases) {
    for (const viewport of languageCase.viewports) {
      for (const theme of languageCase.themes) {
        for (const section of languageCase.sections) {
          await withSettingsContext({ browser, viewport, theme, languageCase }, async (context) => {
            const page = await context.newPage()
            try {
              page.setDefaultTimeout(10_000)
              const url = settingsUrl(baseUrl, section)
              let readyError = null
              for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                  await page.goto(url, { waitUntil: 'networkidle' })
                  await page.waitForSelector('.settings-drawer')
                  if (section.id !== 'home') {
                    await page.waitForSelector('.settings-v3-page:not(.is-hidden)')
                  }
                  await page.waitForFunction(() => {
                    const drawer = document.querySelector('.settings-drawer')
                    if (!drawer) return false
                    const style = getComputedStyle(drawer)
                    return style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) >= 0.98
                  })
                  readyError = null
                  break
                } catch (error) {
                  readyError = error
                }
              }
              if (readyError) {
                const message = readyError instanceof Error ? readyError.message : String(readyError)
                throw new Error(`${languageCase.id}/${viewport.id}/${theme.label}/${section.id}: settings did not become ready after 2 attempts: ${message}`)
              }
              await page.waitForTimeout(120)
              await page.evaluate(async () => { await document.fonts.ready })

              const issues = await auditLayout(page, section.id)
              if (issues.length) {
                throw new Error(`${languageCase.id}/${viewport.id}/${theme.label}/${section.id}: ${issues.join('; ')}`)
              }

              const relativePath = path.join(languageCase.id, viewport.id, theme.label, `${section.id}.png`)
              const screenshotPath = path.join(outDir, relativePath)
              await mkdir(path.dirname(screenshotPath), { recursive: true })
              try {
                await captureStableScreenshot(page, screenshotPath, section.id)
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                throw new Error(`${languageCase.id}/${viewport.id}/${theme.label}/${section.id}: ${message}`)
              }
              manifest.screenshots.push({
                language: languageCase.id,
                viewport: viewport.id,
                theme: theme.id,
                themeLabel: theme.label,
                section: section.id,
                path: relativePath,
              })
            } finally {
              await page.close()
            }
          })
        }
      }
    }
  }

  await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

async function launchBrowser(options) {
  const launchOptions = {
    headless: !options.headed,
  }
  if (options.channel) {
    return chromium.launch({ ...launchOptions, channel: options.channel })
  }

  try {
    return await chromium.launch(launchOptions)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const missingBundledBrowser = message.includes('Executable doesn') || message.includes('Looks like Playwright was just installed')
    if (!missingBundledBrowser) throw error

    try {
      return await chromium.launch({ ...launchOptions, channel: 'chrome' })
    } catch {
      throw new Error(`${message}\nFallback to system Chrome also failed. Run: npx playwright install chromium`)
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const languageCases = resolveSettingsVisualLanguageCases(options)
  const defaultOutDir = path.join(
    process.cwd(),
    'artifacts',
    'settings-visual',
    new Date().toISOString().replace(/[:.]/g, '-'),
  )
  const outDir = path.resolve(options.outDir || defaultOutDir)
  let server = null

  try {
    const resolved = await resolveBaseUrl(options)
    server = resolved.server
    const browser = await launchBrowser(options)
    try {
      const manifest = await captureMatrix({ browser, baseUrl: resolved.baseUrl, outDir, languageCases })
      console.log(`settings visual check passed: ${manifest.screenshots.length} screenshots`)
      console.log(`manifest: ${path.join(outDir, 'manifest.json')}`)
    } finally {
      await browser.close()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Executable doesn') || message.includes('browserType.launch') || message.includes('Playwright was just installed')) {
      console.error('Playwright browser is missing. Run: npx playwright install chromium')
    }
    console.error(message)
    process.exitCode = 1
  } finally {
    if (server && !options.keepServer) {
      stopServer(server)
    }
  }
}

await main()
