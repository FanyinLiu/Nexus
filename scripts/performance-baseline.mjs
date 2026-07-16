#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUILD_FINGERPRINT_ALGORITHM,
  BUILD_FINGERPRINT_SCHEMA_VERSION,
  computeBuildInputFingerprint,
} from './build-fingerprint.mjs'
import { buildHeavyModuleAuditReport } from './heavy-module-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_ASSETS_DIR = join('dist', 'assets')

const BUDGETS = {
  totalAssetBytes: 35_000_000,
  totalJavaScriptBytes: 5_000_000,
  totalCssBytes: 710_000,
  totalWasmBytes: 25_000_000,
  maxJavaScriptChunkBytes: 1_200_000,
  maxCssChunkBytes: 480_000,
  maxInitialCssChunkBytes: 260_000,
  maxOnboardingGuideCssChunkBytes: 30_000,
  maxSettingsStyleCssChunkBytes: 200_000,
  totalSettingsStyleCssChunkBytes: 330_000,
  maxSettingsDrawerResidualCssChunkBytes: 20_000,
  maxSettingsDrawerEntryChunkBytes: 100_000,
  maxSettingsUiChunkBytes: 390_000,
  totalSettingsUiChunkBytes: 390_000,
}

const REQUIRED_SETTINGS_UI_CHUNK_BASES = [
  'AutonomySectionV3',
  'ChatSectionV3',
  'ConsoleSectionV3',
  'HistorySectionV3',
  'IntegrationsSectionV3',
  'LettersSectionV3',
  'LorebooksSectionV3',
  'MemorySectionV3',
  'ModelSectionV3',
  'ToolsSectionV3',
  'VoiceSectionV3',
  'WindowSectionV3',
]
const OPTIONAL_SETTINGS_UI_CHUNK_BASES = ['SettingsV3Primitives']
const SETTINGS_UI_CHUNK_BASES = [
  'settings-ui',
  ...REQUIRED_SETTINGS_UI_CHUNK_BASES,
  ...OPTIONAL_SETTINGS_UI_CHUNK_BASES,
]
const SETTINGS_UI_CHUNK_MATCHERS = Object.fromEntries(SETTINGS_UI_CHUNK_BASES.map((base) => [
  base,
  new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:-[A-Za-z0-9_-]+)?\\.js$`),
]))
const SETTINGS_STYLE_CSS_BASES = [
  'settingsStylesFoundation',
  'settingsStylesTheme',
  'settingsStylesThemeLegacy',
  'settingsStylesThemeAligned',
  'settingsStylesSurface',
  'settingsStylesFinal',
]
const SETTINGS_STYLE_CSS_MATCHERS = Object.fromEntries(SETTINGS_STYLE_CSS_BASES.map((base) => [
  base,
  new RegExp(`^${base}(?:-[A-Za-z0-9_-]+)?\\.css$`),
]))
const ONBOARDING_GUIDE_CSS_MATCHER = /^OnboardingGuide(?:-[A-Za-z0-9_-]+)?\.css$/
const FORBIDDEN_INITIAL_ONBOARDING_PATTERNS = [
  /\.onboarding-[A-Za-z0-9_-]+/g,
  /\.ai-disclosure-[A-Za-z0-9_-]+/g,
  /@keyframes\s+onboarding-[A-Za-z0-9_-]+/g,
]

const HEADROOM_WARNINGS = {
  totalCssBytes: 0.9,
  maxCssChunkBytes: 0.9,
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

function matchSettingsUiChunkBase(fileName) {
  return SETTINGS_UI_CHUNK_BASES.find((base) => SETTINGS_UI_CHUNK_MATCHERS[base].test(fileName)) ?? null
}

function matchSettingsStyleCssBase(fileName) {
  return SETTINGS_STYLE_CSS_BASES.find((base) => SETTINGS_STYLE_CSS_MATCHERS[base].test(fileName)) ?? null
}

function isLegacySettingsCssChunk(fileName) {
  return /^settingsDrawerEntry(?:-[A-Za-z0-9_-]+)?\.css$/.test(fileName)
}

function hasCompleteSettingsStyleBundles(assetMetrics) {
  return SETTINGS_STYLE_CSS_BASES.every((base) => (
    (assetMetrics.settingsStyleCssChunksByBase[base] ?? []).length === 1
  ))
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
  const initialCssChunks = assets.filter((asset) => (
    asset.kind === 'css' && /^index(?:[-.][A-Za-z0-9_-]+)?\.css$/.test(asset.fileName)
  ))
  const initialCssChunk = initialCssChunks[0] ?? null
  const onboardingGuideCssChunks = assets.filter((asset) => (
    asset.kind === 'css' && ONBOARDING_GUIDE_CSS_MATCHER.test(asset.fileName)
  ))
  const onboardingGuideCssChunk = onboardingGuideCssChunks.length === 1
    ? onboardingGuideCssChunks[0]
    : null
  const initialCssForbiddenOnboardingSelectors = [...new Set(initialCssChunks.flatMap((asset) => {
    const source = readFileSync(join(assetsDir, asset.fileName), 'utf8')
    return FORBIDDEN_INITIAL_ONBOARDING_PATTERNS.flatMap((pattern) => (
      [...source.matchAll(pattern)].map((match) => match[0].replace(/\s+/g, ' '))
    ))
  }))]
  const settingsDrawerEntryChunk = assets.find((asset) => (
    asset.kind === 'javascript' && /^settingsDrawerEntry[-.]/.test(asset.fileName)
  )) ?? null
  const settingsStyleCssChunks = assets.filter((asset) => (
    asset.kind === 'css' && matchSettingsStyleCssBase(asset.fileName) !== null
  ))
  const legacySettingsCssChunks = assets.filter((asset) => asset.kind === 'css' && isLegacySettingsCssChunk(asset.fileName))
  const settingsStyleCssChunksByBase = Object.fromEntries(SETTINGS_STYLE_CSS_BASES.map((base) => [
    base,
    settingsStyleCssChunks.filter((asset) => matchSettingsStyleCssBase(asset.fileName) === base),
  ]))
  const largestSettingsStyleCssChunk = settingsStyleCssChunks.reduce(
    (largest, asset) => (!largest || asset.bytes > largest.bytes ? asset : largest),
    null,
  )
  const totalSettingsStyleCssChunkBytes = settingsStyleCssChunks.reduce((sum, asset) => sum + asset.bytes, 0)
  const settingsUiChunks = assets.filter((asset) => (
    asset.kind === 'javascript' && matchSettingsUiChunkBase(asset.fileName) !== null
  ))
  const settingsUiChunksByBase = Object.fromEntries(SETTINGS_UI_CHUNK_BASES.map((base) => [
    base,
    settingsUiChunks.filter((asset) => matchSettingsUiChunkBase(asset.fileName) === base),
  ]))
  const largestSettingsUiChunk = settingsUiChunks.reduce(
    (largest, asset) => (!largest || asset.bytes > largest.bytes ? asset : largest),
    null,
  )
  const totalSettingsUiChunkBytes = settingsUiChunks.reduce((sum, asset) => sum + asset.bytes, 0)
  return {
    assetCount: assets.length,
    totals,
    largestAssets: assets.slice(0, 8),
    largestJavaScriptChunk,
    largestCssChunk,
    initialCssChunks,
    initialCssChunk,
    onboardingGuideCssChunks,
    onboardingGuideCssChunk,
    initialCssForbiddenOnboardingSelectors,
    legacySettingsCssChunks,
    settingsStyleCssChunks,
    settingsStyleCssChunksByBase,
    settingsCssChunks: settingsStyleCssChunks,
    largestSettingsStyleCssChunk,
    largestSettingsCssChunk: largestSettingsStyleCssChunk,
    totalSettingsStyleCssChunkBytes,
    totalSettingsCssChunkBytes: totalSettingsStyleCssChunkBytes,
    settingsDrawerEntryChunk,
    settingsUiChunks,
    settingsUiChunksByBase,
    settingsUiChunk: largestSettingsUiChunk,
    largestSettingsUiChunk,
    totalSettingsUiChunkBytes,
  }
}

function settingsUiChunkErrors(assetMetrics) {
  const errors = []
  for (const base of ['settings-ui', ...REQUIRED_SETTINGS_UI_CHUNK_BASES]) {
    const matches = assetMetrics.settingsUiChunksByBase[base] ?? []
    if (matches.length === 0) {
      errors.push({ metric: 'missingSettingsUiChunk', actual: 0, budget: 1, chunk: base })
    } else if (matches.length > 1) {
      errors.push({ metric: 'duplicateSettingsUiChunk', actual: matches.length, budget: 1, chunk: base })
    }
  }
  return errors
}

function settingsStyleCssChunkErrors(assetMetrics) {
  const errors = []
  for (const base of SETTINGS_STYLE_CSS_BASES) {
    const matches = assetMetrics.settingsStyleCssChunksByBase[base] ?? []
    if (matches.length === 0) {
      errors.push({ metric: 'missingSettingsCssChunk', actual: 0, budget: 1, chunk: base })
    } else if (matches.length > 1) {
      errors.push({ metric: 'duplicateSettingsCssChunk', actual: matches.length, budget: 1, chunk: base })
    }
  }
  if (assetMetrics.legacySettingsCssChunks.length > 0) {
    const actual = assetMetrics.legacySettingsCssChunks.reduce((sum, asset) => sum + asset.bytes, 0)
    const files = assetMetrics.legacySettingsCssChunks.map((asset) => asset.fileName)
    if (!hasCompleteSettingsStyleBundles(assetMetrics)) {
      errors.push({ metric: 'legacySettingsCssChunk', actual, budget: 0, files })
    } else if (actual > BUDGETS.maxSettingsDrawerResidualCssChunkBytes) {
      errors.push({
        metric: 'maxSettingsDrawerResidualCssChunkBytes',
        actual,
        budget: BUDGETS.maxSettingsDrawerResidualCssChunkBytes,
        files,
      })
    }
  }
  if (assetMetrics.settingsStyleCssChunks.length > 0) {
    const largest = assetMetrics.largestSettingsStyleCssChunk?.bytes ?? 0
    const aggregate = assetMetrics.totalSettingsStyleCssChunkBytes
    if (largest > BUDGETS.maxSettingsStyleCssChunkBytes) {
      errors.push({ metric: 'maxSettingsStyleCssChunkBytes', actual: largest, budget: BUDGETS.maxSettingsStyleCssChunkBytes })
    }
    if (aggregate > BUDGETS.totalSettingsStyleCssChunkBytes) {
      errors.push({ metric: 'totalSettingsStyleCssChunkBytes', actual: aggregate, budget: BUDGETS.totalSettingsStyleCssChunkBytes })
    }
  }
  return errors
}

function onboardingGuideCssChunkErrors(assetMetrics) {
  const errors = []
  if (assetMetrics.onboardingGuideCssChunks.length === 0) {
    errors.push({ metric: 'missingOnboardingGuideCssChunk', actual: 0, budget: 1 })
  } else if (assetMetrics.onboardingGuideCssChunks.length > 1) {
    errors.push({
      metric: 'duplicateOnboardingGuideCssChunk',
      actual: assetMetrics.onboardingGuideCssChunks.length,
      budget: 1,
      files: assetMetrics.onboardingGuideCssChunks.map((asset) => asset.fileName),
    })
  }
  if (assetMetrics.initialCssForbiddenOnboardingSelectors.length > 0) {
    errors.push({
      metric: 'initialCssOnboardingSelectorLeak',
      actual: assetMetrics.initialCssForbiddenOnboardingSelectors.length,
      budget: 0,
      selectors: assetMetrics.initialCssForbiddenOnboardingSelectors,
    })
  }
  return errors
}

function readBuildFreshness(root = ROOT) {
  const stampPath = join(root, 'dist', 'build-integrity.json')
  if (!existsSync(stampPath)) {
    return {
      ok: false,
      status: 'missing',
      errors: [{ metric: 'missingBuildFingerprint', actual: 0, budget: 1 }],
    }
  }

  let stamp
  try {
    stamp = JSON.parse(readFileSync(stampPath, 'utf8'))
  } catch {
    return {
      ok: false,
      status: 'stale',
      errors: [{ metric: 'staleBuildFingerprint', actual: 1, budget: 0, reason: 'invalidStamp' }],
    }
  }

  const current = computeBuildInputFingerprint(root)
  const validStamp = stamp?.schemaVersion === BUILD_FINGERPRINT_SCHEMA_VERSION
    && stamp?.algorithm === BUILD_FINGERPRINT_ALGORITHM
    && typeof stamp?.inputFingerprint === 'string'
    && /^[a-f0-9]{64}$/.test(stamp.inputFingerprint)
    && Number.isInteger(stamp?.inputFileCount)
    && stamp.inputFileCount >= 0
  if (!validStamp || stamp.inputFingerprint !== current.digest || stamp.inputFileCount !== current.fileCount) {
    return {
      ok: false,
      status: 'stale',
      errors: [{ metric: 'staleBuildFingerprint', actual: 1, budget: 0 }],
      currentFingerprint: current.digest,
      stampedFingerprint: stamp?.inputFingerprint ?? null,
    }
  }

  return {
    ok: true,
    status: 'fresh',
    errors: [],
    currentFingerprint: current.digest,
    stampedFingerprint: stamp.inputFingerprint,
    inputFileCount: current.fileCount,
  }
}

function budgetErrors(assetMetrics, heavyReport, buildFreshness) {
  const errors = []
  errors.push(...settingsUiChunkErrors(assetMetrics))
  errors.push(...settingsStyleCssChunkErrors(assetMetrics))
  errors.push(...onboardingGuideCssChunkErrors(assetMetrics))
  errors.push(...buildFreshness.errors)
  if (!assetMetrics.settingsDrawerEntryChunk) {
    errors.push({ metric: 'missingSettingsDrawerEntryChunk', actual: 0, budget: 1 })
  }
  for (const [key, budget] of Object.entries(BUDGETS)) {
    let actual = assetMetrics.totals[key]
    if (key === 'maxJavaScriptChunkBytes') actual = assetMetrics.largestJavaScriptChunk?.bytes ?? 0
    if (key === 'maxCssChunkBytes') actual = assetMetrics.largestCssChunk?.bytes ?? 0
    if (key === 'maxInitialCssChunkBytes') actual = assetMetrics.initialCssChunk?.bytes ?? 0
    if (key === 'maxOnboardingGuideCssChunkBytes') actual = assetMetrics.onboardingGuideCssChunk?.bytes ?? 0
    if (key === 'maxSettingsDrawerEntryChunkBytes') actual = assetMetrics.settingsDrawerEntryChunk?.bytes ?? 0
    if (key === 'maxSettingsUiChunkBytes') actual = assetMetrics.largestSettingsUiChunk?.bytes ?? 0
    if (key === 'totalSettingsUiChunkBytes') actual = assetMetrics.totalSettingsUiChunkBytes
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
  if (key === 'maxOnboardingGuideCssChunkBytes') return assetMetrics.onboardingGuideCssChunk?.bytes ?? 0
  if (key === 'maxSettingsStyleCssChunkBytes') return assetMetrics.largestSettingsStyleCssChunk?.bytes ?? 0
  if (key === 'totalSettingsStyleCssChunkBytes') return assetMetrics.totalSettingsStyleCssChunkBytes
  if (key === 'maxSettingsDrawerResidualCssChunkBytes') {
    return assetMetrics.legacySettingsCssChunks.reduce((sum, asset) => sum + asset.bytes, 0)
  }
  if (key === 'maxSettingsDrawerEntryChunkBytes') return assetMetrics.settingsDrawerEntryChunk?.bytes ?? 0
  if (key === 'maxSettingsUiChunkBytes') return assetMetrics.largestSettingsUiChunk?.bytes ?? 0
  if (key === 'totalSettingsUiChunkBytes') return assetMetrics.totalSettingsUiChunkBytes
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
  const buildFreshness = readBuildFreshness(root)
  const errors = budgetErrors(assetMetrics, heavyReport, buildFreshness)
  const warnings = budgetWarnings(assetMetrics)
  return {
    schemaVersion: 1,
    budgets: BUDGETS,
    assetMetrics,
    heavyModuleSummary: heavyReport.summary,
    buildFreshness,
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
      readsStaticProjectInputs: true,
      readsDistBuildOutput: true,
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
  lines.push(`- onboarding CSS chunk: ${report.assetMetrics.onboardingGuideCssChunk?.fileName ?? 'none'} (${formatBytes(report.assetMetrics.onboardingGuideCssChunk?.bytes ?? 0)} / ${formatBytes(report.budgets.maxOnboardingGuideCssChunkBytes)})`)
  lines.push(`- settings CSS chunks: ${report.assetMetrics.settingsStyleCssChunks.length} (${formatBytes(report.assetMetrics.totalSettingsStyleCssChunkBytes)} aggregate / ${formatBytes(report.budgets.totalSettingsStyleCssChunkBytes)})`)
  lines.push(`- largest settings CSS chunk: ${report.assetMetrics.largestSettingsStyleCssChunk?.fileName ?? 'none'} (${formatBytes(report.assetMetrics.largestSettingsStyleCssChunk?.bytes ?? 0)} / ${formatBytes(report.budgets.maxSettingsStyleCssChunkBytes)})`)
  lines.push(`- settings drawer entry: ${report.assetMetrics.settingsDrawerEntryChunk?.fileName ?? 'none'} (${formatBytes(report.assetMetrics.settingsDrawerEntryChunk?.bytes ?? 0)} / ${formatBytes(report.budgets.maxSettingsDrawerEntryChunkBytes)})`)
  lines.push(`- build freshness: ${report.buildFreshness.status}`)
  lines.push(`- settings UI chunks: ${report.assetMetrics.settingsUiChunks.length} (${formatBytes(report.assetMetrics.totalSettingsUiChunkBytes)} total / ${formatBytes(report.budgets.totalSettingsUiChunkBytes)})`)
  lines.push(`- largest settings UI chunk: ${report.assetMetrics.largestSettingsUiChunk?.fileName ?? 'none'} (${formatBytes(report.assetMetrics.largestSettingsUiChunk?.bytes ?? 0)} / ${formatBytes(report.budgets.maxSettingsUiChunkBytes)})`)
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
