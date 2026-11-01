#!/usr/bin/env node

// Console-usage baseline audit. Direct console calls in src/ and electron/ are
// tolerated only at the recorded baseline; the count may shrink but never grow.
// Logging through src/lib/logger.ts or electron/logger.js is not counted.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkFiles } from './lib/audit-framework.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ROOTS = ['src', 'electron']
const SOURCE_PATTERN = /\.(ts|tsx|js|mjs|cjs)$/
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'release', 'release-smoke', '.git'])
const EXCLUDED_FILES = new Set(['src/lib/logger.ts', 'electron/logger.js'])
const CONSOLE_CALL_PATTERN = /console\.(?:log|info|warn|error|debug|trace)\(/g

// Hardcoded ceiling, measured after moving the Sherpa dependency-failure
// warnings onto electron/logger.js, then re-measured after merging the S3/S4
// MCP-confirmation and updater-gate warnings (+8). Lower it whenever the count drops.
const BASELINE_TOTAL = 436
const BASELINE_BY_ROOT = {
  electron: 283,
  src: 153,
}

function countConsoleCalls(source) {
  return (source.match(CONSOLE_CALL_PATTERN) ?? []).length
}

export function buildConsoleUsageReport(
  root = ROOT,
  { baselineTotal = BASELINE_TOTAL, baselineByRoot = BASELINE_BY_ROOT } = {},
) {
  const files = SOURCE_ROOTS
    .flatMap((directory) => walkFiles(root, directory, (file) => SOURCE_PATTERN.test(file), { ignoreDirectories: IGNORED_DIRECTORIES }))
    .filter((file) => !EXCLUDED_FILES.has(file))
    .sort()

  const byRoot = Object.fromEntries(SOURCE_ROOTS.map((directory) => [directory, 0]))
  const fileCounts = []
  let total = 0

  for (const file of files) {
    const count = countConsoleCalls(readFileSync(join(root, file), 'utf8'))
    if (count === 0) continue
    total += count
    byRoot[file.split('/')[0]] += count
    fileCounts.push({ file, count })
  }

  const overBaseline = total > baselineTotal
    ? [{ total, baseline: baselineTotal, excess: total - baselineTotal }]
    : []

  const errors = { overBaseline }
  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0)

  return {
    checkedFiles: files.length,
    baseline: {
      total: baselineTotal,
      byRoot: baselineByRoot,
    },
    counts: {
      total,
      byRoot,
    },
    files: fileCounts,
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
  const lines = ['Console usage audit']
  lines.push(`- checked files: ${report.checkedFiles}`)
  lines.push(`- console calls: ${report.counts.total} (baseline ${report.baseline.total})`)
  lines.push(`- by root: ${SOURCE_ROOTS.map((directory) => `${directory}=${report.counts.byRoot[directory]}`).join(', ')}`)
  lines.push('')
  for (const [name, items] of Object.entries(report.errors)) {
    lines.push(`ERROR ${name}: ${items.length}`)
    if (items.length) {
      lines.push(`  ${items.map((item) => `${item.total}/${item.baseline} (+${item.excess})`).join(', ')}`)
    }
  }
  lines.push('')
  if (report.counts.total < report.baseline.total) {
    lines.push(`Hint: console calls dropped below baseline — lower BASELINE_TOTAL to ${report.counts.total}.`)
    lines.push('')
  }
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function main(argv) {
  const report = buildConsoleUsageReport(ROOT)
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
