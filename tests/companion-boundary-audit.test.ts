import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildCompanionBoundaryReport } from '../scripts/companion-boundary-audit.mjs'

const BASELINE_FILES: Record<string, string> = {
  'src/features/agent/README.md': `
companion task boundary
not a Codex-style work agent
must stay default-off or confirmation-gated
`,
  'docs/ARCHITECTURE.md': `
Companion task boundary
not autonomous work-agent execution
must stay permission-gated
`,
  'docs/RELEASE-NOTES-v0.3.5.md': `
companionship, not autonomous work
does not add a Codex-style work agent
`,
}

function createCompanionBoundaryFixture(overrides: Record<string, string | null> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-companion-boundary-audit-'))
  for (const [relativePath, baseline] of Object.entries(BASELINE_FILES)) {
    if (overrides[relativePath] === null) continue
    const absolutePath = join(root, relativePath)
    mkdirSync(join(absolutePath, '..'), { recursive: true })
    writeFileSync(absolutePath, overrides[relativePath] ?? baseline)
  }
  return root
}

function withCompanionBoundaryFixture<T>(
  overrides: Record<string, string | null>,
  callback: (root: string) => T,
): T {
  const root = createCompanionBoundaryFixture(overrides)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('companion boundary audit passes the documented companion-first baseline', () => {
  withCompanionBoundaryFixture({}, (root) => {
    const report = buildCompanionBoundaryReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
  })
})

test('companion boundary audit rejects missing boundary documentation files', () => {
  withCompanionBoundaryFixture({
    'src/features/agent/README.md': null,
  }, (root) => {
    const report = buildCompanionBoundaryReport(root)

    assert.equal(report.summary.ok, false)
    assert.deepEqual(report.errors.missingFiles, [
      { file: 'src/features/agent/README.md' },
    ])
  })
})

test('companion boundary audit rejects missing work-agent boundary language', () => {
  withCompanionBoundaryFixture({
    'src/features/agent/README.md': `
companion task boundary
must stay default-off or confirmation-gated
`,
  }, (root) => {
    const report = buildCompanionBoundaryReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.missingPhrases.some((item) => item.phrase === 'not a Codex-style work agent'),
    )
  })
})
