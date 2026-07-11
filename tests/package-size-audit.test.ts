import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildPackageSizeReport } from '../scripts/package-size-audit.mjs'

function withPackageFixture(callback: (root: string, app: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-package-size-'))
  const app = join(root, 'mac-arm64', 'Nexus.app')
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true })
  try {
    callback(root, app)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('package size audit accepts an app below budget', () => {
  withPackageFixture((root, app) => {
    writeFileSync(join(app, 'Contents', 'Resources', 'app.asar'), Buffer.alloc(40))
    const report = buildPackageSizeReport(root, { maxBytes: 100 })
    assert.equal(report.summary.ok, true)
    assert.equal(report.bytes, 40)
  })
})

test('package size audit rejects oversized apps', () => {
  withPackageFixture((root, app) => {
    writeFileSync(join(app, 'Contents', 'Resources', 'app.asar'), Buffer.alloc(101))
    const report = buildPackageSizeReport(root, { maxBytes: 100 })
    assert.equal(report.summary.ok, false)
    assert.match(report.errors[0], /exceeds/)
  })
})

test('package size audit rejects onnxruntime-node payloads', () => {
  withPackageFixture((root, app) => {
    const nativeDir = join(app, 'Contents', 'Resources', 'node_modules', 'onnxruntime-node')
    mkdirSync(nativeDir, { recursive: true })
    writeFileSync(join(nativeDir, 'binding.node'), 'native')
    const report = buildPackageSizeReport(root, { maxBytes: 100 })
    assert.equal(report.summary.ok, false)
    assert.equal(report.forbiddenFiles.length, 1)
  })
})
