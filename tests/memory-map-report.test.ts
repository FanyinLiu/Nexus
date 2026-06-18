import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildMemoryMapEvidenceReport,
  MEMORY_MAP_EVIDENCE_GATE,
  parseMemoryMapReportArgs,
} from '../scripts/memory-map-report.mjs'

const execFileAsync = promisify(execFile)

test('memory map report args support sample, input, output and readiness', () => {
  assert.deepEqual(parseMemoryMapReportArgs([
    '--sample',
    '--input',
    'ignored-when-sample.json',
    '--generated-at=2026-06-17T12:00:00Z',
    '--output',
    'artifacts/v0.3.4/memory-map.json',
    '--require-ready',
  ]), {
    generatedAt: '2026-06-17T12:00:00Z',
    help: false,
    inputPath: 'ignored-when-sample.json',
    outputPath: 'artifacts/v0.3.4/memory-map.json',
    requireReady: true,
    sample: true,
  })
})

test('memory map sample report is private-safe and covers graph, source and timeline surfaces', () => {
  const report = buildMemoryMapEvidenceReport(undefined, '2026-06-17T12:00:00Z')
  const json = JSON.stringify(report)

  assert.equal(report.gate, MEMORY_MAP_EVIDENCE_GATE)
  assert.equal(report.generatedAt, '2026-06-17T12:00:00.000Z')
  assert.equal(report.ok, true)
  assert.equal(report.viewSchema, 'nexus.memory-map.v1')
  assert.equal(report.summary.longTermCount, 2)
  assert.equal(report.summary.dailyEntryCount, 1)
  assert.equal(report.summary.openableSourceRefCount, 3)
  assert.equal(report.summary.pinnedCount, 1)
  assert.equal(report.summary.recallPausedCount, 1)
  assert.equal(report.nodeKindCounts.relationship_state, 2)
  assert.equal(report.edgeKindCounts.source_ref, 3)
  assert.equal(report.timelineKindCounts.relationship_state, 1)
  assert.deepEqual(report.failedCheckIds, [])
  assert.equal(json.includes('quiet companionship'), false)
  assert.equal(json.includes('sample-preference'), false)
  assert.equal(json.includes('chat:sample-turn'), false)
  assert.equal(json.includes('sample-daily-1'), false)
})

test('memory map CLI persists reports and enforces readiness', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-memory-map-'))
  const outputPath = path.join(directoryPath, 'memory-map.json')
  const emptyInputPath = path.join(directoryPath, 'empty-input.json')
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      'scripts/memory-map-report.mjs',
      '--sample',
      '--generated-at',
      '2026-06-17T12:00:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)

    await writeFile(emptyInputPath, JSON.stringify({
      dailyMemories: [],
      memories: [],
      relationshipSamples: [],
    }), 'utf8')

    await assert.rejects(
      execFileAsync(process.execPath, [
        '--experimental-strip-types',
        'scripts/memory-map-report.mjs',
        '--input',
        emptyInputPath,
        '--require-ready',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const err = error as { code?: number; stdout?: string }
        assert.equal(err.code, 1)
        const report = JSON.parse(err.stdout ?? '{}')
        assert.equal(report.ok, false)
        assert.ok(report.failedCheckIds.includes('has-long-term-memories'))
        assert.ok(report.failedCheckIds.includes('has-relationship-timeline'))
        assert.ok(report.failedCheckIds.includes('has-core-node-kinds'))
        return true
      },
    )
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})
