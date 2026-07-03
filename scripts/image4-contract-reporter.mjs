#!/usr/bin/env node

import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildImage4VisualContractReport } from './image4-visual-contract-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function getOutputPath(argv) {
  const outputArg = argv.find((arg) => arg.startsWith('--output='))
  if (!outputArg) return null
  return resolve(ROOT, outputArg.slice('--output='.length))
}

function buildReporterPayload(root = ROOT) {
  const hard = buildImage4VisualContractReport(root, { mode: 'hard' })
  const soft = buildImage4VisualContractReport(root, { mode: 'soft' })
  const summary = hard.summary.ok
    ? soft.summary.ok ? 'stable' : 'drift'
    : 'broken'

  return {
    hard: {
      pass: hard.summary.ok,
      failures: hard.errors,
      checkedContracts: hard.checkedContracts,
    },
    soft: {
      pass: soft.summary.ok,
      warnings: soft.errors,
      checkedContracts: soft.checkedContracts,
    },
    summary,
    privacy: {
      readsUserStorage: false,
      staticSourceOnly: true,
    },
  }
}

function formatHumanReport(payload) {
  const hardFailures = Object.values(payload.hard.failures).reduce((sum, list) => sum + list.length, 0)
  const softWarnings = Object.values(payload.soft.warnings).reduce((sum, list) => sum + list.length, 0)
  return [
    'Image4 contract reporter',
    `- summary: ${payload.summary}`,
    `- hard failures: ${hardFailures}`,
    `- soft warnings: ${softWarnings}`,
    `- hard contracts: ${payload.hard.checkedContracts.length}`,
    `- soft contracts: ${payload.soft.checkedContracts.length}`,
  ].join('\n')
}

function main(argv) {
  const payload = buildReporterPayload(ROOT)
  const outputPath = getOutputPath(argv)
  const json = argv.includes('--json') || argv.includes('--format=json')

  if (outputPath) {
    writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`)
  }

  process.stdout.write(json ? `${JSON.stringify(payload, null, 2)}\n` : `${formatHumanReport(payload)}\n`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
