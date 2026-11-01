import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { buildConsoleUsageReport } from '../scripts/console-usage-audit.mjs'

const BASELINE = 2

function createConsoleUsageFixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-console-usage-audit-'))
  for (const directory of ['src', 'electron']) {
    mkdirSync(join(root, directory), { recursive: true })
  }
  for (const [relativePath, source] of Object.entries(files)) {
    const absolutePath = join(root, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, source)
  }
  return root
}

function withConsoleUsageFixture<T>(files: Record<string, string>, callback: (root: string) => T): T {
  const root = createConsoleUsageFixture(files)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function consoleCalls(count: number) {
  return Array.from({ length: count }, (_, index) => `console.warn('call ${index}')`).join('\n')
}

test('console usage audit passes at the baseline', () => {
  withConsoleUsageFixture({
    'src/app.ts': consoleCalls(BASELINE),
  }, (root) => {
    const report = buildConsoleUsageReport(root, { baselineTotal: BASELINE })

    assert.equal(report.counts.total, BASELINE)
    assert.deepEqual(report.errors.overBaseline, [])
    assert.equal(report.summary.ok, true)
  })
})

test('console usage audit fails when usage grows above the baseline', () => {
  withConsoleUsageFixture({
    'src/app.ts': consoleCalls(BASELINE + 1),
  }, (root) => {
    const report = buildConsoleUsageReport(root, { baselineTotal: BASELINE })

    assert.equal(report.counts.total, BASELINE + 1)
    assert.deepEqual(report.errors.overBaseline, [{ total: BASELINE + 1, baseline: BASELINE, excess: 1 }])
    assert.equal(report.summary.ok, false)
  })
})

test('console usage audit passes when usage drops below the baseline', () => {
  withConsoleUsageFixture({
    'src/app.ts': consoleCalls(BASELINE - 1),
  }, (root) => {
    const report = buildConsoleUsageReport(root, { baselineTotal: BASELINE })

    assert.equal(report.counts.total, BASELINE - 1)
    assert.equal(report.summary.ok, true)
  })
})

test('console usage audit excludes the structured loggers and non-source roots', () => {
  withConsoleUsageFixture({
    'src/lib/logger.ts': consoleCalls(5),
    'electron/logger.js': consoleCalls(5),
    'tests/console.test.ts': consoleCalls(5),
  }, (root) => {
    const report = buildConsoleUsageReport(root, { baselineTotal: 0 })

    assert.equal(report.counts.total, 0)
    assert.equal(report.summary.ok, true)
  })
})
