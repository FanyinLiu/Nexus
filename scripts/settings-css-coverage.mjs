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
  { id: 'settings.css', path: 'src/app/styles/settings.css' },
  { id: 'settings-home.css', path: 'src/app/styles/settings-home.css' },
  { id: 'settings-themes.css', path: 'src/app/styles/settings-themes.css' },
  { id: 'settings-themes-legacy.css', path: 'src/app/styles/settings-themes-legacy.css' },
  { id: 'settings-chat-aligned.css', path: 'src/app/styles/settings-chat-aligned.css' },
  { id: 'settings-chat-final.css', path: 'src/app/styles/settings-chat-final.css' },
  { id: 'settings-visual-system.css', path: 'src/app/styles/settings-visual-system.css' },
  { id: 'settings-visibility-final.css', path: 'src/app/styles/settings-visibility-final.css' },
  { id: 'settings-product-shell.css', path: 'src/app/styles/settings-product-shell.css' },
  { id: 'settings-product-reference-final.css', path: 'src/app/styles/settings-product-reference-final.css' },
  { id: 'settings-product-reference-modern-bridge.css', path: 'src/app/styles/settings-product-reference-modern-bridge.css' },
  { id: 'settings-v2.css', path: 'src/features/uiV2/settings-v2.css' },
  { id: 'settings-v3.css', path: 'src/features/settingsV3/settings-v3.css' },
  { id: 'settings-v3-collection.css', path: 'src/features/settingsV3/settings-v3-collection.css' },
  { id: 'chat-section-v3.css', path: 'src/features/settingsV3/chat-section-v3.css' },
  { id: 'voice-section-v3.css', path: 'src/features/settingsV3/voice-section-v3.css' },
  { id: 'integrations-section-v3.css', path: 'src/features/settingsV3/integrations-section-v3.css' },
  { id: 'console-section-v3.css', path: 'src/features/settingsV3/console-section-v3.css' },
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
  { id: 'integrations', query: 'settingsSection=integrations' },
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
const LANES = [
  { id: 'modern', query: '' },
  { id: 'fallback', query: 'uiV2=0' },
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
    file.id,
    readFileSync(path.join(ROOT, file.path), 'utf8'),
  ]))
}

function loadSourceRules(sourceCss) {
  return new Map(STYLE_FILES.map((file) => {
    const css = sourceCss.get(file.id)
    const root = postcss.parse(css, { from: file.path })
    const rules = []
    root.walkRules((rule) => {
      if (!(rule.nodes ?? []).some((node) => node.type === 'decl')) return
      rules.push({
        start: rule.source?.start?.offset ?? -1,
        end: rule.source?.end?.offset ?? -1,
        selector: rule.selector.replace(/\s+/g, ' ').trim(),
      })
    })
    return [file.id, rules]
  }))
}

function makeReport(sourceRules) {
  return new Map(STYLE_FILES.map((file) => [file.id, {
    mapped: false,
    total: sourceRules.get(file.id).length,
    used: new Set(),
    unmatchedUsage: 0,
  }]))
}

function mergeReport(target, source) {
  for (const file of STYLE_FILES) {
    const targetStats = target.get(file.id)
    const sourceStats = source.get(file.id)
    targetStats.mapped ||= sourceStats.mapped
    targetStats.unmatchedUsage += sourceStats.unmatchedUsage
    for (const index of sourceStats.used) targetStats.used.add(index)
  }
}

function serializeReport(report, sourceRules) {
  return STYLE_FILES.map((file) => {
    const stats = report.get(file.id)
    const unused = sourceRules.get(file.id).filter((_, index) => !stats.used.has(index))
    return {
      file: file.path,
      mapped: stats.mapped,
      total: stats.total,
      used: stats.used.size,
      unused: unused.length,
      unmatchedUsage: stats.unmatchedUsage,
      unusedSelectors: unused.map((rule) => rule.selector),
    }
  })
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
  return { stylesheetFiles, unmatched: [...unmatched] }
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
      const query = [options.lane.query, section.query].filter(Boolean).join('&')
      const querySuffix = query ? `&${query}` : ''
      await page.goto(`${options.url}/?view=panel&section=settings${querySuffix}`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.settings-drawer')
      if (options.lane.id === 'modern') {
        await page.waitForSelector('.settings-v2')
        if (section.id === 'home') {
          await page.waitForSelector('.settings-v2__home')
        } else {
          await page.waitForSelector('.settings-v3-page:not(.is-hidden)')
          await page.waitForFunction(() => {
            const content = document.querySelector('.settings-v2__active-section .settings-drawer__sections')
            const activePage = content?.querySelector('.settings-v3-page:not(.is-hidden)')
            return Boolean(
              content
              && activePage
              && activePage.children.length > 0
              && !content.querySelector('.settings-section-loading'),
            )
          })
        }
      } else {
        await page.waitForSelector('.settings-drawer:not(.settings-drawer--v2)')
        if (section.id === 'home') {
          await page.waitForSelector('.settings-home')
        } else {
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
      }
      if (section.id === 'console') {
        await page.locator('.settings-v3-disclosure').evaluateAll((nodes) => {
          for (const node of nodes) node.open = true
        })
        await page.waitForSelector('.settings-plan-panel__empty', { state: 'visible' })
      }
      await page.waitForTimeout(100)
      const result = await cdp.send('CSS.stopRuleUsageTracking')
      const { stylesheetFiles } = await mapStyleSheets(cdp, headers, sourceCss)
      for (const file of stylesheetFiles.values()) report.get(file).mapped = true
      markRuleUsage(report, sourceRules, stylesheetFiles, result.ruleUsage ?? [])
    }
    console.log(`coverage ${scenarioNumber}/${scenarioTotal}: ${options.lane.id}/${options.viewport.id}/${options.theme.id}`)
  } finally {
    await context.close()
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const sourceCss = loadSourceCss()
  const sourceRules = loadSourceRules(sourceCss)
  const report = makeReport(sourceRules)
  const laneReports = new Map(LANES.map((lane) => [lane.id, makeReport(sourceRules)]))
  const scenarioTotal = LANES.length * VIEWPORTS.length * THEMES.length
  const browser = await launchBrowser(options.headed)
  try {
    let scenarioNumber = 0
    for (const lane of LANES) {
      const laneReport = laneReports.get(lane.id)
      for (const viewport of VIEWPORTS) {
        for (const theme of THEMES) {
          scenarioNumber += 1
          await collectScenario(
            browser,
            { ...options, lane, viewport, theme },
            sourceCss,
            sourceRules,
            laneReport,
            scenarioNumber,
            scenarioTotal,
          )
        }
      }
      mergeReport(report, laneReport)
    }
  } finally {
    await browser.close()
  }

  const files = serializeReport(report, sourceRules)
  const lanes = Object.fromEntries([...laneReports.entries()].map(([id, laneReport]) => (
    [id, { files: serializeReport(laneReport, sourceRules) }]
  )))
  const errors = []
  const warnings = []
  const modernV2 = lanes.modern.files.find((file) => file.file.endsWith('/settings-v2.css'))
  const modernV3 = lanes.modern.files.find((file) => file.file.endsWith('/settings-v3.css'))
  const modernBridge = lanes.modern.files.find((file) => file.file.endsWith('/settings-product-reference-modern-bridge.css'))
  const modernLegacyTheme = lanes.modern.files.find((file) => file.file.endsWith('/settings-themes-legacy.css'))
  const modernLegacyProductReference = lanes.modern.files.find((file) => file.file.endsWith('/settings-product-reference-final.css'))
  const modernSectionStyles = [
    'settings-v3-collection.css',
    'chat-section-v3.css',
    'voice-section-v3.css',
    'integrations-section-v3.css',
    'console-section-v3.css',
  ].map((fileName) => lanes.modern.files.find((file) => file.file.endsWith(`/${fileName}`)))
  const fallbackV2 = lanes.fallback.files.find((file) => file.file.endsWith('/settings-v2.css'))
  const fallbackLegacyTheme = lanes.fallback.files.find((file) => file.file.endsWith('/settings-themes-legacy.css'))
  const fallbackLegacyProductReference = lanes.fallback.files.find((file) => file.file.endsWith('/settings-product-reference-final.css'))
  const fallbackLegacyUsed = lanes.fallback.files
    .filter((file) => file.file.startsWith('src/app/styles/'))
    .reduce((sum, file) => sum + file.used, 0)
  if (!modernV2?.mapped || !modernV2.used) errors.push('modern lane did not map and use settings-v2.css')
  if (!modernV3?.mapped || !modernV3.used) errors.push('modern lane did not map and use settings-v3.css')
  if (!modernBridge?.mapped || !modernBridge.used) errors.push('modern lane did not map and use the product reference bridge')
  if (modernLegacyProductReference?.mapped || modernLegacyProductReference?.used) {
    errors.push('modern lane unexpectedly loaded the legacy product reference CSS')
  }
  if (modernLegacyTheme?.mapped || modernLegacyTheme?.used) {
    errors.push('modern lane unexpectedly loaded the legacy theme tail')
  }
  for (const sectionStyle of modernSectionStyles) {
    if (!sectionStyle?.mapped || !sectionStyle.used) {
      errors.push(`modern lane did not map and use ${sectionStyle?.file.split('/').at(-1) ?? 'a section CSS file'}`)
    }
  }
  if (!fallbackLegacyUsed) errors.push('fallback lane did not use legacy settings CSS')
  if (!fallbackLegacyProductReference?.mapped || !fallbackLegacyProductReference.used) {
    errors.push('fallback lane did not map and use the legacy product reference CSS')
  }
  if (!fallbackLegacyTheme?.mapped || !fallbackLegacyTheme.used) {
    errors.push('fallback lane did not map and use the legacy theme tail')
  }
  if (fallbackV2?.used) errors.push('fallback lane unexpectedly used settings-v2.css')
  const unmatchedUsage = files.reduce((sum, file) => sum + file.unmatchedUsage, 0)
  if (unmatchedUsage) warnings.push(`${unmatchedUsage} used CSS ranges could not be mapped back to source rules`)
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    url: options.url,
    scenarios: scenarioTotal * SECTIONS.length,
    files,
    lanes,
    totals: {
      total: files.reduce((sum, file) => sum + file.total, 0),
      used: files.reduce((sum, file) => sum + file.used, 0),
      unused: files.reduce((sum, file) => sum + file.unused, 0),
      unmatchedUsage,
    },
    errors,
    warnings,
    summary: { ok: errors.length === 0, errors: errors.length, warnings: warnings.length },
  }
  await mkdir(path.dirname(path.resolve(options.out)), { recursive: true })
  await writeFile(path.resolve(options.out), `${JSON.stringify(result, null, 2)}\n`)
  console.log(`CSS coverage: ${result.totals.used}/${result.totals.total} rules used across ${result.scenarios} page states`)
  for (const error of errors) console.error(`ERROR: ${error}`)
  for (const warning of warnings) console.warn(`WARN: ${warning}`)
  console.log(`report: ${path.resolve(options.out)}`)
  if (errors.length) process.exitCode = 1
}

await main()
