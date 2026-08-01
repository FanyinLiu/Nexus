#!/usr/bin/env node

/**
 * Packaged runtime baseline CLI.
 *
 * Usage:
 *   node scripts/packaged-runtime-baseline.mjs record
 *     Read output/packaged-sustained-runtime/report.json (+ samples.jsonl)
 *     from a GREEN sustained runtime run and write the versioned baseline
 *     tests/fixtures/packagedRuntimeBaseline.json. The baseline is a local
 *     machine reference, not a cross-machine promise — record it on the
 *     machine that will run the comparisons.
 *
 *   node scripts/packaged-runtime-baseline.mjs compare
 *     Compare the latest report against the baseline. Prints the verdict:
 *       ok           all comparable metrics within budgets
 *       regression   RSS peak > baseline x1.25 or cold start > baseline x1.5
 *       inconclusive missing baseline / platform mismatch / no metrics
 *     Exit codes: 0 for ok and inconclusive (never a hard failure),
 *     1 for regression, 2 for IO/usage errors.
 *
 * Options:
 *   --report=<path>    report.json path (default: output/packaged-sustained-runtime/report.json)
 *   --baseline=<path>  baseline path   (default: tests/fixtures/packagedRuntimeBaseline.json)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildBaseline,
  compareRuntimeToBaseline,
  extractRuntimeMetrics,
  formatComparedEntry,
} from './lib/packaged-runtime-baseline.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_REPORT_PATH = path.join(ROOT, 'output', 'packaged-sustained-runtime', 'report.json')
const DEFAULT_BASELINE_PATH = path.join(ROOT, 'tests', 'fixtures', 'packagedRuntimeBaseline.json')

function optionValue(name) {
  const arg = process.argv.slice(3).find((value) => value.startsWith(`--${name}=`))
  return arg ? arg.split('=').slice(1).join('=') : null
}

function readJson(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`)
  }
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function readSamples(reportPath) {
  const samplesPath = path.join(path.dirname(reportPath), 'samples.jsonl')
  if (!existsSync(samplesPath)) return []
  return readFileSync(samplesPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}

function readElectronVersion() {
  try {
    const pkg = readJson(path.join(ROOT, 'package.json'), 'package.json')
    return pkg.devDependencies?.electron ?? pkg.dependencies?.electron ?? null
  } catch {
    return null
  }
}

function loadInputs() {
  const reportPath = optionValue('report') ?? DEFAULT_REPORT_PATH
  const baselinePath = optionValue('baseline') ?? DEFAULT_BASELINE_PATH
  const report = readJson(reportPath, 'report.json')
  const samples = readSamples(reportPath)
  return { reportPath, baselinePath, report, samples }
}

function runRecord() {
  const { baselinePath, report, samples } = loadInputs()
  const baseline = buildBaseline({
    report,
    samples,
    electronVersion: readElectronVersion(),
  })
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
  process.stdout.write('Packaged runtime baseline recorded\n')
  process.stdout.write(`- baseline: ${baselinePath}\n`)
  process.stdout.write(`- source report capturedAt: ${baseline.sourceReport.capturedAt}\n`)
  process.stdout.write(`- machine: ${baseline.machine.platform}/${baseline.machine.arch} node=${baseline.machine.node} electron=${baseline.machine.electron}\n`)
  process.stdout.write(`- coldStartMs: ${baseline.metrics.coldStartMs}\n`)
  process.stdout.write(`- mainRendererRssKb peak/median: ${baseline.metrics.mainRendererRssKb.peak}/${baseline.metrics.mainRendererRssKb.median} KB\n`)
  process.stdout.write(`- plateau: ok=${baseline.metrics.plateau.ok} ratio=${baseline.metrics.plateau.ratio}\n`)
  process.stdout.write('- note: 本机参考值，不是跨机器承诺\n')
  return 0
}

function runCompare() {
  const { reportPath, baselinePath, report, samples } = loadInputs()
  const baseline = existsSync(baselinePath)
    ? readJson(baselinePath, 'baseline')
    : null
  const metrics = extractRuntimeMetrics({ report, samples })
  const result = compareRuntimeToBaseline({ metrics, baseline })

  process.stdout.write(`Packaged runtime baseline compare: ${result.status}\n`)
  process.stdout.write(`- report: ${reportPath}\n`)
  process.stdout.write(`- baseline: ${baseline ? baselinePath : '(missing)'}\n`)
  if (result.reason) {
    process.stdout.write(`- inconclusive: ${result.reason}\n`)
  }
  for (const entry of result.compared) {
    process.stdout.write(`- ${formatComparedEntry(entry)}\n`)
  }
  for (const entry of result.skipped) {
    process.stdout.write(`- ${entry.metric}: skipped (${entry.reason})\n`)
  }
  if (result.regression) {
    process.stdout.write(`REGRESSION: ${result.exceeded.map(formatComparedEntry).join('; ')}\n`)
    return 1
  }
  return 0
}

const command = process.argv[2]
try {
  if (command === 'record') {
    process.exit(runRecord())
  } else if (command === 'compare') {
    process.exit(runCompare())
  } else {
    process.stderr.write('Usage: node scripts/packaged-runtime-baseline.mjs <record|compare> [--report=path] [--baseline=path]\n')
    process.exit(2)
  }
} catch (error) {
  process.stderr.write(`[packaged-runtime-baseline] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}
