import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { parsePrivacySafetyReportArgs } from '../scripts/privacy-safety-report.mjs'
import { buildPrivacySafetyEvidenceReport } from '../src/features/stabilization/privacySafetyEvidence.ts'

const execFileAsync = promisify(execFile)

test('privacy safety evidence covers AI disclosure, crisis support, and age-market boundaries', () => {
  const report = buildPrivacySafetyEvidenceReport({
    generatedAt: '2026-06-17T12:00:00Z',
  })
  const crisisCheck = report.checks.find((check) => check.id === 'crisis-response-support')
  const boundaryCheck = report.checks.find((check) => check.id === 'age-and-market-boundaries')

  assert.equal(report.gate, 'v0.4-privacy-safety-boundaries')
  assert.equal(report.generatedAt, '2026-06-17T12:00:00.000Z')
  assert.equal(report.ok, true)
  assert.deepEqual(report.failedCheckIds, [])
  assert.equal(report.checks.every((check) => check.pass), true)
  assert.deepEqual(crisisCheck?.evidence.detectedLocales, ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko'])
  assert.equal(crisisCheck?.evidence.guidanceBlocksMethods, true)
  assert.equal(crisisCheck?.evidence.guidanceBlocksMedicalAdvice, true)
  assert.equal(crisisCheck?.evidence.guidancePointsToHumanSupport, true)
  assert.equal(boundaryCheck?.evidence.adultOrNsfwMarketplaceAllowed, false)
  assert.equal(boundaryCheck?.evidence.minorDirectedExperienceAllowed, false)
  assert.equal(boundaryCheck?.evidence.dependencyReinforcementMechanicsAllowed, false)
  assert.ok(report.privacy.privateFieldsOmitted.includes('user messages'))
})

test('privacy safety evidence fails closed when companion boundary policy is weakened', () => {
  const report = buildPrivacySafetyEvidenceReport({
    generatedAt: '2026-06-17T12:00:00Z',
    policy: {
      adultOrNsfwMarketplaceAllowed: true,
      aiDisclosureRequired: true,
      dependencyReinforcementMechanicsAllowed: false,
      humanRelationshipSubstituteClaimAllowed: true,
      minorDirectedExperienceAllowed: false,
      relationshipScoreMechanicsAllowed: false,
    },
  })

  assert.equal(report.ok, false)
  assert.deepEqual(report.failedCheckIds.sort(), [
    'age-and-market-boundaries',
    'ai-companion-disclosure',
  ])
})

test('privacy safety report args support output and readiness enforcement', () => {
  assert.deepEqual(parsePrivacySafetyReportArgs([
    '--generated-at=2026-06-17T12:00:00Z',
    '--output',
    'artifacts/v0.3.4/privacy-safety.json',
    '--require-ready',
  ]), {
    generatedAt: '2026-06-17T12:00:00Z',
    help: false,
    outputPath: 'artifacts/v0.3.4/privacy-safety.json',
    requireReady: true,
  })
})

test('privacy safety report CLI persists the source-backed evidence artifact', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-privacy-safety-'))
  try {
    const outputPath = path.join(directoryPath, 'privacy-safety.json')
    await mkdir(path.dirname(outputPath), { recursive: true })

    const { stdout } = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      'scripts/privacy-safety-report.mjs',
      '--generated-at',
      '2026-06-17T12:00:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.gate, 'v0.4-privacy-safety-boundaries')
    assert.equal(fileReport.generatedAt, '2026-06-17T12:00:00.000Z')
    assert.equal(fileReport.ok, true)
    assert.equal(json.includes('private local webhook payload'), false)
    assert.equal(json.includes('message sender/body/source ids'), true)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})
