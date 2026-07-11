#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = 'src/app/settingsDrawerEntry.ts'
const STYLE_DIR = 'src/app/styles'
const MAX_SETTINGS_RULES = 2_300
const EXPECTED_FILES = [
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
  const entryImports = [...entrySource.matchAll(/import ['"]\.\/styles\/([^'"]+\.css)['"]/g)].map((match) => match[1])
  const rules = EXPECTED_FILES.flatMap((file) => {
    const css = readFileSync(join(repoRoot, STYLE_DIR, file), 'utf8')
    const parsed = postcss.parse(css, { from: file })
    const fileRules = []
    parsed.walkRules((rule) => {
      const declarations = normalizeDeclarations(rule)
      if (!rule.selector || !declarations) return
      fileRules.push({
        file,
        selector: rule.selector.replace(/\s+/g, ' ').trim(),
        declarations,
        context: getAtRuleContext(rule),
      })
    })
    return fileRules
  })

  const groups = new Map()
  for (const rule of rules) {
    const key = `${rule.context}\n${rule.selector}\n${rule.declarations}`
    const entries = groups.get(key) ?? []
    entries.push(rule.file)
    groups.set(key, entries)
  }
  const identicalCrossFileRules = [...groups.entries()]
    .filter(([, files]) => new Set(files).size > 1)
    .map(([key, files]) => ({ selector: key.split('\n')[1], context: key.split('\n')[0], files: [...new Set(files)] }))

  const errors = []
  if (JSON.stringify(entryImports) !== JSON.stringify(EXPECTED_FILES)) {
    errors.push({ type: 'import-order', message: 'settingsDrawerEntry CSS imports drifted from the controlled cascade order' })
  }
  if (identicalCrossFileRules.length > 0) {
    errors.push({
      type: 'identical-cross-file-rules',
      message: `${identicalCrossFileRules.length} complete rule(s) are duplicated across settings CSS files`,
      rules: identicalCrossFileRules,
    })
  }
  if (rules.length > MAX_SETTINGS_RULES) {
    errors.push({
      type: 'rule-count-budget',
      message: `settings CSS has ${rules.length} rules; budget is ${MAX_SETTINGS_RULES}`,
    })
  }

  const lineCount = EXPECTED_FILES.reduce((sum, file) => sum + readFileSync(join(repoRoot, STYLE_DIR, file), 'utf8').split('\n').length, 0)
  return {
    schemaVersion: 1,
    expectedFiles: EXPECTED_FILES,
    entryImports,
    metrics: {
      fileCount: EXPECTED_FILES.length,
      lineCount,
      ruleCount: rules.length,
      maxRuleCount: MAX_SETTINGS_RULES,
      identicalCrossFileRuleCount: identicalCrossFileRules.length,
    },
    identicalCrossFileRules,
    errors,
    summary: { ok: errors.length === 0, errors: errors.length },
    privacy: { readsUserData: false, staticSourceOnly: true },
  }
}

function main() {
  const report = buildSettingsCssReport()
  console.log('Settings CSS audit')
  console.log(`- files: ${report.metrics.fileCount}`)
  console.log(`- source lines: ${report.metrics.lineCount}`)
  console.log(`- rules: ${report.metrics.ruleCount} / ${report.metrics.maxRuleCount}`)
  console.log(`- identical cross-file rules: ${report.metrics.identicalCrossFileRuleCount}`)
  for (const error of report.errors) console.error(`ERROR ${error.type}: ${error.message}`)
  console.log(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  if (!report.summary.ok) process.exitCode = 1
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) main()
