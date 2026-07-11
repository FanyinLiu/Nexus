#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import postcss from 'postcss'

const ROOT = process.cwd()
const DEFAULT_URL = 'http://127.0.0.1:47821'
const SETTINGS_STORAGE_KEY = 'nexus:settings'
const STYLE_FILES = [
  'settings.css',
  'settings-home.css',
  'settings-themes.css',
  'settings-chat-aligned.css',
  'settings-chat-final.css',
  'settings-chat-role-final.css',
  'settings-visual-system.css',
  'settings-visibility-final.css',
  'settings-product-shell.css',
  'settings-product-reference-final.css',
]
const THEMES = [
  { id: 'system-dark', colorScheme: 'dark' },
  { id: 'system-black', colorScheme: 'light' },
  { id: 'system-day', colorScheme: 'light' },
  { id: 'warm-day', colorScheme: 'light' },
]
const SECTIONS = [
  { id: 'home', query: '' },
  { id: 'console', query: 'settingsSection=console' },
  { id: 'model', query: 'settingsSection=model' },
  { id: 'chat', query: 'settingsSection=chat' },
  { id: 'history', query: 'settingsSection=history' },
  { id: 'letters', query: 'settingsSection=letters' },
  { id: 'voice', query: 'settingsSection=voice' },
  { id: 'memory', query: 'settingsSection=memory' },
  { id: 'lorebooks', query: 'settingsSection=lorebooks' },
  { id: 'window', query: 'settingsSection=window' },
  { id: 'tools', query: 'settingsSection=tools' },
  { id: 'autonomy', query: 'settingsSection=autonomy' },
]
const VIEWPORTS = [
  { id: 'desktop', width: 1280, height: 860 },
  { id: 'narrow', width: 390, height: 760 },
]

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    out: path.join(ROOT, 'artifacts', 'settings-css-coverage', 'latest.json'),
    headed: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--url') options.url = argv[++index] ?? options.url
    else if (arg === '--out') options.out = argv[++index] ?? options.out
    else if (arg === '--headed') options.headed = true
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run settings:css:coverage -- [--url http://127.0.0.1:47821] [--out artifacts/settings-css-coverage/latest.json] [--headed]')
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function loadSourceCss() {
  return new Map(STYLE_FILES.map((file) => [
    file,
    readFileSync(path.join(ROOT, 'src', 'app', 'styles', file), 'utf8'),
  ]))
}

function loadSourceRules(sourceCss) {
  return new Map(STYLE_FILES.map((file) => {
    const css = sourceCss.get(file)
    const root = postcss.parse(css, { from: file })
    const rules = []
    root.walkRules((rule) => {
      if (!(rule.nodes ?? []).some((node) => node.type === 'decl')) return
      rules.push({
        start: rule.source?.start?.offset ?? -1,
        end: rule.source?.end?.offset ?? -1,
        selector: rule.selector.replace(/\s+/g, ' ').trim(),
      })
    })
    return [file, rules]
  }))
}

function makeReport(sourceRules) {
  return new Map(STYLE_FILES.map((file) => [file, {
    total: sourceRules.get(file).length,
    used: new Set(),
    unmatchedUsage: 0,
  }]))
}

async function mapStyleSheets(cdp, headers, sourceCss) {
  const stylesheetFiles = new Map()
  const unmatched = new Set(sourceCss.keys())
  for (const [styleSheetId] of headers) {
    let text
    try {
      ({ text } = await cdp.send('CSS.getStyleSheetText', { styleSheetId }))
    } catch (error) {
      if (String(error?.message ?? error).includes('No style sheet with given id')) continue
      throw error
    }
    const exact = [...sourceCss.entries()].find(([, source]) => (
      source === text || source.trimEnd() === text.trimEnd()
    ))
    const prefix = exact ?? [...sourceCss.entries()]
      .filter(([, source]) => source.slice(0, 120) === text.slice(0, 120))
      .sort(([, left], [, right]) => Math.abs(left.length - text.length) - Math.abs(right.length - text.length))[0]
    if (!prefix || !unmatched.has(prefix[0])) continue
    stylesheetFiles.set(styleSheetId, prefix[0])
    unmatched.delete(prefix[0])
  }
  return stylesheetFiles
}

function markRuleUsage(report, sourceRules, stylesheetFiles, ruleUsage) {
  for (const usage of ruleUsage) {
    if (!usage.used) continue
    const file = stylesheetFiles.get(usage.styleSheetId) ?? null
    const stats = file ? report.get(file) : null
    if (!stats) continue
    const rules = sourceRules.get(file)
    let index = rules.findIndex((rule) => rule.start === usage.startOffset && rule.end === usage.endOffset)
    if (index < 0) {
      index = rules.findIndex((rule) => rule.start <= usage.startOffset && rule.end >= usage.endOffset)
    }
    if (index >= 0) stats.used.add(index)
    else stats.unmatchedUsage += 1
  }
}

async function launchBrowser(headed) {
  const launchOptions = { headless: !headed, args: ['--disable-gpu', '--disable-gpu-compositing'] }
  try {
    return await chromium.launch(launchOptions)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('Executable doesn') && !message.includes('Playwright was just installed')) throw error
    return chromium.launch({ ...launchOptions, channel: 'chrome' })
  }
}

async function collectScenario(browser, options, sourceCss, sourceRules, report, scenarioNumber, scenarioTotal) {
  const context = await browser.newContext({
    viewport: { width: options.viewport.width, height: options.viewport.height },
    deviceScaleFactor: 1,
    colorScheme: options.theme.colorScheme,
  })
  await context.addInitScript(({ settingsKey, themeId }) => {
    window.localStorage.setItem(settingsKey, JSON.stringify({
      themeId,
      uiLanguage: 'zh-CN',
      companionName: 'Nexus',
      userName: 'User',
    }))
  }, { settingsKey: SETTINGS_STORAGE_KEY, themeId: options.theme.id })

  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  const cdp = await context.newCDPSession(page)
  const headers = new Map()
  cdp.on('CSS.styleSheetAdded', (event) => headers.set(event.header.styleSheetId, event.header))
  cdp.on('CSS.styleSheetRemoved', (event) => headers.delete(event.styleSheetId))

  try {
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    for (const section of SECTIONS) {
      headers.clear()
      await cdp.send('CSS.startRuleUsageTracking')
      const query = section.query ? `&${section.query}` : ''
      await page.goto(`${options.url}/?view=panel&section=settings${query}`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.settings-drawer')
      if (section.id !== 'home') {
        await page.waitForSelector(`.settings-page[data-section="${section.id}"]`)
        await page.waitForFunction((sectionId) => {
          const content = document.querySelector(
            `.settings-page[data-section="${sectionId}"] .settings-drawer__sections`,
          )
          return Boolean(
            content
            && content.children.length > 0
            && !content.querySelector('.settings-section-loading'),
          )
        }, section.id)
      }
      await page.waitForTimeout(100)
      const result = await cdp.send('CSS.stopRuleUsageTracking')
      const stylesheetFiles = await mapStyleSheets(cdp, headers, sourceCss)
      markRuleUsage(report, sourceRules, stylesheetFiles, result.ruleUsage ?? [])
    }
    console.log(`coverage ${scenarioNumber}/${scenarioTotal}: ${options.viewport.id}/${options.theme.id}`)
  } finally {
    await context.close()
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const sourceCss = loadSourceCss()
  const sourceRules = loadSourceRules(sourceCss)
  const report = makeReport(sourceRules)
  const scenarioTotal = VIEWPORTS.length * THEMES.length
  const browser = await launchBrowser(options.headed)
  try {
    let scenarioNumber = 0
    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        scenarioNumber += 1
        await collectScenario(browser, { ...options, viewport, theme }, sourceCss, sourceRules, report, scenarioNumber, scenarioTotal)
      }
    }
  } finally {
    await browser.close()
  }

  const files = STYLE_FILES.map((file) => {
    const stats = report.get(file)
    const unused = sourceRules.get(file).filter((_, index) => !stats.used.has(index))
    return {
      file,
      total: stats.total,
      used: stats.used.size,
      unused: unused.length,
      unmatchedUsage: stats.unmatchedUsage,
      unusedSelectors: unused.map((rule) => rule.selector),
    }
  })
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    url: options.url,
    scenarios: scenarioTotal * SECTIONS.length,
    files,
    totals: {
      total: files.reduce((sum, file) => sum + file.total, 0),
      used: files.reduce((sum, file) => sum + file.used, 0),
      unused: files.reduce((sum, file) => sum + file.unused, 0),
    },
  }
  await mkdir(path.dirname(path.resolve(options.out)), { recursive: true })
  await writeFile(path.resolve(options.out), `${JSON.stringify(result, null, 2)}\n`)
  console.log(`CSS coverage: ${result.totals.used}/${result.totals.total} rules used across ${result.scenarios} page states`)
  console.log(`report: ${path.resolve(options.out)}`)
}

await main()
