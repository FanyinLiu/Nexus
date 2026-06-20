#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_MAX_LINES = 1200
const SOURCE_ROOTS = ['src', 'electron', 'scripts', 'tests']
const SOURCE_PATTERN = /\.(ts|tsx|js|mjs|cjs)$/
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'release', 'release-smoke', '.git'])

const FILE_BUDGETS = {
  'src/i18n/locales/en.ts': 2600,
  'src/i18n/locales/zh-CN.ts': 2600,
  'src/i18n/locales/zh-TW.ts': 2600,
  'src/i18n/locales/ja.ts': 2600,
  'src/i18n/locales/ko.ts': 2600,
  'src/i18n/keys.ts': 2600,
  'electron/services/localDataStore.js': 2100,
}

function normalizePath(path) {
  return path.split('\\').join('/')
}

function walkFiles(root, directory, predicate) {
  const base = join(root, directory)
  const files = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue
    const fullPath = join(base, entry.name)
    const rel = normalizePath(relative(root, fullPath))
    if (entry.isDirectory()) {
      files.push(...walkFiles(root, rel, predicate))
    } else if (entry.isFile() && predicate(rel)) {
      files.push(rel)
    }
  }
  return files
}

function countLines(source) {
  if (!source.length) return 0
  return source.split(/\r\n|\r|\n/).length
}

export function buildSourceSizeReport(root = ROOT) {
  const files = SOURCE_ROOTS.flatMap((directory) => walkFiles(root, directory, (file) => SOURCE_PATTERN.test(file))).sort()
  const overBudget = []
  const watchedLargeFiles = []
  let totalLines = 0

  for (const file of files) {
    const lines = countLines(readFileSync(join(root, file), 'utf8'))
    const budget = FILE_BUDGETS[file] ?? DEFAULT_MAX_LINES
    totalLines += lines

    if (lines > budget) {
      overBudget.push({ file, lines, budget })
    } else if (lines >= Math.floor(budget * 0.9)) {
      watchedLargeFiles.push({ file, lines, budget })
    }
  }

  const errors = { overBudget }
  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0)

  return {
    checkedFiles: files.length,
    totalLines,
    defaultMaxLines: DEFAULT_MAX_LINES,
    customBudgets: FILE_BUDGETS,
    watchedLargeFiles,
    errors,
    summary: {
      ok: errorCount === 0,
      errors: errorCount,
    },
    privacy: {
      readsUserStorage: false,
      staticSourceOnly: true,
    },
  }
}

function formatHumanReport(report) {
  const lines = ['Source size audit']
  lines.push(`- checked files: ${report.checkedFiles}`)
  lines.push(`- total source lines: ${report.totalLines}`)
  lines.push(`- default max lines per file: ${report.defaultMaxLines}`)
  lines.push(`- watched large files: ${report.watchedLargeFiles.length}`)
  if (report.watchedLargeFiles.length) {
    lines.push(`  ${report.watchedLargeFiles.slice(0, 8).map((item) => `${item.file} ${item.lines}/${item.budget}`).join(', ')}`)
  }
  lines.push('')
  for (const [name, items] of Object.entries(report.errors)) {
    lines.push(`ERROR ${name}: ${items.length}`)
    if (items.length) {
      lines.push(`  ${items.slice(0, 8).map((item) => `${item.file} ${item.lines}/${item.budget}`).join(', ')}`)
    }
  }
  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function main(argv) {
  const report = buildSourceSizeReport(ROOT)
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
