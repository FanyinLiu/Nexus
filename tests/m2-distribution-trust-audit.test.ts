import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildM2DistributionTrustReport,
  DEFAULT_M2_DISTRIBUTION_TRUST_FILE,
  DEFAULT_M2_PACKAGE_SMOKE_DIR,
  M2_DISTRIBUTION_TRUST_GATE,
  M2_PACKAGE_SMOKE_GATE,
  parseM2DistributionTrustArgs,
  REQUIRED_M2_PACKAGE_SMOKE_PLATFORMS,
} from '../scripts/m2-distribution-trust-audit.mjs'
import packageJson from '../package.json' with { type: 'json' }

const execFileAsync = promisify(execFile)

test('m2 distribution trust args support output and readiness enforcement', () => {
  assert.deepEqual(parseM2DistributionTrustArgs([
    '--generated-at=2026-06-18T09:00:00Z',
    '--package-smoke-dir',
    'artifacts/v1',
    '--package-smoke-file=macos.json',
    '--output',
    'artifacts/v1/m2-distribution-trust.json',
    '--require-ready',
    '--require-package-smoke',
  ]), {
    generatedAt: '2026-06-18T09:00:00Z',
    help: false,
    outputPath: 'artifacts/v1/m2-distribution-trust.json',
    packageSmokeDir: 'artifacts/v1',
    packageSmokeFiles: ['macos.json'],
    requirePackageSmoke: true,
    requireReady: true,
  })
})

function packageSmoke(platform: string, overrides = {}) {
  return {
    schemaVersion: 1,
    gate: M2_PACKAGE_SMOKE_GATE,
    generatedAt: '2026-06-18T09:10:00.000Z',
    platform,
    ok: true,
    releaseDir: 'release-smoke',
    executableKind: platform === 'macos'
      ? 'macos-app'
      : platform === 'windows'
        ? 'windows-exe'
        : 'linux-unpacked',
    executableFound: true,
    timeoutMs: 90000,
    status: 'pass',
    error: null,
    privacy: {
      artifactContentsCopied: false,
    },
    ...overrides,
  }
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

test('m2 distribution trust report summarizes current unsigned fallback posture safely', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m2-empty-smoke-'))
  try {
    const report = await buildM2DistributionTrustReport({
      generatedAt: '2026-06-18T09:00:00Z',
      packageSmokeDir: directoryPath,
    })
    const json = JSON.stringify(report)

    assert.equal(report.gate, M2_DISTRIBUTION_TRUST_GATE)
    assert.equal(report.generatedAt, '2026-06-18T09:00:00.000Z')
    assert.equal(report.ok, true)
    assert.equal(report.overallStatus, 'ready-with-documented-unsigned-fallback')
    assert.deepEqual(report.blockingIssueIds, [])
    assert.equal(report.checks.every((check) => check.pass), true)
    assert.deepEqual(report.platformReadiness.map((entry) => entry.platform), ['windows', 'macos', 'linux'])
    assert.equal(report.packageSmoke.required, false)
    assert.deepEqual(report.packageSmoke.missingPlatformIds, REQUIRED_M2_PACKAGE_SMOKE_PLATFORMS)
    assert.equal(report.platformReadiness.find((entry) => entry.platform === 'windows')?.signingStatus, 'unsigned-fallback-documented')
    assert.equal(report.platformReadiness.find((entry) => entry.platform === 'macos')?.signingStatus, 'unsigned-fallback-documented')
    assert.equal(report.platformReadiness.find((entry) => entry.platform === 'linux')?.signingStatus, 'sha256-ready-gpg-optional')
    assert.equal(report.privacy.artifactContentsCopied, false)
    assert.equal(json.includes('"signed":true'), false)
    assert.equal(json.includes('GPG_PRIVATE_KEY ='), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m2 distribution trust can require package smoke evidence for all platforms', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m2-package-smoke-'))
  try {
    for (const platform of REQUIRED_M2_PACKAGE_SMOKE_PLATFORMS) {
      await writeJson(path.join(directoryPath, `m2-package-smoke-${platform}.json`), packageSmoke(platform))
    }

    const readyReport = await buildM2DistributionTrustReport({
      generatedAt: '2026-06-18T09:00:00Z',
      packageSmokeDir: directoryPath,
      requirePackageSmoke: true,
    })

    assert.equal(readyReport.ok, true)
    assert.equal(readyReport.packageSmoke.required, true)
    assert.deepEqual(readyReport.packageSmoke.missingPlatformIds, [])
    assert.equal(readyReport.packageSmoke.platformCoverage.every((entry) => entry.pass), true)

    await rm(path.join(directoryPath, 'm2-package-smoke-windows.json'), { force: true })
    const blockedReport = await buildM2DistributionTrustReport({
      packageSmokeDir: directoryPath,
      requirePackageSmoke: true,
    })

    assert.equal(blockedReport.ok, false)
    assert.ok(blockedReport.blockingIssueIds.includes('missing-package-smoke:windows'))
    assert.ok(blockedReport.nextActions.includes('run-windows-package-smoke'))
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m2 distribution trust CLI persists report and enforces readiness', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m2-distribution-'))
  try {
    const outputPath = path.join(directoryPath, 'm2-distribution-trust.json')
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/m2-distribution-trust-audit.mjs',
      '--generated-at',
      '2026-06-18T09:00:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m2 distribution trust package wiring stays available', () => {
  assert.equal(packageJson.scripts?.['m2:distribution:trust'], 'node scripts/m2-distribution-trust-audit.mjs')
  assert.equal(packageJson.scripts?.['m2:package-smoke:current'], 'cross-env PACKAGED_SMOKE_EVIDENCE_FILE=artifacts/v1/m2-package-smoke-current.json npm run smoke:packaged')
  assert.equal(DEFAULT_M2_DISTRIBUTION_TRUST_FILE, 'artifacts/v1/m2-distribution-trust.json')
  assert.equal(DEFAULT_M2_PACKAGE_SMOKE_DIR, 'artifacts/v1')
  assert.ok(packageJson.build?.files?.includes('scripts/m2-distribution-trust-audit.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/m2-distribution-trust-audit.mjs'))
})
