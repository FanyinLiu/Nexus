import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { buildSilentCatchReport } from '../scripts/silent-catch-audit.mjs'

const SCOPED_FIXTURE = 'src/features/voice/silentCatchFixture.ts'
const UNSCOPED_FIXTURE = 'src/features/unscoped/silentCatchFixture.ts'

function createSilentCatchFixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-silent-catch-audit-'))

  for (const [relativePath, source] of Object.entries(files)) {
    const absolutePath = join(root, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, source)
  }

  return root
}

function withSilentCatchFixture<T>(files: Record<string, string>, callback: (root: string) => T): T {
  const root = createSilentCatchFixture(files)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function violationKinds(root: string) {
  return buildSilentCatchReport(root).violations.map((item) => item.kind)
}

test('silent catch audit detects an empty catch block', () => {
  withSilentCatchFixture({
    [SCOPED_FIXTURE]: `
export function run(work: () => void) {
  try {
    work()
  } catch {}
}
`,
  }, (root) => {
    assert.deepEqual(violationKinds(root), ['empty-catch'])
  })
})

test('silent catch audit detects a no-op promise catch handler', () => {
  withSilentCatchFixture({
    [SCOPED_FIXTURE]: `
export function run() {
  void Promise.reject(new Error('boom')).catch(() => {})
}
`,
  }, (root) => {
    assert.deepEqual(violationKinds(root), ['no-op-promise-catch'])
  })
})

test('silent catch audit detects a return-only catch block', () => {
  withSilentCatchFixture({
    [SCOPED_FIXTURE]: `
export function run(work: () => string) {
  try {
    return work()
  } catch {
    return null
  }
}
`,
  }, (root) => {
    assert.deepEqual(violationKinds(root), ['silent-return'])
  })
})

test('silent catch audit accepts a catch block that logs', () => {
  withSilentCatchFixture({
    [SCOPED_FIXTURE]: `
export function run(work: () => string) {
  try {
    return work()
  } catch {
    log.warn('work failed', { errorPresent: true })
    return null
  }
}
`,
  }, (root) => {
    const report = buildSilentCatchReport(root)

    assert.equal(report.summary.ok, true)
    assert.deepEqual(report.violations, [])
  })
})

test('silent catch audit accepts an opt-out with a reason', () => {
  withSilentCatchFixture({
    [SCOPED_FIXTURE]: `
export function run() {
  try {
    work()
  } catch {
    // silent-catch-ok: cleanup during teardown is best-effort
    return null
  }
}
`,
  }, (root) => {
    const report = buildSilentCatchReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.optOuts.length, 1)
    assert.equal(report.optOuts[0]?.reason, 'cleanup during teardown is best-effort')
  })
})

test('silent catch audit rejects an opt-out without a reason', () => {
  withSilentCatchFixture({
    [SCOPED_FIXTURE]: `
export function run() {
  try {
    work()
  } catch {
    // silent-catch-ok:
    return null
  }
}
`,
  }, (root) => {
    assert.deepEqual(violationKinds(root), ['opt-out-missing-reason'])
  })
})

test('silent catch audit ignores files outside the scoped list', () => {
  withSilentCatchFixture({
    [UNSCOPED_FIXTURE]: `
export function run(work: () => void) {
  try {
    work()
  } catch {}
}
`,
  }, (root) => {
    const report = buildSilentCatchReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.filesChecked, 0)
  })
})

test('silent catch audit reports no violations in the real repository', () => {
  const report = buildSilentCatchReport()

  assert.equal(report.summary.ok, true)
  assert.equal(report.summary.errors, 0)
})
