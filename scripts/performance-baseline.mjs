#!/usr/bin/env node

import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHeavyModuleAuditReport } from './heavy-module-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_ASSETS_DIR = join('dist', 'assets')

const BUDGETS = {
  totalAssetBytes: 35_000_000,
  totalJavaScriptBytes: 5_000_000,
  totalCssBytes: 760_000,
  totalWasmBytes: 25_000_000,
  maxJavaScriptChunkBytes: 1_200_000,
  maxCssChunkBytes: 480_000,
  maxInitialCssChunkBytes: 450_000,
  maxSettingsDrawerCssChunkBytes: 480_000,
  maxSettingsDrawerEntryChunkBytes: 100_000,
  maxSettingsUiChunkBytes: 390_000,
}

const SETTINGS_UI_CHUNK_PATTERN = /^(?:settings-ui|AutonomySection|ChatSection|ConsoleSection|HistorySection|IntegrationsSection|LettersSection|LorebooksSection|MemorySection|ModelSection|SpeechInputSection|SpeechOutputSection|ToolsSection|VoiceSection|WindowSection)[-.]/

const HEADROOM_WARNINGS = {
  totalCssBytes: 0.9,
  maxCssChunkBytes: 0.9,
  maxSettingsDrawerCssChunkBytes: 0.9,
  maxSettingsUiChunkBytes: 0.9,
}

function classifyAsset(fileName) {
  const extension = extname(fileName)
  if (extension === '.js') return 'javascript'
  if (extension === '.css') return 'css'
  if (extension === '.wasm') return 'wasm'
  if (['.jpg', '.jpeg', '.png', '.svg', '.ico', '.webp'].includes(extension)) return 'image'
  return 'other'
}

function readAssetMetrics(root = ROOT) {
  const assetsDir = join(root, DIST_ASSETS_DIR)
  if (!existsSync(assetsDir)) {
    throw new Error('dist/assets is missing; run npm run build before npm run performance:baseline')
  }

  const assets = readdirSync(assetsDir)
    .map((fileName) => {
      const bytes = statSync(join(assetsDir, fileName)).size
      return { fileName, bytes, kind: classifyAsset(fileName) }
    })
    .sort((left, right) => right.bytes - left.bytes)

  const totals = {
    totalAssetBytes: 0,
    totalJavaScriptBytes: 0,
    totalCssBytes: 0,
    totalWasmBytes: 0,
    totalImageBytes: 0,
    totalOtherBytes: 0,
  }

  for (const asset of assets) {
    totals.totalAssetBytes += asset.bytes
    if (asset.kind === 'javascript') totals.totalJavaScriptBytes += asset.bytes
    else if (asset.kind === 'css') totals.totalCssBytes += asset.bytes
    else if (asset.kind === 'wasm') totals.totalWasmBytes += asset.bytes
    else if (asset.kind === 'image') totals.totalImageBytes += asset.bytes
    else totals.totalOtherBytes += asset.bytes
  }

  const largestJavaScriptChunk = assets.find((asset) => asset.kind === 'javascript') ?? null
  const largestCssChunk = assets.find((asset) => asset.kind === 'css') ?? null
  const initialCssChunk = assets.find((asset) => (
    asset.kind === 'css' && /^index[-.]/.test(asset.fileName)
  )) ?? null
  const settingsDrawerCssChunk = assets.find((asset) => (
    asset.kind === 'css' && /^settingsDrawerEntry[-.]/.test(asset.fileName)
  )) ?? null
  const settingsDrawerEntryChunk = assets.find((asset) => (
    asset.kind === 'javascript' && /^settingsDrawerEntry[-.]/.test(asset.fileName)
  )) ?? null
  const settingsUiChunks = assets.filter((asset) => (
    asset.kind === 'javascript' && SETTINGS_UI_CHUNK_PATTERN.test(asset.fileName)
  ))
  const settingsUiChunk = settingsUiChunks[0] ?? null
  return {
    assetCount: assets.length,
    totals,
    largestAssets: assets.slice(0, 8),
    largestJavaScriptChunk,
    largestCssChunk,
    initialCssChunk,
    settingsDrawerCssChunk,
    settingsDrawerEntryChunk,
    settingsUiChunks,
    settingsUiChunk,
  }
}

function budgetErrors(assetMetrics, heavyReport) {
  const errors = []
  if (!assetMetrics.settingsDrawerCssChunk) {
    errors.push({ metric: 'missingSettingsDrawerCssChunk', actual: 0, budget: 1 })
  }
  if (!assetMetrics.settingsDrawerEntryChunk) {
    errors.push({ metric: 'missingSettingsDrawerEntryChunk', actual: 0, budget: 1 })
  }
  if (!assetMetrics.settingsUiChunk) {
    errors.push({ metric: 'missingSettingsUiChunk', actual: 0, budget: 1 })
  }
  for (const [key, budget] of Object.entries(BUDGETS)) {
    let actual = assetMetrics.totals[key]
    if (key === 'maxJavaScriptChunkBytes') actual = assetMetrics.largestJavaScriptChunk?.bytes ?? 0
    if (key === 'maxCssChunkBytes') actual = assetMetrics.largestCssChunk?.bytes ?? 0
    if (key === 'maxInitialCssChunkBytes') actual = assetMetrics.initialCssChunk?.bytes ?? 0
    if (key === 'maxSettingsDrawerCssChunkBytes') actual = assetMetrics.settingsDrawerCssChunk?.bytes ?? 0
    if (key === 'maxSettingsDrawerEntryChunkBytes') actual = assetMetrics.settingsDrawerEntryChunk?.bytes ?? 0
    if (key === 'maxSettingsUiChunkBytes') actual = assetMetrics.settingsUiChunk?.bytes ?? 0
    if (actual > budget) errors.push({ metric: key, actual, budget })
  }
  if (heavyReport.summary.errors > 0) {
    errors.push({ metric: 'heavyModuleAuditErrors', actual: heavyReport.summary.errors, budget: 0 })
  }
  return errors
}

function readBudgetMetric(assetMetrics, key) {
  if (key === 'maxJavaScriptChunkBytes') return assetMetrics.largestJavaScriptChunk?.bytes ?? 0
  if (key === 'maxCssChunkBytes') return assetMetrics.largestCssChunk?.bytes ?? 0
  if (key === 'maxInitialCssChunkBytes') return assetMetrics.initialCssChunk?.bytes ?? 0
  if (key === 'maxSettingsDrawerCssChunkBytes') return assetMetrics.settingsDrawerCssChunk?.bytes ?? 0
  if (key === 'maxSettingsDrawerEntryChunkBytes') return assetMetrics.settingsDrawerEntryChunk?.bytes ?? 0
  if (key === 'maxSettingsUiChunkBytes') return assetMetrics.settingsUiChunk?.bytes ?? 0
  return assetMetrics.totals[key] ?? 0
}

function budgetWarnings(assetMetrics) {
  return Object.entries(HEADROOM_WARNINGS).flatMap(([key, warningRatio]) => {
    const budget = BUDGETS[key]
    const warningAt = Math.floor(budget * warningRatio)
    const actual = readBudgetMetric(assetMetrics, key)
    if (actual <= warningAt || actual > budget) return []
    return [{
      metric: key,
      actual,
      budget,
      warningAt,
      usage: Number((actual / budget).toFixed(4)),
    }]
  })
}

export function buildPerformanceBaselineReport(root = ROOT) {
  const assetMetrics = readAssetMetrics(root)
  const heavyReport = buildHeavyModuleAuditReport(root)
  const errors = budgetErrors(assetMetrics, heavyReport)
  const warnings = budgetWarnings(assetMetrics)
  return {
    schemaVersion: 1,
    budgets: BUDGETS,
    assetMetrics,
    heavyModuleSummary: heavyReport.summary,
    errors,
    warnings,
    summary: {
      ok: errors.length === 0,
      errors: errors.length,
      warnings: warnings.length,
    },
    privacy: {
      readsUserStorage: false,
      readsRuntimeMetrics: false,
      staticBuildOutputOnly: true,
    },
  }
}

function formatBytes(bytes) {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`
  return `${(bytes / 1_000).toFixed(1)} KB`
}

function formatHumanReport(report) {
  const lines = ['Performance baseline']
  lines.push(`- assets: ${report.assetMetrics.assetCount}`)
  lines.push(`- total assets: ${formatBytes(report.assetMetrics.totals.totalAssetBytes)} / ${formatBytes(report.budgets.totalAssetBytes)}`)
  lines.push(`- total JS: ${formatBytes(report.assetMetrics.totals.totalJavaScriptBytes)} / ${formatBytes(report.budgets.totalJavaScriptBytes)}`)
  lines.push(`- total CSS: ${formatBytes(report.assetMetrics.totals.totalCssBytes)} / ${formatBytes(report.budgets.totalCssBytes)}`)
  lines.push(`- total WASM: ${formatBytes(report.assetMetrics.totals.totalWasmBytes)} / ${formatBytes(report.budgets.totalWasmBytes)}`)
  lines.push(`- largest JS chunk: ${report.assetMetrics.largestJavaScriptChunk?.fileName ?? 'none'} (${formatBytes(report.assetMetrics.largestJavaScriptChunk?.bytes ?? 0)})`)
  lines.push(`- largest CSS chunk: ${report.assetMetrics.largestCssChunk?.fileName ?? 'none'} (${formatBytes(report.assetMetrics.largestCssChunk?.bytes ?? 0)})`)
  lines.push(`- initial CSS chunk: ${report.assetMetrics.initialCssChunk?.fileName ?? 'none'} (${formatBytes(report.assetMetrics.initialCssChunk?.bytes ?? 0)} / ${formatBytes(report.budgets.maxInitialCssChunkBytes)})`)
  lines.push(`- settings drawer CSS: ${report.assetMetrics.settingsDrawerCssChunk?.fileName ?? 'none'} (${formatBytes(report.assetMetrics.settingsDrawerCssChunk?.bytes ?? 0)} / ${formatBytes(report.budgets.maxSettingsDrawerCssChunkBytes)})`)
  lines.push(`- settings drawer entry: ${report.assetMetrics.settingsDrawerEntryChunk?.fileName ?? 'none'} (${formatBytes(report.assetMetrics.settingsDrawerEntryChunk?.bytes ?? 0)} / ${formatBytes(report.budgets.maxSettingsDrawerEntryChunkBytes)})`)
  lines.push(`- largest settings UI chunk: ${report.assetMetrics.settingsUiChunk?.fileName ?? 'none'} (${formatBytes(report.assetMetrics.settingsUiChunk?.bytes ?? 0)} / ${formatBytes(report.budgets.maxSettingsUiChunkBytes)}; ${report.assetMetrics.settingsUiChunks.length} lazy chunks)`)
  lines.push(`- heavy module audit errors: ${report.heavyModuleSummary.errors}`)
  lines.push('- largest assets:')
  for (const asset of report.assetMetrics.largestAssets) {
    lines.push(`  ${asset.fileName}: ${formatBytes(asset.bytes)}`)
  }
  lines.push('')
  lines.push(`ERROR budgetViolations: ${report.errors.length}`)
  if (report.errors.length) {
    lines.push(`  ${report.errors.map((item) => `${item.metric} ${item.actual}/${item.budget}`).join(', ')}`)
  }
  lines.push(`WARN budgetHeadroom: ${report.warnings.length}`)
  if (report.warnings.length) {
    lines.push(`  ${report.warnings.map((item) => `${item.metric} ${item.actual}/${item.budget} warn>${item.warningAt}`).join(', ')}`)
  }
  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors} warnings=${report.summary.warnings}`)
  return lines.join('\n')
}

function main(argv) {
  const report = buildPerformanceBaselineReport(ROOT)
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
