import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildSourceSizeReport } from '../scripts/source-size-audit.mjs'

const SOURCE_ROOTS = ['src', 'electron', 'scripts', 'tests']

function createSourceSizeFixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-source-size-audit-'))
  for (const directory of SOURCE_ROOTS) {
    mkdirSync(join(root, directory), { recursive: true })
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(root, relativePath)
    mkdirSync(join(absolutePath, '..'), { recursive: true })
    writeFileSync(absolutePath, content)
  }
  return root
}

function withSourceSizeFixture<T>(files: Record<string, string>, callback: (root: string) => T): T {
  const root = createSourceSizeFixture(files)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('source size audit includes CSS files in the default source inventory', () => {
  withSourceSizeFixture({
    'src/index.css': '.root { color: red; }\n',
    'src/app.ts': 'export const ok = true\n',
  }, (root) => {
    const report = buildSourceSizeReport(root)

    assert.equal(report.checkedFiles, 2)
    assert.equal(report.summary.ok, true)
  })
})

test('source size audit fails for a new oversized CSS source file', () => {
  withSourceSizeFixture({
    'src/styles/oversized.css': Array.from({ length: 1201 }, (_, index) => `.x${index} { color: red; }`).join('\n'),
  }, (root) => {
    const report = buildSourceSizeReport(root)

    assert.deepEqual(report.errors.overBudget, [
      { file: 'src/styles/oversized.css', lines: 1201, budget: 1200 },
    ])
    assert.equal(report.summary.ok, false)
  })
})
