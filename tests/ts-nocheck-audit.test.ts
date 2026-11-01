import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { buildTsNocheckReport } from '../scripts/ts-nocheck-audit.mjs'

function withElectronFixture<T>(files: Record<string, string>, callback: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'nexus-ts-nocheck-audit-'))

  for (const [relativePath, source] of Object.entries(files)) {
    const absolutePath = join(root, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, source)
  }

  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const NO_CHECK = '// @ts-nocheck\nexport const value = 1\n'
const CHECKED = 'export const value = 1\n'

test('ts-nocheck audit passes when the opt-out set matches the baseline', () => {
  withElectronFixture({
    'electron/services/a.js': NO_CHECK,
    'electron/services/b.js': NO_CHECK,
    'electron/services/checked.js': CHECKED,
  }, (root) => {
    const report = buildTsNocheckReport(root, {
      baseline: ['electron/services/a.js', 'electron/services/b.js'],
    })

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.current.count, 2)
    assert.equal(report.checkedFiles, 3)
    assert.deepEqual(report.unexpectedOptOuts, [])
  })
})

test('ts-nocheck audit fails on a new opt-out file', () => {
  withElectronFixture({
    'electron/services/baselined.js': NO_CHECK,
    'electron/services/new-opt-out.js': NO_CHECK,
  }, (root) => {
    const report = buildTsNocheckReport(root, {
      baseline: ['electron/services/baselined.js'],
    })

    assert.equal(report.summary.ok, false)
    // Both checks fire: the file is not baselined and the count exceeds it.
    assert.equal(report.summary.errors, 2)
    assert.deepEqual(report.unexpectedOptOuts, ['electron/services/new-opt-out.js'])
  })
})

test('ts-nocheck audit passes when a baselined file is fixed', () => {
  withElectronFixture({
    'electron/services/fixed.js': CHECKED,
    'electron/services/still-opt-out.js': NO_CHECK,
  }, (root) => {
    const report = buildTsNocheckReport(root, {
      baseline: ['electron/services/fixed.js', 'electron/services/still-opt-out.js'],
    })

    assert.equal(report.summary.ok, true)
    assert.deepEqual(report.staleBaselineEntries, ['electron/services/fixed.js'])
    assert.equal(report.hints.length, 1)
    assert.match(report.hints[0] ?? '', /remove it from TS_NOCHECK_BASELINE/)
  })
})

test('ts-nocheck audit reads the directive after a shebang', () => {
  withElectronFixture({
    'electron/worker.js': '#!/usr/bin/env node\n// @ts-nocheck\nexport const value = 1\n',
  }, (root) => {
    const report = buildTsNocheckReport(root, { baseline: ['electron/worker.js'] })

    assert.equal(report.summary.ok, true)
    assert.deepEqual(report.current.files, ['electron/worker.js'])
  })
})
