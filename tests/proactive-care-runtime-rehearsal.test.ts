import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildProactiveCareRuntimeRehearsalReport,
  DEFAULT_PROACTIVE_CARE_RUNTIME_REHEARSAL_OUTPUT,
  parseProactiveCareRuntimeRehearsalArgs,
  PROACTIVE_CARE_RUNTIME_REHEARSAL_GATE,
} from '../scripts/proactive-care-runtime-rehearsal.mjs'
import packageJson from '../package.json' with { type: 'json' }

const execFileAsync = promisify(execFile)

test('proactive care runtime rehearsal args default to the release evidence artifact', () => {
  assert.deepEqual(parseProactiveCareRuntimeRehearsalArgs([
    '--generated-at=2026-06-17T12:00:00Z',
    '--require-ready',
  ]), {
    generatedAt: '2026-06-17T12:00:00Z',
    help: false,
    outputPath: DEFAULT_PROACTIVE_CARE_RUNTIME_REHEARSAL_OUTPUT,
    requireReady: true,
  })
})

test('proactive care runtime rehearsal exercises v2 storage paths with private-safe output', async () => {
  const report = await buildProactiveCareRuntimeRehearsalReport({
    generatedAt: '2026-06-17T12:00:00Z',
  })
  const json = JSON.stringify(report)

  assert.equal(report.gate, 'proactive-care-observability')
  assert.equal(report.generatedAt, '2026-06-17T12:00:00.000Z')
  assert.equal(report.ok, true)
  assert.equal(report.evidenceSource, 'runtime-rehearsal')
  assert.equal(report.rehearsal.gate, PROACTIVE_CARE_RUNTIME_REHEARSAL_GATE)
  assert.equal(report.rehearsal.isolatedStorage, true)
  assert.equal(report.rehearsal.exercisedStorageApi, true)
  assert.equal(report.totalEvents, 4)
  assert.equal(report.coverageWindowHours >= 2, true)
  assert.equal(report.v2EventCount, 4)
  assert.equal(report.userVisibleReasonCount, 4)
  assert.equal(report.userActionCounts.open_source, 1)
  assert.deepEqual(report.nextActions, [])
  assert.equal(report.checks.every((check) => check.pass), true)
  assert.equal(report.latestEvents.every((event) => event.hasUserVisibleReason), true)
  assert.equal(report.latestEvents.every((event) => event.sourceRef?.openable === true), true)
  assert.equal(json.includes('rehearsal-message-1'), false)
  assert.equal(json.includes('rehearsal-arc-1'), false)
  assert.equal(json.includes('rehearsal-capsule-1'), false)
  assert.equal(json.includes('You were away long enough'), false)
  assert.equal(json.includes('Runtime rehearsal due-item evidence'), false)
})

test('proactive care runtime rehearsal CLI writes a ready artifact', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-proactive-care-rehearsal-'))
  try {
    const outputPath = path.join(outputRoot, 'artifacts', 'v0.3.4', 'proactive-care-evidence.json')
    const { stdout } = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      'scripts/proactive-care-runtime-rehearsal.mjs',
      '--generated-at',
      '2026-06-17T12:00:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))

    assert.equal(stdoutReport.ok, true)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.evidenceSource, 'runtime-rehearsal')
    assert.equal(fileReport.rehearsal.gate, PROACTIVE_CARE_RUNTIME_REHEARSAL_GATE)
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('proactive care runtime rehearsal wiring stays available in packaged builds', () => {
  assert.equal(
    packageJson.scripts?.['proactive:care:rehearsal'],
    'node --experimental-strip-types scripts/proactive-care-runtime-rehearsal.mjs',
  )
  assert.ok(packageJson.build?.files?.includes('scripts/proactive-care-runtime-rehearsal.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/proactive-care-runtime-rehearsal.mjs'))
})
