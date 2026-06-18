import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildStabilizationEvidenceStatusReport,
  parseStabilizationEvidenceStatusArgs,
  STABILIZATION_EVIDENCE_ARTIFACTS,
  STABILIZATION_EVIDENCE_STATUS_GATE,
} from '../scripts/stabilization-evidence-status.mjs'
import packageJson from '../package.json' with { type: 'json' }

const execFileAsync = promisify(execFile)

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function writeReadyArtifacts(artifactDir: string) {
  await writeJson(path.join(artifactDir, 'companion-readiness.json'), {
    gate: 'companion-readiness-health',
    generatedAt: '2026-06-17T11:58:00Z',
    ok: true,
    privateValue: 'private readiness endpoint',
  })
  await writeJson(path.join(artifactDir, 'memory-map.json'), {
    gate: 'memory-map-observability',
    generatedAt: '2026-06-17T11:59:00Z',
    ok: true,
    privateValue: 'private memory body',
  })
  await writeJson(path.join(artifactDir, 'proactive-care-evidence.json'), {
    gate: 'proactive-care-observability',
    generatedAt: '2026-06-17T12:00:00Z',
    ok: true,
    evidenceSource: 'runtime-events',
    privateValue: 'private proactive event detail',
  })
  await writeJson(path.join(artifactDir, 'live2d-action-map.json'), {
    gate: 'live2d-action-map-coverage',
    generatedAt: '2026-06-17T12:01:00Z',
    ok: true,
    privateValue: 'private expression target',
  })
  await writeJson(path.join(artifactDir, 'character-card-import.json'), {
    gate: 'character-card-import',
    generatedAt: '2026-06-17T12:02:00Z',
    ok: true,
    privateValue: 'private character card text',
  })
  await writeJson(path.join(artifactDir, 'voice-diagnostics.json'), {
    schema: 'nexus.voice-diagnostics.v1',
    generatedAt: '2026-06-17T12:03:00Z',
    ok: true,
    privateValue: 'private voice transcript',
  })
  await writeJson(path.join(artifactDir, 'tts-adapter-smoke.json'), {
    gate: 'nexus-tts-adapter-smoke',
    generatedAt: '2026-06-17T12:04:00Z',
    ok: true,
    privateValue: 'private tts request text',
  })
}

test('stabilization evidence status args support artifact dir, output and readiness', () => {
  assert.deepEqual(parseStabilizationEvidenceStatusArgs([
    '--artifact-dir',
    'artifacts/v0.3.4',
    '--generated-at=2026-06-17T12:00:00Z',
    '--target-version',
    '0.4',
    '--output',
    'artifacts/v0.3.4/stabilization-evidence-status.json',
    '--require-ready',
  ]), {
    artifactDir: 'artifacts/v0.3.4',
    generatedAt: '2026-06-17T12:00:00Z',
    help: false,
    list: false,
    outputPath: 'artifacts/v0.3.4/stabilization-evidence-status.json',
    requireReady: true,
    targetVersion: '0.4',
  })
})

test('stabilization evidence status summarizes ready artifacts without copying private contents', async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), 'nexus-stabilization-ready-'))
  try {
    await writeReadyArtifacts(artifactDir)
    const report = await buildStabilizationEvidenceStatusReport({
      artifactDir,
      generatedAt: '2026-06-17T12:05:00Z',
    })
    const json = JSON.stringify(report)

    assert.equal(report.gate, STABILIZATION_EVIDENCE_STATUS_GATE)
    assert.equal(report.generatedAt, '2026-06-17T12:05:00.000Z')
    assert.equal(report.targetVersion, '0.3.4')
    assert.equal(report.ok, true)
    assert.equal(report.overallStatus, 'ready')
    assert.equal(report.passCount, report.totalCount)
    assert.equal(report.totalCount, STABILIZATION_EVIDENCE_ARTIFACTS.length)
    assert.equal(report.artifactDir, '<custom-artifact-dir>')
    assert.deepEqual(report.missingCheckIds, [])
    assert.deepEqual(report.failedCheckIds, [])
    assert.deepEqual(report.invalidCheckIds, [])
    assert.deepEqual(report.optionalCheckIds, [])
    assert.deepEqual(report.optionalFailedCheckIds, [])
    assert.equal(report.checks.every((check) => check.status === 'pass'), true)
    assert.equal(report.checks.every((check) => !check.path.includes(artifactDir)), true)
    assert.equal(json.includes('private proactive event detail'), false)
    assert.equal(json.includes('private expression target'), false)
    assert.equal(json.includes('private character card text'), false)
    assert.equal(json.includes('private voice transcript'), false)
    assert.equal(json.includes('private tts request text'), false)
    assert.equal(json.includes(artifactDir), false)
  } finally {
    await rm(artifactDir, { recursive: true, force: true })
  }
})

test('stabilization evidence status treats local TTS adapter smoke as optional for v0.4', async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), 'nexus-stabilization-v04-optional-'))
  try {
    await writeReadyArtifacts(artifactDir)
    await writeJson(path.join(artifactDir, 'tts-adapter-smoke.json'), {
      gate: 'nexus-tts-adapter-smoke',
      generatedAt: '2026-06-17T12:04:00Z',
      ok: false,
      error: {
        kind: 'network-error',
        detail: 'private endpoint detail should not be copied',
      },
      nextActions: [
        'Start the local TTS adapter and confirm its /audio/speech endpoint is reachable.',
      ],
    })

    const report = await buildStabilizationEvidenceStatusReport({
      artifactDir,
      generatedAt: '2026-06-17T12:05:00Z',
      targetVersion: '0.4',
    })
    const ttsCheck = report.checks.find((check) => check.id === 'p2.local_tts_adapter_smoke')

    assert.equal(report.ok, true)
    assert.equal(report.overallStatus, 'ready-with-optional-gaps')
    assert.equal(report.targetVersion, '0.4')
    assert.deepEqual(report.failedCheckIds, [])
    assert.deepEqual(report.optionalCheckIds, ['p2.local_tts_adapter_smoke'])
    assert.deepEqual(report.optionalFailedCheckIds, ['p2.local_tts_adapter_smoke'])
    assert.equal(ttsCheck?.required, false)
    assert.equal(ttsCheck?.blocking, false)
    assert.equal(ttsCheck?.status, 'optional_failed')
    assert.match(ttsCheck?.optionalReason ?? '', /Beta/)
    assert.deepEqual(report.nextCommands, [])
    assert.equal(report.optionalNextCommands.length, 1)
    assert.equal(report.optionalNextCommands[0]?.id, 'p2.local_tts_adapter_smoke')
  } finally {
    await rm(artifactDir, { recursive: true, force: true })
  }
})

test('stabilization evidence status keeps missing, failed and invalid evidence explicit', async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), 'nexus-stabilization-missing-'))
  try {
    await writeJson(path.join(artifactDir, 'proactive-care-evidence.json'), {
      gate: 'proactive-care-observability',
      ok: false,
    })
    await writeJson(path.join(artifactDir, 'live2d-action-map.json'), {
      gate: 'wrong-gate',
      ok: true,
    })
    await writeJson(path.join(artifactDir, 'character-card-import.json'), {
      gate: 'character-card-import',
      ok: true,
    })
    await writeFile(path.join(artifactDir, 'tts-adapter-smoke.json'), '{bad json', 'utf8')

    const report = await buildStabilizationEvidenceStatusReport({
      artifactDir,
      generatedAt: 'bad-date',
    })

    assert.equal(report.ok, false)
    assert.equal(report.overallStatus, 'needs-evidence')
    assert.equal(Number.isFinite(Date.parse(report.generatedAt)), true)
    assert.deepEqual(report.missingCheckIds, [
      'p1.companion_readiness',
      'p1.memory_map',
      'p2.voice_diagnostics',
    ])
    assert.deepEqual(report.failedCheckIds.sort(), ['p1.proactive_care', 'p2.live2d_action_map'])
    assert.deepEqual(report.invalidCheckIds, ['p2.local_tts_adapter_smoke'])
    assert.equal(report.checks.find((check) => check.id === 'p1.proactive_care')?.status, 'failed')
  assert.equal(report.checks.find((check) => check.id === 'p2.live2d_action_map')?.markerOk, false)
  assert.equal(report.checks.find((check) => check.id === 'p2.character_card_import')?.status, 'pass')
  assert.equal(report.nextCommands.length, 6)
  assert.ok(report.nextCommands.some((entry) => entry.id === 'p1.companion_readiness'))
  assert.ok(report.nextCommands.some((entry) => entry.id === 'p1.memory_map'))
  assert.ok(report.nextCommands.some((entry) => entry.id === 'p2.voice_diagnostics'))
  assert.ok(report.nextCommands.some((entry) =>
    entry.id === 'p2.live2d_action_map' && entry.command.includes('--model mao'),
  ))
  } finally {
    await rm(artifactDir, { recursive: true, force: true })
  }
})

test('stabilization evidence status rejects proactive-care sample QA artifacts', async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), 'nexus-stabilization-sample-'))
  try {
    await writeReadyArtifacts(artifactDir)
    await writeJson(path.join(artifactDir, 'proactive-care-evidence.json'), {
      gate: 'proactive-care-observability',
      generatedAt: '2026-06-17T12:00:00Z',
      ok: true,
      evidenceSource: 'sample-qa',
      privateValue: 'private proactive event detail',
    })

    const report = await buildStabilizationEvidenceStatusReport({
      artifactDir,
      generatedAt: '2026-06-17T12:05:00Z',
    })
    const proactiveCheck = report.checks.find((check) => check.id === 'p1.proactive_care')

    assert.equal(report.ok, false)
    assert.equal(report.overallStatus, 'needs-evidence')
    assert.deepEqual(report.failedCheckIds, ['p1.proactive_care'])
    assert.equal(proactiveCheck?.status, 'failed')
    assert.equal(proactiveCheck?.artifactOk, true)
    assert.equal(proactiveCheck?.markerOk, true)
    assert.equal(proactiveCheck?.evidenceSource, 'sample-qa')
    assert.equal(proactiveCheck?.sourceRejected, true)
    assert.match(proactiveCheck?.detail ?? '', /QA only/)
  } finally {
    await rm(artifactDir, { recursive: true, force: true })
  }
})

test('stabilization evidence status surfaces safe proactive-care failed checks', async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), 'nexus-stabilization-proactive-failed-'))
  try {
    await writeReadyArtifacts(artifactDir)
    await writeJson(path.join(artifactDir, 'proactive-care-evidence.json'), {
      gate: 'proactive-care-observability',
      generatedAt: '2026-06-17T12:00:00Z',
      ok: false,
      evidenceSource: 'runtime-events',
      checks: [
        { id: 'has-fired', pass: false, detail: 'private check detail should not copy' },
        { id: 'has-rate-limit-skip', pass: false, detail: 'private rate detail should not copy' },
        { id: 'has-v2-policy-events', pass: false, detail: 'private policy detail should not copy' },
        { id: 'has-user-visible-reasons', pass: false, detail: 'private reason detail should not copy' },
        { id: 'has-user-feedback-actions', pass: false, detail: 'private feedback detail should not copy' },
        { id: 'private-user-message-id', pass: false, detail: 'private id should not copy' },
      ],
      nextActions: ['Private next action should not mention event id private-event-id'],
      privateValue: 'private proactive event detail',
    })

    const report = await buildStabilizationEvidenceStatusReport({
      artifactDir,
      generatedAt: '2026-06-17T12:05:00Z',
    })
    const proactiveCheck = report.checks.find((check) => check.id === 'p1.proactive_care')
    const json = JSON.stringify(report)

    assert.equal(report.ok, false)
    assert.deepEqual(report.failedCheckIds, ['p1.proactive_care'])
    assert.deepEqual(proactiveCheck?.artifactFailedChecks, [
      'has-fired',
      'has-rate-limit-skip',
      'has-v2-policy-events',
      'has-user-visible-reasons',
      'has-user-feedback-actions',
    ])
    assert.equal(proactiveCheck?.artifactNextActions, undefined)
    assert.ok(report.nextCommands.some((entry) =>
      entry.id === 'p1.proactive_care'
        && entry.reason.includes('has-fired')
        && entry.reason.includes('has-rate-limit-skip'),
    ))
    assert.ok(report.nextCommands.some((entry) =>
      entry.id === 'p1.proactive_care'
        && entry.reason.includes('native notification path'),
    ))
    assert.ok(report.nextCommands.some((entry) =>
      entry.id === 'p1.proactive_care'
        && entry.reason.includes('carePolicyVersion=2'),
    ))
    assert.equal(json.includes('private proactive event detail'), false)
    assert.equal(json.includes('private check detail'), false)
    assert.equal(json.includes('private policy detail'), false)
    assert.equal(json.includes('private reason detail'), false)
    assert.equal(json.includes('private feedback detail'), false)
    assert.equal(json.includes('private-user-message-id'), false)
    assert.equal(json.includes('private-event-id'), false)
  } finally {
    await rm(artifactDir, { recursive: true, force: true })
  }
})

test('stabilization evidence status surfaces safe TTS smoke failure hints', async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), 'nexus-stabilization-tts-failed-'))
  try {
    await writeReadyArtifacts(artifactDir)
    await writeJson(path.join(artifactDir, 'tts-adapter-smoke.json'), {
      gate: 'nexus-tts-adapter-smoke',
      generatedAt: '2026-06-17T12:04:00Z',
      ok: false,
      error: {
        kind: 'network-error',
        detail: 'private endpoint detail should not be copied',
      },
      nextActions: [
        'Start the local TTS adapter and confirm its /audio/speech endpoint is reachable.',
        'Check the local adapter process, model load, and port binding before rerunning the smoke. '.repeat(4),
      ],
      privateValue: 'private tts request text',
    })

    const report = await buildStabilizationEvidenceStatusReport({
      artifactDir,
      generatedAt: '2026-06-17T12:05:00Z',
    })
    const ttsCheck = report.checks.find((check) => check.id === 'p2.local_tts_adapter_smoke')
    const json = JSON.stringify(report)

    assert.equal(report.ok, false)
    assert.deepEqual(report.failedCheckIds, ['p2.local_tts_adapter_smoke'])
    assert.equal(ttsCheck?.status, 'failed')
    assert.equal(ttsCheck?.artifactErrorKind, 'network-error')
    assert.ok(ttsCheck?.artifactNextActions?.[0]?.includes('/audio/speech'))
    assert.ok((ttsCheck?.artifactNextActions?.[1]?.length ?? 0) <= 180)
    assert.ok(report.nextCommands.some((entry) =>
      entry.id === 'p2.local_tts_adapter_smoke'
        && entry.reason.includes('network-error')
        && entry.reason.includes('/audio/speech'),
    ))
    assert.equal(json.includes('private endpoint detail'), false)
    assert.equal(json.includes('private tts request text'), false)
  } finally {
    await rm(artifactDir, { recursive: true, force: true })
  }
})

test('stabilization evidence status CLI can persist private-safe status and enforce readiness', async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), 'nexus-stabilization-cli-'))
  const outputPath = path.join(artifactDir, 'status-output.json')
  try {
    await writeReadyArtifacts(artifactDir)
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/stabilization-evidence-status.mjs',
      '--artifact-dir',
      artifactDir,
      '--generated-at',
      '2026-06-17T12:05:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.artifactDir, '<custom-artifact-dir>')
    assert.equal(json.includes(artifactDir), false)

    await rm(path.join(artifactDir, 'voice-diagnostics.json'), { force: true })
    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/stabilization-evidence-status.mjs',
        '--artifact-dir',
        artifactDir,
        '--require-ready',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const err = error as { code?: number; stdout?: string }
        assert.equal(err.code, 1)
        const report = JSON.parse(err.stdout ?? '{}')
        assert.equal(report.ok, false)
        assert.deepEqual(report.missingCheckIds, ['p2.voice_diagnostics'])
        return true
      },
    )
  } finally {
    await rm(artifactDir, { recursive: true, force: true })
  }
})

test('stabilization evidence status manifest and package wiring stay available', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/stabilization-evidence-status.mjs',
    '--list',
  ], { cwd: process.cwd() })
  const manifest = JSON.parse(stdout)

  assert.equal(manifest.gate, STABILIZATION_EVIDENCE_STATUS_GATE)
  assert.ok(manifest.artifacts.some((entry: { id: string }) => entry.id === 'p1.proactive_care'))
  assert.ok(manifest.artifacts.some((entry: { id: string }) => entry.id === 'p1.companion_readiness'))
  assert.ok(manifest.artifacts.some((entry: { id: string }) => entry.id === 'p1.memory_map'))
  assert.ok(manifest.artifacts.some((entry: { command: string; id: string }) =>
    entry.id === 'p1.companion_readiness'
      && entry.command.includes('companion:readiness:report')
      && entry.command.includes('--sample'),
  ))
  assert.ok(manifest.artifacts.some((entry: { command: string; id: string }) =>
    entry.id === 'p1.memory_map'
      && entry.command.includes('memory:map:report')
      && entry.command.includes('--sample'),
  ))
  assert.ok(manifest.artifacts.some((entry: { command: string; id: string }) =>
    entry.id === 'p1.proactive_care'
      && entry.command.includes('proactive:care:rehearsal')
      && entry.command.includes('--require-ready'),
  ))
  assert.ok(manifest.artifacts.some((entry: { id: string }) => entry.id === 'p2.local_tts_adapter_smoke'))
  assert.ok(manifest.artifacts.some((entry: { command: string; id: string }) =>
    entry.id === 'p2.character_card_import'
      && entry.command.includes('character:card:report')
      && entry.command.includes('--sample'),
  ))
  assert.ok(manifest.artifacts.some((entry: { command: string; id: string }) =>
    entry.id === 'p2.local_tts_adapter_smoke'
      && entry.command.includes('tts:adapter:smoke')
      && entry.command.includes('--require-ready'),
  ))
  assert.equal(
    packageJson.scripts?.['stabilization:evidence:status'],
    'node scripts/stabilization-evidence-status.mjs --target-version 0.4',
  )
  assert.equal(
    packageJson.scripts?.['companion:readiness:report'],
    'node --experimental-strip-types scripts/companion-readiness-report.mjs',
  )
  assert.equal(
    packageJson.scripts?.['memory:map:report'],
    'node --experimental-strip-types scripts/memory-map-report.mjs',
  )
  assert.ok(packageJson.build?.files?.includes('scripts/companion-readiness-report.mjs'))
  assert.ok(packageJson.build?.files?.includes('scripts/memory-map-report.mjs'))
  assert.ok(packageJson.build?.files?.includes('scripts/stabilization-evidence-status.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/companion-readiness-report.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/memory-map-report.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/stabilization-evidence-status.mjs'))
})
