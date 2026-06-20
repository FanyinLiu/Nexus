#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED_PHRASES = [
  {
    file: 'src/features/agent/README.md',
    phrases: [
      'companion task boundary',
      'not a Codex-style work agent',
      'must stay default-off or confirmation-gated',
    ],
  },
  {
    file: 'docs/ARCHITECTURE.md',
    phrases: [
      'Companion task boundary',
      'not autonomous work-agent execution',
      'must stay permission-gated',
    ],
  },
  {
    file: 'docs/RELEASE-NOTES-v0.3.5.md',
    phrases: [
      'companionship, not autonomous work',
      'does not add a Codex-style work agent',
    ],
  },
]

export function buildCompanionBoundaryReport(root = ROOT) {
  const missingFiles = []
  const missingPhrases = []

  for (const item of REQUIRED_PHRASES) {
    const fullPath = join(root, item.file)
    if (!existsSync(fullPath)) {
      missingFiles.push({ file: item.file })
      continue
    }
    const text = readFileSync(fullPath, 'utf8').toLowerCase().replace(/\s+/g, ' ')
    for (const phrase of item.phrases) {
      if (!text.includes(phrase.toLowerCase())) {
        missingPhrases.push({ file: item.file, phrase })
      }
    }
  }

  const errors = { missingFiles, missingPhrases }
  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0)
  return {
    checkedFiles: REQUIRED_PHRASES.map((item) => item.file),
    errors,
    summary: {
      ok: errorCount === 0,
      errors: errorCount,
    },
  }
}

function formatHumanReport(report) {
  const lines = ['Companion boundary audit']
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push('')
  for (const [name, items] of Object.entries(report.errors)) {
    lines.push(`ERROR ${name}: ${items.length}`)
    if (items.length) {
      lines.push(`  ${items.slice(0, 8).map((item) => `${item.file}${item.phrase ? `: ${item.phrase}` : ''}`).join(', ')}`)
    }
  }
  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function main(argv) {
  const report = buildCompanionBoundaryReport(ROOT)
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
