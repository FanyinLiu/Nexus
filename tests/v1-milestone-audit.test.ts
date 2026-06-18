import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildV1MilestoneAuditReport,
  parseV1MilestoneAuditArgs,
  V1_MILESTONE_AUDIT_GATE,
} from '../scripts/v1-milestone-audit.mjs'
import packageJson from '../package.json' with { type: 'json' }

const execFileAsync = promisify(execFile)

test('v1 milestone audit args support output and readiness enforcement', () => {
  assert.deepEqual(parseV1MilestoneAuditArgs([
    '--milestone-file',
    'docs/V1_MILESTONES.md',
    '--m1-status-file=artifacts/v1/m1-first-run-status.json',
    '--m2-trust-file',
    'artifacts/v1/m2-distribution-trust.json',
    '--m3-ipc-file',
    'artifacts/v1/m3-ipc-security.json',
    '--m4-storage-file',
    'artifacts/v1/m4-storage-migration.json',
    '--generated-at=2026-06-18T08:00:00Z',
    '--output',
    'artifacts/v1/milestone-audit.json',
    '--require-acceptance-evidence',
    '--require-ready',
  ]), {
    generatedAt: '2026-06-18T08:00:00Z',
    help: false,
    m1StatusFile: 'artifacts/v1/m1-first-run-status.json',
    m2TrustFile: 'artifacts/v1/m2-distribution-trust.json',
    m3IpcFile: 'artifacts/v1/m3-ipc-security.json',
    m4StorageFile: 'artifacts/v1/m4-storage-migration.json',
    milestoneFile: 'docs/V1_MILESTONES.md',
    outputPath: 'artifacts/v1/milestone-audit.json',
    requireAcceptanceEvidence: true,
    requireReady: true,
  })
})

function m1Status(overrides = {}) {
  return {
    schemaVersion: 1,
    gate: 'nexus-v1-m1-first-run-status',
    generatedAt: '2026-06-18T08:30:00.000Z',
    ok: true,
    overallStatus: 'ready',
    targetMilestone: 'M1',
    audit: {
      runtimeEvidence: true,
    },
    missingPlatformIds: [],
    platformCoverage: [
      { platform: 'macos', pass: true, status: 'pass' },
      { platform: 'windows', pass: true, status: 'pass' },
      { platform: 'linux', pass: true, status: 'pass' },
    ],
    nextActions: [],
    privacy: {
      artifactContentsCopied: false,
    },
    ...overrides,
  }
}

function m3IpcSecurity(overrides = {}) {
  return {
    schemaVersion: 1,
    gate: 'nexus-v1-m3-ipc-security-inventory',
    generatedAt: '2026-06-18T09:00:00.000Z',
    ok: true,
    overallStatus: 'ready',
    targetMilestone: 'M3',
    totals: {
      ipcHandlerCount: 170,
      preloadInvokeChannelCount: 170,
      preloadSubscriptionChannelCount: 16,
    },
    preloadContract: {
      missingHandlerChannels: [],
      handlersNotExposedToPreload: [],
      missingSubscriptionSources: [],
    },
    trustedSender: {
      ready: true,
      missingTrustedSenderChannels: [],
    },
    requestValidation: {
      payloadHandlerCount: 101,
      fullRequestValidationReady: true,
      responseValidationReady: false,
      unvalidatedPayloadChannels: [],
    },
    highRiskAudit: {
      highRiskHandlerCount: 125,
      highRiskAuditReady: true,
      unauditedHighRiskChannels: [],
    },
    secretBoundary: {
      ready: true,
      outboundRefResolutionChannelCount: 12,
    },
    globalHighRiskAudit: {
      ready: true,
    },
    auditLog: {
      appendOnlyJsonLines: true,
      rotationConfigured: true,
    },
    blockingIssueIds: [],
    nextActions: [],
    privacy: {
      artifactContentsCopied: false,
    },
    ...overrides,
  }
}

function m2Trust(overrides = {}) {
  return {
    schemaVersion: 1,
    gate: 'nexus-v1-m2-distribution-trust',
    generatedAt: '2026-06-18T08:45:00.000Z',
    ok: true,
    overallStatus: 'ready-with-documented-unsigned-fallback',
    targetMilestone: 'M2',
    platformReadiness: [
      { platform: 'windows', ready: true, status: 'ready', signingStatus: 'unsigned-fallback-documented' },
      { platform: 'macos', ready: true, status: 'ready', signingStatus: 'unsigned-fallback-documented' },
      { platform: 'linux', ready: true, status: 'ready', signingStatus: 'sha256-ready-gpg-optional' },
    ],
    packageSmoke: {
      ready: true,
      totalRecordCount: 3,
      passingRecordCount: 3,
      missingPlatformIds: [],
      platformCoverage: [
        { platform: 'windows', pass: true, status: 'pass', evidenceFiles: ['artifacts/v1/m2-package-smoke-windows.json'] },
        { platform: 'macos', pass: true, status: 'pass', evidenceFiles: ['artifacts/v1/m2-package-smoke-macos.json'] },
        { platform: 'linux', pass: true, status: 'pass', evidenceFiles: ['artifacts/v1/m2-package-smoke-linux.json'] },
      ],
    },
    blockingIssueIds: [],
    nextActions: [],
    privacy: {
      artifactContentsCopied: false,
    },
    ...overrides,
  }
}

function m4Storage(overrides = {}) {
  return {
    schemaVersion: 1,
    gate: 'nexus-v1-m4-storage-migration-inventory',
    generatedAt: '2026-06-18T09:30:00.000Z',
    ok: true,
    overallStatus: 'migration-ready',
    targetMilestone: 'M4',
    inventoryReady: true,
    migrationReady: true,
    totals: {
      uniqueStorageKeyCount: 38,
      directStorageAccessOutsideCoreCount: 22,
    },
    domainCoverage: [
      { domain: 'chat', keyCount: 3, covered: true, migrationPriority: 'p0' },
      { domain: 'memory', keyCount: 8, covered: true, migrationPriority: 'p0' },
      { domain: 'permissions-settings', keyCount: 7, covered: true, migrationPriority: 'p1' },
      { domain: 'audit-logs', keyCount: 14, covered: true, migrationPriority: 'p1' },
    ],
    sqliteDependency: {
      status: 'selected',
      requiresDependencyReview: false,
    },
    migrationPlan: {
      runtimeMigrationEnabled: true,
      localStorageSnapshotCopyEvidenceReady: true,
      localStorageRestoreEvidenceReady: true,
      sourceLocalStoragePreservationRequired: true,
      backupBeforeMutationRequired: true,
      rollbackToolRequired: true,
    },
    blockingIssueIds: [],
    nextActions: [],
    privacy: {
      artifactContentsCopied: false,
    },
    ...overrides,
  }
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

test('v1 milestone audit passes the repository milestone contract', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v1-missing-acceptance-'))
  try {
    const report = await buildV1MilestoneAuditReport({
      generatedAt: '2026-06-18T08:00:00Z',
      m1StatusFile: path.join(directoryPath, 'missing-m1-status.json'),
      m2TrustFile: path.join(directoryPath, 'missing-m2-distribution-trust.json'),
      m3IpcFile: path.join(directoryPath, 'missing-m3-ipc-security.json'),
      m4StorageFile: path.join(directoryPath, 'missing-m4-storage-migration.json'),
    })
    const json = JSON.stringify(report)

    assert.equal(report.gate, V1_MILESTONE_AUDIT_GATE)
    assert.equal(report.generatedAt, '2026-06-18T08:00:00.000Z')
    assert.equal(report.ok, true)
    assert.equal(report.overallStatus, 'ready')
    assert.equal(report.milestoneCount, 11)
    assert.deepEqual(report.missingMilestoneIds, [])
    assert.deepEqual(report.blockingIssueIds, [])
    assert.equal(report.requiredDocs.every((doc) => doc.exists && doc.linkedFromMilestoneContract), true)
    assert.equal(report.priorityCoverage.every((entry) => entry.status === 'covered'), true)
    assert.equal(report.milestones.every((entry) => entry.status === 'ready'), true)
    assert.equal(report.evidenceGates.every((entry) => entry.status === 'ready'), true)
    assert.deepEqual(report.evidenceGates.find((entry) => entry.id === 'm1-first-run-gates')?.missingScripts, [])
    assert.deepEqual(report.evidenceGates.find((entry) => entry.id === 'm1-first-run-gates')?.missingDocTerms, [])
    assert.deepEqual(report.evidenceGates.find((entry) => entry.id === 'm2-distribution-trust-gate')?.missingScripts, [])
    assert.deepEqual(report.evidenceGates.find((entry) => entry.id === 'm2-distribution-trust-gate')?.missingDocTerms, [])
    assert.deepEqual(report.evidenceGates.find((entry) => entry.id === 'm3-ipc-security-gate')?.missingScripts, [])
    assert.deepEqual(report.evidenceGates.find((entry) => entry.id === 'm3-ipc-security-gate')?.missingDocTerms, [])
    assert.deepEqual(report.evidenceGates.find((entry) => entry.id === 'm4-storage-migration-gate')?.missingScripts, [])
    assert.deepEqual(report.evidenceGates.find((entry) => entry.id === 'm4-storage-migration-gate')?.missingDocTerms, [])
    assert.equal(report.acceptanceEvidenceRequired, false)
    assert.equal(report.acceptanceEvidence.find((entry) => entry.id === 'm1-first-run-status')?.status, 'missing')
    assert.equal(report.acceptanceEvidence.find((entry) => entry.id === 'm2-distribution-trust')?.status, 'missing')
    assert.equal(report.acceptanceEvidence.find((entry) => entry.id === 'm3-ipc-security')?.status, 'missing')
    assert.equal(report.acceptanceEvidence.find((entry) => entry.id === 'm4-storage-migration')?.status, 'missing')
    assert.equal(report.privacy.artifactContentsCopied, false)
    assert.equal(json.includes('private user chat sample'), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v1 milestone audit can require M1, M2, M3, and M4 acceptance evidence', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v1-acceptance-evidence-'))
  try {
    const statusPath = path.join(directoryPath, 'm1-first-run-status.json')
    const trustPath = path.join(directoryPath, 'm2-distribution-trust.json')
    const ipcPath = path.join(directoryPath, 'm3-ipc-security.json')
    const storagePath = path.join(directoryPath, 'm4-storage-migration.json')
    await writeJson(statusPath, m1Status())
    await writeJson(trustPath, m2Trust())
    await writeJson(ipcPath, m3IpcSecurity())
    await writeJson(storagePath, m4Storage())

    const readyReport = await buildV1MilestoneAuditReport({
      generatedAt: '2026-06-18T08:00:00Z',
      m1StatusFile: statusPath,
      m2TrustFile: trustPath,
      m3IpcFile: ipcPath,
      m4StorageFile: storagePath,
      requireAcceptanceEvidence: true,
    })

    assert.equal(readyReport.ok, true)
    assert.equal(readyReport.acceptanceEvidenceRequired, true)
    const m1Evidence = readyReport.acceptanceEvidence.find((entry) => entry.id === 'm1-first-run-status')
    assert.equal(m1Evidence?.ready, true)
    assert.equal(m1Evidence?.auditRuntimeEvidence, true)
    assert.deepEqual(m1Evidence?.missingPlatformIds, [])
    assert.deepEqual(m1Evidence?.platformCoverage.map((entry) => entry.platform), ['macos', 'windows', 'linux'])
    const m2Evidence = readyReport.acceptanceEvidence.find((entry) => entry.id === 'm2-distribution-trust')
    assert.equal(m2Evidence?.ready, true)
    assert.equal(m2Evidence?.configurationReady, true)
    assert.equal(m2Evidence?.packageSmokeReady, true)
    assert.equal(m2Evidence?.packageSmokeRecordCount, 3)
    assert.deepEqual(m2Evidence?.missingPackageSmokePlatformIds, [])
    assert.deepEqual(m2Evidence?.platformReadiness.map((entry) => entry.platform), ['windows', 'macos', 'linux'])
    const m3Evidence = readyReport.acceptanceEvidence.find((entry) => entry.id === 'm3-ipc-security')
    assert.equal(m3Evidence?.ready, true)
    assert.equal(m3Evidence?.trustedSenderReady, true)
    assert.equal(m3Evidence?.requestValidationReady, true)
    assert.equal(m3Evidence?.highRiskAuditReady, true)
    assert.equal(m3Evidence?.secretBoundaryReady, true)
    assert.equal(m3Evidence?.globalHighRiskAuditReady, true)
    assert.equal(m3Evidence?.auditLogReady, true)
    assert.equal(m3Evidence?.handlerCount, 170)
    assert.equal(m3Evidence?.payloadHandlerCount, 101)
    assert.equal(m3Evidence?.highRiskHandlerCount, 125)
    assert.deepEqual(m3Evidence?.unvalidatedPayloadChannels, [])
    const m4Evidence = readyReport.acceptanceEvidence.find((entry) => entry.id === 'm4-storage-migration')
    assert.equal(m4Evidence?.ready, true)
    assert.equal(m4Evidence?.inventoryReady, true)
    assert.equal(m4Evidence?.migrationReady, true)
    assert.equal(m4Evidence?.runtimeMigrationEnabled, true)
    assert.equal(m4Evidence?.localStorageSnapshotCopyEvidenceReady, true)
    assert.equal(m4Evidence?.localStorageRestoreEvidenceReady, true)
    assert.equal(m4Evidence?.backupBeforeMutationRequired, true)
    assert.equal(m4Evidence?.rollbackToolRequired, true)
    assert.equal(m4Evidence?.sqliteDependencyStatus, 'selected')
    assert.deepEqual(m4Evidence?.missingDomainIds, [])

    await writeJson(statusPath, m1Status({
      ok: false,
      overallStatus: 'needs-first-run-evidence',
      missingPlatformIds: ['windows'],
      platformCoverage: [
        { platform: 'macos', pass: true, status: 'pass' },
        { platform: 'windows', pass: false, status: 'missing' },
        { platform: 'linux', pass: true, status: 'pass' },
      ],
      nextActions: ['record-windows-first-run-operator-evidence'],
    }))
    const blockedReport = await buildV1MilestoneAuditReport({
      m1StatusFile: statusPath,
      m2TrustFile: trustPath,
      m3IpcFile: ipcPath,
      m4StorageFile: storagePath,
      requireAcceptanceEvidence: true,
    })

    assert.equal(blockedReport.ok, false)
    assert.ok(blockedReport.blockingIssueIds.includes('missing-acceptance-evidence:m1-first-run-status'))
    const blockedEvidence = blockedReport.acceptanceEvidence.find((entry) => entry.id === 'm1-first-run-status')
    assert.equal(blockedEvidence?.status, 'not-ready')
    assert.deepEqual(blockedEvidence?.missingPlatformIds, ['windows'])
    assert.deepEqual(blockedEvidence?.nextActions, ['record-windows-first-run-operator-evidence'])

    await writeJson(statusPath, m1Status())
    await writeJson(trustPath, m2Trust({
      packageSmoke: {
        ready: false,
        totalRecordCount: 1,
        passingRecordCount: 1,
        missingPlatformIds: ['windows', 'linux'],
        platformCoverage: [
          { platform: 'windows', pass: false, status: 'missing', evidenceFiles: [] },
          { platform: 'macos', pass: true, status: 'pass', evidenceFiles: ['artifacts/v1/m2-package-smoke-macos.json'] },
          { platform: 'linux', pass: false, status: 'missing', evidenceFiles: [] },
        ],
      },
      nextActions: ['run-windows-package-smoke', 'run-linux-package-smoke'],
    }))
    const m2BlockedReport = await buildV1MilestoneAuditReport({
      m1StatusFile: statusPath,
      m2TrustFile: trustPath,
      m3IpcFile: ipcPath,
      m4StorageFile: storagePath,
      requireAcceptanceEvidence: true,
    })

    assert.equal(m2BlockedReport.ok, false)
    assert.ok(m2BlockedReport.blockingIssueIds.includes('missing-acceptance-evidence:m2-distribution-trust'))
    const blockedM2Evidence = m2BlockedReport.acceptanceEvidence.find((entry) => entry.id === 'm2-distribution-trust')
    assert.equal(blockedM2Evidence?.status, 'not-ready')
    assert.equal(blockedM2Evidence?.configurationReady, true)
    assert.equal(blockedM2Evidence?.packageSmokeReady, false)
    assert.deepEqual(blockedM2Evidence?.missingPackageSmokePlatformIds, ['windows', 'linux'])
    assert.deepEqual(blockedM2Evidence?.nextActions, ['run-windows-package-smoke', 'run-linux-package-smoke'])

    await writeJson(trustPath, m2Trust())
    await writeJson(ipcPath, m3IpcSecurity({
      ok: false,
      overallStatus: 'needs-governance-work',
      requestValidation: {
        payloadHandlerCount: 101,
        fullRequestValidationReady: false,
        responseValidationReady: false,
        unvalidatedPayloadChannels: ['example:unsafe-channel'],
      },
      highRiskAudit: {
        highRiskHandlerCount: 125,
        highRiskAuditReady: false,
        unauditedHighRiskChannels: ['example:unsafe-channel'],
      },
      blockingIssueIds: [
        'missing-request-validation:example:unsafe-channel',
        'missing-high-risk-audit:example:unsafe-channel',
      ],
      nextActions: ['validate-example-unsafe-channel'],
    }))
    const m3BlockedReport = await buildV1MilestoneAuditReport({
      m1StatusFile: statusPath,
      m2TrustFile: trustPath,
      m3IpcFile: ipcPath,
      m4StorageFile: storagePath,
      requireAcceptanceEvidence: true,
    })

    assert.equal(m3BlockedReport.ok, false)
    assert.ok(m3BlockedReport.blockingIssueIds.includes('missing-acceptance-evidence:m3-ipc-security'))
    const blockedM3Evidence = m3BlockedReport.acceptanceEvidence.find((entry) => entry.id === 'm3-ipc-security')
    assert.equal(blockedM3Evidence?.status, 'not-ready')
    assert.equal(blockedM3Evidence?.requestValidationReady, false)
    assert.equal(blockedM3Evidence?.highRiskAuditReady, false)
    assert.deepEqual(blockedM3Evidence?.unvalidatedPayloadChannels, ['example:unsafe-channel'])
    assert.deepEqual(blockedM3Evidence?.unauditedHighRiskChannels, ['example:unsafe-channel'])
    assert.deepEqual(blockedM3Evidence?.nextActions, ['validate-example-unsafe-channel'])

    await writeJson(ipcPath, m3IpcSecurity())
    await writeJson(storagePath, m4Storage({
      ok: true,
      overallStatus: 'inventory-ready-migration-not-started',
      migrationReady: false,
      sqliteDependency: {
        status: 'not-selected',
        requiresDependencyReview: true,
      },
      migrationPlan: {
        runtimeMigrationEnabled: false,
        sourceLocalStoragePreservationRequired: true,
        backupBeforeMutationRequired: true,
        rollbackToolRequired: true,
      },
      nextActions: ['choose-sqlite-dependency-after-packaging-review'],
    }))
    const m4BlockedReport = await buildV1MilestoneAuditReport({
      m1StatusFile: statusPath,
      m2TrustFile: trustPath,
      m3IpcFile: ipcPath,
      m4StorageFile: storagePath,
      requireAcceptanceEvidence: true,
    })

    assert.equal(m4BlockedReport.ok, false)
    assert.ok(m4BlockedReport.blockingIssueIds.includes('missing-acceptance-evidence:m4-storage-migration'))
    const blockedM4Evidence = m4BlockedReport.acceptanceEvidence.find((entry) => entry.id === 'm4-storage-migration')
    assert.equal(blockedM4Evidence?.status, 'not-ready')
    assert.equal(blockedM4Evidence?.inventoryReady, true)
    assert.equal(blockedM4Evidence?.migrationReady, false)
    assert.equal(blockedM4Evidence?.runtimeMigrationEnabled, false)
    assert.equal(blockedM4Evidence?.sqliteDependencyStatus, 'not-selected')
    assert.equal(blockedM4Evidence?.sqliteDependencyReviewRequired, true)
    assert.deepEqual(blockedM4Evidence?.nextActions, ['choose-sqlite-dependency-after-packaging-review'])
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v1 milestone audit reports missing sections and coverage gaps', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v1-milestone-audit-'))
  try {
    const milestoneFile = path.join(directoryPath, 'V1_MILESTONES.md')
    await writeFile(milestoneFile, [
      '# Broken Milestones',
      '',
      'Related maintained documents: docs/ROADMAP.md.',
      '',
      '## M0 - Only One Stage',
      '',
      '### Objective',
      '',
      'This intentionally omits required sections and long-term priority coverage.',
      '',
    ].join('\n'), 'utf8')

    const report = await buildV1MilestoneAuditReport({
      milestoneFile,
      generatedAt: '2026-06-18T08:00:00Z',
    })

    assert.equal(report.ok, false)
    assert.equal(report.overallStatus, 'needs-governance-work')
    assert.ok(report.blockingIssueIds.includes('unlinked-doc:docs/ARCHITECTURE.md'))
    assert.ok(report.blockingIssueIds.includes('unlinked-doc:CHANGELOG.md'))
    assert.ok(report.blockingIssueIds.includes('missing-milestone:M1'))
    assert.ok(report.blockingIssueIds.includes('incomplete-milestone:M0'))
    assert.ok(report.blockingIssueIds.includes('missing-evidence-gate:m1-first-run-gates'))
    assert.ok(report.blockingIssueIds.some((id) => id.startsWith('missing-priority:')))
    assert.deepEqual(report.milestones[0]?.missingSections.includes('Technical Design'), true)
    assert.ok(report.evidenceGates[0]?.missingDocTerms.some((term) => term.includes('m1:first-run:status')))
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v1 milestone audit CLI persists report and enforces readiness', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v1-milestone-cli-'))
  try {
    const outputPath = path.join(directoryPath, 'milestone-audit.json')
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/v1-milestone-audit.mjs',
      '--generated-at',
      '2026-06-18T08:00:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)

    const brokenMilestoneFile = path.join(directoryPath, 'broken.md')
    await writeFile(brokenMilestoneFile, '# Broken\n', 'utf8')
    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/v1-milestone-audit.mjs',
        '--milestone-file',
        brokenMilestoneFile,
        '--require-ready',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const err = error as { code?: number; stdout?: string }
        assert.equal(err.code, 1)
        const report = JSON.parse(err.stdout ?? '{}')
        assert.equal(report.ok, false)
        assert.ok(report.blockingIssueIds.includes('missing-milestone:M0'))
        return true
      },
    )
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v1 milestone audit package wiring stays available', async () => {
  const scriptText = await readFile('scripts/v1-milestone-audit.mjs', 'utf8')
  const roadmap = await readFile('docs/ROADMAP.md', 'utf8')
  const architecture = await readFile('docs/ARCHITECTURE.md', 'utf8')
  const changelog = await readFile('CHANGELOG.md', 'utf8')

  assert.equal(packageJson.scripts?.['v1:milestone:audit'], 'node scripts/v1-milestone-audit.mjs')
  assert.equal(packageJson.scripts?.['m1:first-run:audit'], 'node --experimental-strip-types scripts/m1-first-run-audit.mjs')
  assert.equal(packageJson.scripts?.['m1:first-run:record'], 'node scripts/m1-first-run-record.mjs')
  assert.equal(packageJson.scripts?.['m1:first-run:status'], 'node scripts/m1-first-run-status.mjs')
  assert.equal(packageJson.scripts?.['m2:distribution:trust'], 'node scripts/m2-distribution-trust-audit.mjs')
  assert.equal(packageJson.scripts?.['m2:package-smoke:current'], 'cross-env PACKAGED_SMOKE_EVIDENCE_FILE=artifacts/v1/m2-package-smoke-current.json npm run smoke:packaged')
  assert.equal(packageJson.scripts?.['m3:ipc:audit'], 'node scripts/m3-ipc-security-audit.mjs')
  assert.equal(packageJson.scripts?.['m4:storage:audit'], 'node scripts/m4-storage-migration-audit.mjs')
  assert.equal(packageJson.scripts?.['m4:sqlite:foundation'], 'node scripts/m4-sqlite-foundation-audit.mjs')
  assert.equal(packageJson.scripts?.['m4:storage:restore:evidence'], 'node scripts/m4-storage-restore-evidence.mjs')
  assert.match(scriptText, /nexus-v1-milestone-governance/)
  assert.match(scriptText, /m1:first-run:status/)
  assert.match(scriptText, /m2:distribution:trust/)
  assert.match(scriptText, /m3:ipc:audit/)
  assert.match(scriptText, /m4:storage:audit/)
  assert.match(scriptText, /m4:sqlite:foundation/)
  assert.match(scriptText, /m4:storage:restore:evidence/)
  assert.match(roadmap, /V1_MILESTONES/)
  assert.match(architecture, /V1_MILESTONES/)
  assert.match(changelog, /v1\.0 milestone governance/)
})
