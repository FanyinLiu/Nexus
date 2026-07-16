#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { SETTINGS_STYLE_BUNDLES, SETTINGS_STYLE_IMPORT_ORDER } from './settings-surface-boundaries.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = 'src/app/settingsDrawerEntry.ts'
const MAX_LEGACY_RULES = 1_700
const MAX_MODERN_SHARED_RULES = 190
const MAX_MODERN_SECTION_RULES = 120
const LEGACY_FILES = [
  'settings.css',
  'settings-home.css',
  'settings-themes.css',
  'settings-themes-legacy.css',
  'settings-chat-aligned.css',
  'settings-chat-final.css',
  'settings-visual-system.css',
  'settings-visibility-final.css',
  'settings-product-shell.css',
  'settings-product-reference-final.css',
]
const STYLE_GROUPS = [
  {
    id: 'legacy',
    maxRules: MAX_LEGACY_RULES,
    files: LEGACY_FILES.map((file) => ({
      id: file,
      path: `src/app/styles/${file}`,
    })),
  },
  {
    id: 'modernShared',
    maxRules: MAX_MODERN_SHARED_RULES,
    files: [
      { id: 'settings-v2.css', path: 'src/features/uiV2/settings-v2.css' },
      { id: 'settings-v3.css', path: 'src/features/settingsV3/settings-v3.css' },
      { id: 'settings-v3-collection.css', path: 'src/features/settingsV3/settings-v3-collection.css' },
      { id: 'settings-product-reference-modern-bridge.css', path: 'src/app/styles/settings-product-reference-modern-bridge.css' },
    ],
  },
  {
    id: 'modernSection',
    maxRules: MAX_MODERN_SECTION_RULES,
    files: [
      { id: 'chat-section-v3.css', path: 'src/features/settingsV3/chat-section-v3.css' },
      { id: 'voice-section-v3.css', path: 'src/features/settingsV3/voice-section-v3.css' },
      { id: 'integrations-section-v3.css', path: 'src/features/settingsV3/integrations-section-v3.css' },
      { id: 'console-section-v3.css', path: 'src/features/settingsV3/console-section-v3.css' },
    ],
  },
]
const STYLE_FILES = STYLE_GROUPS.flatMap((group) => (
  group.files.map((file) => ({ ...file, group: group.id }))
))
const STYLE_BUNDLE_ENTRY = 'src/app/settingsStyleBundles.ts'

function extractStaticCssImports(source) {
  return [...source.matchAll(/^import ['"](.\/styles\/settings[^'"]*\.css)['"]$/gm)]
    .map((match) => match[1])
}

function extractDynamicStyleImports(source) {
  return [...source.matchAll(/import\(['"](\.\/settingsStyles[^'"]+)['"]\)/g)]
    .map((match) => match[1])
}

function extractOrderedStyleSpecifiers(source) {
  return [...source.matchAll(/(?:^import\s+['"]([^'"]+)['"]|await\s+import\(['"]([^'"]+)['"]\))/gm)]
    .map((match) => match[1] ?? match[2])
}

function extractBundleCssImports(source, repoRoot, modulePath, seen = new Set()) {
  if (seen.has(modulePath)) return []
  seen.add(modulePath)
  return extractOrderedStyleSpecifiers(source).flatMap((specifier) => {
    if (specifier.startsWith('./styles/settings') && specifier.endsWith('.css')) return [specifier]
    if (!specifier.startsWith('./settingsStylesTheme')) return []
    const nestedModule = join(dirname(modulePath), `${specifier.slice(2)}.ts`)
    try {
      return extractBundleCssImports(
        readFileSync(join(repoRoot, nestedModule), 'utf8'),
        repoRoot,
        nestedModule,
        seen,
      )
    } catch {
      return []
    }
  })
}

function readSettingsStyleBundleContract(repoRoot, entrySource) {
  const errors = []
  let loaderSource = ''
  try {
    loaderSource = readFileSync(join(repoRoot, STYLE_BUNDLE_ENTRY), 'utf8')
  } catch {
    errors.push({
      type: 'missing-style-bundle-loader',
      message: `${STYLE_BUNDLE_ENTRY} is missing`,
    })
  }

  const expectedDynamicImports = SETTINGS_STYLE_BUNDLES.map((bundle) => bundle.importPath)
  const actualDynamicImports = extractDynamicStyleImports(loaderSource)
  if (JSON.stringify(actualDynamicImports) !== JSON.stringify(expectedDynamicImports)) {
    errors.push({
      type: 'style-bundle-order',
      message: 'settings style loaders must be exactly A foundation, B theme, C surface, D final',
      expectedOrder: expectedDynamicImports,
      actualOrder: actualDynamicImports,
    })
  }
  if (loaderSource.includes('Promise.all')) {
    errors.push({
      type: 'parallel-style-bundles',
      message: 'settings style bundles must load sequentially; Promise.all is forbidden',
    })
  }
  if (!/for\s*\(const bundle of SETTINGS_STYLE_BUNDLES\)[\s\S]*await bundle\.load\(\)/.test(loaderSource)) {
    errors.push({
      type: 'unordered-style-bundles',
      message: 'settings style loader must await each bundle in manifest order',
    })
  }
  if (extractStaticCssImports(entrySource).length > 0) {
    errors.push({
      type: 'static-entry-css-imports',
      message: 'settingsDrawerEntry must not statically aggregate settings CSS',
      actualImports: extractStaticCssImports(entrySource),
    })
  }
  if ((entrySource.match(/await\s+loadSettingsStyleBundles\(\)/g) ?? []).length !== 1) {
    errors.push({
      type: 'entry-style-loader',
      message: 'settingsDrawerEntry must await the ordered style bundle loader exactly once',
    })
  }

  const bundleImports = []
  for (const bundle of SETTINGS_STYLE_BUNDLES) {
    let moduleSource = ''
    try {
      moduleSource = readFileSync(join(repoRoot, bundle.module), 'utf8')
    } catch {
      errors.push({
        type: 'missing-style-bundle',
        message: `${bundle.module} is missing`,
        bundle: bundle.id,
      })
      continue
    }
    const actualCssImports = extractBundleCssImports(moduleSource, repoRoot, bundle.module)
    bundleImports.push({ id: bundle.id, module: bundle.module, cssImports: actualCssImports })
    if (JSON.stringify(actualCssImports) !== JSON.stringify(bundle.cssImports)) {
      errors.push({
        type: 'style-bundle-files',
        message: `${bundle.id} style bundle drifted from its controlled CSS order`,
        bundle: bundle.id,
        expectedFiles: bundle.cssImports,
        actualFiles: actualCssImports,
      })
    }
  }

  const flattenedBundleImports = bundleImports.flatMap((bundle) => bundle.cssImports)
  if (JSON.stringify(flattenedBundleImports) !== JSON.stringify(SETTINGS_STYLE_IMPORT_ORDER)) {
    errors.push({
      type: 'style-bundle-cascade-order',
      message: 'settings CSS bundle files must preserve the complete A to D cascade order',
      expectedOrder: SETTINGS_STYLE_IMPORT_ORDER,
      actualOrder: flattenedBundleImports,
    })
  }
  const finalBundle = SETTINGS_STYLE_BUNDLES.at(-1)
  if (!finalBundle || flattenedBundleImports.at(-1) !== finalBundle.cssImports.at(-1)) {
    errors.push({
      type: 'final-style-bundle-order',
      message: 'settings-product-reference-modern-bridge.css must remain the final shared settings CSS layer',
    })
  }

  return {
    expectedBundles: SETTINGS_STYLE_BUNDLES,
    actualDynamicImports,
    bundleImports,
    entryCssImports: extractStaticCssImports(entrySource),
    errors,
  }
}

function normalizeDeclarations(rule) {
  return (rule.nodes ?? [])
    .filter((node) => node.type === 'decl')
    .map((node) => `${node.prop}:${node.value}${node.important ? '!important' : ''}`)
    .join(';')
}

function getAtRuleContext(rule) {
  const context = []
  let parent = rule.parent
  while (parent) {
    if (parent.type === 'atrule') context.unshift(`@${parent.name} ${parent.params}`.trim())
    parent = parent.parent
  }
  return context.join(' > ')
}

export function buildSettingsCssReport(root = ROOT) {
  const repoRoot = resolve(root)
  const entrySource = readFileSync(join(repoRoot, ENTRY), 'utf8')
  const styleBundleContract = readSettingsStyleBundleContract(repoRoot, entrySource)
  const rules = STYLE_FILES.flatMap((styleFile) => {
    const css = readFileSync(join(repoRoot, styleFile.path), 'utf8')
    const parsed = postcss.parse(css, { from: styleFile.path })
    const fileRules = []
    parsed.walkRules((rule) => {
      const declarations = normalizeDeclarations(rule)
      if (!rule.selector || !declarations) return
      fileRules.push({
        file: styleFile.id,
        group: styleFile.group,
        selector: rule.selector.replace(/\s+/g, ' ').trim(),
        declarations,
        context: getAtRuleContext(rule),
        line: rule.source?.start?.line ?? null,
      })
    })
    return fileRules
  })

  const groups = new Map()
  for (const rule of rules) {
    const key = `${rule.context}\n${rule.selector}\n${rule.declarations}`
    const entries = groups.get(key) ?? []
    entries.push(rule)
    groups.set(key, entries)
  }
  const identicalCrossFileRules = [...groups.entries()]
    .filter(([, entries]) => new Set(entries.map((entry) => entry.file)).size > 1)
    .map(([key, entries]) => ({
      selector: key.split('\n')[1],
      context: key.split('\n')[0],
      files: [...new Set(entries.map((entry) => entry.file))],
    }))
  const identicalSameFileRules = [...groups.entries()].flatMap(([key, entries]) => {
    const entriesByFile = new Map()
    for (const entry of entries) {
      const fileEntries = entriesByFile.get(entry.file) ?? []
      fileEntries.push(entry)
      entriesByFile.set(entry.file, fileEntries)
    }
    return [...entriesByFile.entries()]
      .filter(([, fileEntries]) => fileEntries.length > 1)
      .map(([file, fileEntries]) => ({
        file,
        selector: key.split('\n')[1],
        context: key.split('\n')[0],
        lines: fileEntries.map((entry) => entry.line),
      }))
  })
  const adjacentPropertyOverrides = STYLE_FILES.flatMap((styleFile) => {
    const css = readFileSync(join(repoRoot, styleFile.path), 'utf8')
    const parsed = postcss.parse(css, { from: styleFile.path })
    const overrides = []
    parsed.walkRules((rule) => {
      const nodes = rule.nodes ?? []
      for (let index = 1; index < nodes.length; index += 1) {
        const previous = nodes[index - 1]
        const current = nodes[index]
        if (previous.type !== 'decl' || current.type !== 'decl') continue
        const previousProperty = previous.prop.startsWith('--') ? previous.prop : previous.prop.toLowerCase()
        const currentProperty = current.prop.startsWith('--') ? current.prop : current.prop.toLowerCase()
        if (previousProperty !== currentProperty || (previous.important && !current.important)) continue
        overrides.push({
          file: styleFile.id,
          selector: rule.selector.replace(/\s+/g, ' ').trim(),
          context: getAtRuleContext(rule),
          property: currentProperty,
          previousValue: previous.value,
          value: current.value,
          line: current.source?.start?.line ?? null,
        })
      }
    })
    return overrides
  })

  const groupMetrics = Object.fromEntries(STYLE_GROUPS.map((group) => {
    const groupFiles = STYLE_FILES.filter((file) => file.group === group.id)
    const groupRules = rules.filter((rule) => rule.group === group.id)
    return [group.id, {
      fileCount: groupFiles.length,
      lineCount: groupFiles.reduce((sum, file) => (
        sum + readFileSync(join(repoRoot, file.path), 'utf8').split('\n').length
      ), 0),
      ruleCount: groupRules.length,
      maxRuleCount: group.maxRules,
    }]
  }))

  const errors = []
  errors.push(...styleBundleContract.errors)
  if (identicalCrossFileRules.length > 0) {
    errors.push({
      type: 'identical-cross-file-rules',
      message: `${identicalCrossFileRules.length} complete rule(s) are duplicated across settings CSS files`,
      rules: identicalCrossFileRules,
    })
  }
  if (identicalSameFileRules.length > 0) {
    errors.push({
      type: 'identical-same-file-rules',
      message: `${identicalSameFileRules.length} complete rule(s) are repeated within a settings CSS file`,
      rules: identicalSameFileRules,
    })
  }
  if (adjacentPropertyOverrides.length > 0) {
    errors.push({
      type: 'adjacent-property-overrides',
      message: `${adjacentPropertyOverrides.length} adjacent declaration(s) immediately override the same property`,
      overrides: adjacentPropertyOverrides,
    })
  }
  for (const group of STYLE_GROUPS) {
    const metrics = groupMetrics[group.id]
    if (metrics.ruleCount <= group.maxRules) continue
    errors.push({
      type: `${group.id}-rule-count-budget`,
      message: `${group.id} settings CSS has ${metrics.ruleCount} rules; budget is ${group.maxRules}`,
    })
  }

  const maxRuleCount = STYLE_GROUPS.reduce((sum, group) => sum + group.maxRules, 0)
  return {
    schemaVersion: 1,
    expectedFiles: LEGACY_FILES,
    styleFiles: STYLE_FILES.map(({ id, path, group }) => ({ id, path, group })),
    entryImports: styleBundleContract.entryCssImports,
    styleBundleContract,
    metrics: {
      fileCount: STYLE_FILES.length,
      lineCount: Object.values(groupMetrics).reduce((sum, metrics) => sum + metrics.lineCount, 0),
      ruleCount: rules.length,
      maxRuleCount,
      groups: groupMetrics,
      identicalCrossFileRuleCount: identicalCrossFileRules.length,
      identicalSameFileRuleCount: identicalSameFileRules.length,
      adjacentPropertyOverrideCount: adjacentPropertyOverrides.length,
      styleBundleCount: SETTINGS_STYLE_BUNDLES.length,
      bundledCssFileCount: SETTINGS_STYLE_IMPORT_ORDER.length,
    },
    identicalCrossFileRules,
    identicalSameFileRules,
    adjacentPropertyOverrides,
    errors,
    summary: { ok: errors.length === 0, errors: errors.length },
    privacy: { readsUserData: false, staticSourceOnly: true },
  }
}

function main() {
  const report = buildSettingsCssReport()
  console.log('Settings CSS audit')
  for (const group of STYLE_GROUPS) {
    const metrics = report.metrics.groups[group.id]
    console.log(`- ${group.id}: ${metrics.fileCount} files, ${metrics.lineCount} lines, ${metrics.ruleCount} / ${metrics.maxRuleCount} rules`)
  }
  console.log(`- total: ${report.metrics.fileCount} files, ${report.metrics.lineCount} lines, ${report.metrics.ruleCount} / ${report.metrics.maxRuleCount} rules`)
  console.log(`- identical cross-file rules: ${report.metrics.identicalCrossFileRuleCount}`)
  console.log(`- identical same-file rules: ${report.metrics.identicalSameFileRuleCount}`)
  console.log(`- adjacent property overrides: ${report.metrics.adjacentPropertyOverrideCount}`)
  console.log(`- style bundles: ${report.metrics.styleBundleCount}`)
  console.log(`- bundled CSS files: ${report.metrics.bundledCssFileCount}`)
  for (const error of report.errors) console.error(`ERROR ${error.type}: ${error.message}`)
  console.log(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  if (!report.summary.ok) process.exitCode = 1
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) main()
