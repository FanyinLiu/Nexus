import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  applyPetActionMapOverride,
  buildPetActionMapDraft,
  buildPetActionMapReport,
  buildPublicPetActionMapEvidenceReport,
  normalizePetActionMapDraftPatch,
} from '../src/features/pet/actionMap.ts'
import {
  buildRuntimePetModelDefinition,
  getPetModelPreset,
  type CubismModelFile,
} from '../src/features/pet/models.ts'
import {
  parseLive2dActionMapReportArgs,
} from '../scripts/live2d-action-map-report.mjs'

const execFileAsync = promisify(execFile)

test('buildRuntimePetModelDefinition preserves authored non-positional expression slots', () => {
  const mao = getPetModelPreset('mao')
  // Sanity: the preset authors the three slots that have no positional default.
  assert.equal(mao.expressionMap.surprised, 'exp_08')
  assert.equal(mao.expressionMap.confused, 'exp_03')
  assert.equal(mao.expressionMap.embarrassed, 'exp_07')

  const modelFile = {
    FileReferences: {
      Expressions: Array.from({ length: 8 }, (_, i) => ({ Name: `e${i}` })),
    },
  } as CubismModelFile

  const runtime = buildRuntimePetModelDefinition(mao, modelFile)

  // The positional rebuild used to overwrite the whole map with only the 9
  // positional slots, silently dropping surprised/confused/embarrassed even
  // when authored. They must survive the rebuild.
  assert.equal(runtime.expressionMap.surprised, 'exp_08')
  assert.equal(runtime.expressionMap.confused, 'exp_03')
  assert.equal(runtime.expressionMap.embarrassed, 'exp_07')
  // Standard positional slots still resolve (authored fallback wins).
  assert.ok(runtime.expressionMap.idle)
  assert.ok(runtime.expressionMap.happy)
})

test('buildPetActionMapReport exposes Live2D expression and gesture coverage', () => {
  const mao = getPetModelPreset('mao')
  const report = buildPetActionMapReport(mao)

  assert.equal(report.schema, 'nexus.pet-action-map.v1')
  assert.equal(report.model.kind, 'live2d')
  assert.equal(report.summary.expressionSlots, 12)
  assert.equal(report.summary.mappedExpressions, 12)
  assert.equal(report.summary.publicGestures, 5)
  assert.equal(report.summary.mappedGestures, 5)
  assert.equal(report.summary.lifecycleMotions, 5)
  assert.equal(report.summary.mappedLifecycleMotions, 5)
  assert.equal(report.summary.presenceStates, 7)
  assert.equal(report.summary.mappedPresenceStates, 7)
  assert.equal(report.summary.idleFidgets, 6)
  assert.equal(report.summary.missing, 0)
  assert.deepEqual(report.presenceStates.map((entry) => [
    entry.state,
    entry.expressionSlot,
    entry.motionTarget.kind,
    entry.motionTarget.kind === 'gesture' ? entry.motionTarget.gesture : entry.motionTarget.slot,
    entry.status,
  ]), [
    ['standby', 'idle', 'lifecycle', 'idle', 'mapped'],
    ['focus', 'thinking', 'lifecycle', 'idle', 'mapped'],
    ['speaking', 'speaking', 'lifecycle', 'speakingStart', 'mapped'],
    ['reunion', 'happy', 'gesture', 'wave', 'mapped'],
    ['worried', 'confused', 'lifecycle', 'listeningStart', 'mapped'],
    ['celebration', 'happy', 'gesture', 'wave', 'mapped'],
    ['quiet_companion', 'sleepy', 'lifecycle', 'idle', 'mapped'],
  ])
  assert.deepEqual(report.gestures.map((entry) => [entry.gesture, entry.motionGroup, entry.status]), [
    ['wave', 'TapBody', 'mapped'],
    ['nod', 'TapBody', 'mapped'],
    ['shake', 'TapBody', 'mapped'],
    ['tilt', 'Idle', 'mapped'],
    ['point', 'TapBody', 'mapped'],
  ])
  assert.equal(report.idleFidgets.find((entry) => entry.id === 'stretch')?.expression, 'exp_04')
})

test('buildPetActionMapReport treats sprite avatars as runtime-mapped instead of missing Live2D', () => {
  const codex = getPetModelPreset('codex')
  const report = buildPetActionMapReport(codex)

  assert.equal(report.model.kind, 'sprite')
  assert.equal(report.summary.expressionSlots, 12)
  assert.equal(report.summary.presenceStates, 7)
  assert.equal(report.summary.missing, 0)
  assert.equal(report.expressions.every((entry) => entry.status === 'sprite'), true)
  assert.equal(report.gestures.every((entry) => entry.status === 'sprite'), true)
  assert.equal(report.presenceStates.every((entry) => entry.status === 'sprite'), true)
})

test('buildPublicPetActionMapEvidenceReport omits concrete motion and expression targets', () => {
  const mao = getPetModelPreset('mao')
  const report = buildPublicPetActionMapEvidenceReport(mao, '2026-06-16T17:00:00Z')
  const json = JSON.stringify(report)

  assert.equal(report.gate, 'live2d-action-map-coverage')
  assert.equal(report.generatedAt, '2026-06-16T17:00:00.000Z')
  assert.equal(report.ok, true)
  assert.equal(report.summary.coverage, 1)
  assert.equal(report.statusCounts.mapped > 0, true)
  assert.equal(report.statusCounts.missing, 0)
  assert.deepEqual(report.missingSlots.expressions, [])
  assert.deepEqual(report.missingSlots.presenceStates, [])
  assert.equal(report.checks.find((check) => check.id === 'presence-states-covered')?.pass, true)
  assert.equal(json.includes('exp_01'), false)
  assert.equal(json.includes('TapBody'), false)
  assert.equal(json.includes('Idle'), false)
  assert.equal(json.includes('眨眼'), false)
})

test('buildPublicPetActionMapEvidenceReport reports missing override targets without target names', () => {
  const mao = getPetModelPreset('mao')
  const customized = applyPetActionMapOverride(mao, {
    expressions: {
      happy: '',
    },
    gestures: {
      wave: '',
    },
    lifecycleMotions: {
      speakingStart: '',
    },
  })
  const report = buildPublicPetActionMapEvidenceReport(customized, '2026-06-16T17:00:00Z')
  const checks = new Map(report.checks.map((check) => [check.id, check.pass]))
  const json = JSON.stringify(report)

  assert.equal(report.ok, false)
  assert.deepEqual(report.missingSlots.expressions, ['happy'])
  assert.deepEqual(report.missingSlots.gestures, ['wave'])
  assert.deepEqual(report.missingSlots.lifecycleMotions, ['speakingStart'])
  assert.deepEqual(report.missingSlots.presenceStates, ['speaking', 'reunion', 'celebration'])
  assert.equal(checks.get('expressions-covered'), false)
  assert.equal(checks.get('gestures-covered'), false)
  assert.equal(checks.get('lifecycle-covered'), false)
  assert.equal(checks.get('presence-states-covered'), false)
  assert.equal(checks.get('no-missing-live2d-targets'), false)
  assert.equal(json.includes('exp_06'), false)
  assert.equal(json.includes('TapBody'), false)
})

test('buildPetActionMapDraft exports editable defaults and overrides', () => {
  const mao = getPetModelPreset('mao')
  const draft = buildPetActionMapDraft(mao, {
    expressions: {
      happy: 'exp_custom_happy',
    },
    gestures: {
      wave: 'Wave',
    },
    lifecycleMotions: {
      speakingStart: 'Talk',
    },
  })

  assert.equal(draft.schema, 'nexus.pet-action-map-draft.v1')
  assert.equal(draft.model.id, 'mao')
  assert.equal(draft.model.kind, 'live2d')
  assert.equal(draft.expressions.idle, 'exp_01')
  assert.equal(draft.expressions.happy, 'exp_custom_happy')
  assert.equal(draft.gestures.wave, 'Wave')
  assert.equal(draft.gestures.nod, 'TapBody')
  assert.equal(draft.lifecycleMotions.idle, 'Idle')
  assert.equal(draft.lifecycleMotions.speakingStart, 'Talk')
  assert.ok(draft.note.includes('settings override'))
  assert.ok(draft.note.includes('settings draft'))
})

test('applyPetActionMapOverride rewires expression, gesture, and lifecycle targets', () => {
  const mao = getPetModelPreset('mao')
  const customized = applyPetActionMapOverride(mao, {
    expressions: {
      happy: 'exp_custom_happy',
      surprised: '',
    },
    gestures: {
      wave: 'Wave',
      point: '',
    },
    lifecycleMotions: {
      speakingStart: 'Talk',
      hit: '',
    },
  })

  assert.equal(customized.expressionMap.happy, 'exp_custom_happy')
  assert.equal(customized.expressionMap.surprised, undefined)
  assert.equal(customized.motionGroups.gestures?.wave, 'Wave')
  assert.equal(customized.motionGroups.gestures?.point, undefined)
  assert.equal(customized.motionGroups.speakingStart, 'Talk')
  assert.equal(customized.motionGroups.hit, undefined)
  assert.equal(mao.expressionMap.happy, 'exp_06')
  assert.equal(mao.motionGroups.gestures?.wave, 'TapBody')
})

test('normalizePetActionMapDraftPatch keeps known empty overrides and drops unknown slots', () => {
  const patch = normalizePetActionMapDraftPatch({
    expressions: {
      happy: '  exp_custom  ',
      unknown: 'drop-me',
      surprised: '',
    },
    gestures: {
      wave: '  Wave  ',
      dance: 'drop-me',
    },
    lifecycleMotions: {
      speakingStart: 'Talk',
      badSlot: 'drop-me',
    },
  })

  assert.deepEqual(patch, {
    expressions: {
      happy: 'exp_custom',
      surprised: '',
    },
    gestures: {
      wave: 'Wave',
    },
    lifecycleMotions: {
      speakingStart: 'Talk',
    },
  })
})

test('live2d action map report args support model, patch and output aliases', () => {
  assert.deepEqual(parseLive2dActionMapReportArgs([
    '--model',
    'mao',
    '--patch-file=action-map.patch.json',
    '--generated-at',
    '2026-06-16T17:00:00Z',
    '--output',
    'artifacts/v0.3.4/live2d-action-map.json',
    '--require-ready',
  ]), {
    modelId: 'mao',
    patchFile: 'action-map.patch.json',
    generatedAt: '2026-06-16T17:00:00Z',
    outputPath: 'artifacts/v0.3.4/live2d-action-map.json',
    requireReady: true,
    list: false,
    help: false,
  })
})

test('live2d action map report CLI can persist private-safe evidence', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-live2d-map-'))
  const outputPath = path.join(outputRoot, 'artifacts', 'v0.3.4', 'live2d-action-map.json')
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      'scripts/live2d-action-map-report.mjs',
      '--model',
      'mao',
      '--generated-at',
      '2026-06-16T17:00:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.summary.coverage, 1)
    assert.equal(json.includes('exp_01'), false)
    assert.equal(json.includes('TapBody'), false)
    assert.equal(json.includes(outputRoot), false)
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('live2d action map report CLI fails readiness when a patch clears mappings', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-live2d-map-bad-'))
  const inputPath = path.join(outputRoot, 'action-map.patch.json')
  try {
    await writeFile(inputPath, JSON.stringify({
      expressions: { happy: '' },
      gestures: { wave: '' },
      lifecycleMotions: { speakingStart: '' },
    }), 'utf8')

    await assert.rejects(
      execFileAsync(process.execPath, [
        '--experimental-strip-types',
        'scripts/live2d-action-map-report.mjs',
        '--model',
        'mao',
        '--patch-file',
        inputPath,
        '--require-ready',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const err = error as { code?: number; stdout?: string }
        assert.equal(err.code, 1)
        const report = JSON.parse(err.stdout ?? '{}')
        assert.equal(report.ok, false)
        assert.deepEqual(report.missingSlots.expressions, ['happy'])
        assert.deepEqual(report.missingSlots.gestures, ['wave'])
        assert.deepEqual(report.missingSlots.lifecycleMotions, ['speakingStart'])
        assert.deepEqual(report.missingSlots.presenceStates, ['speaking', 'reunion', 'celebration'])
        return true
      },
    )
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('live2d action map report wiring stays available in packaged builds', async () => {
  const pkg = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'))

  assert.equal(
    pkg.scripts?.['live2d:action-map:report'],
    'node --experimental-strip-types scripts/live2d-action-map-report.mjs',
  )
  assert.ok(pkg.build?.files?.includes('scripts/live2d-action-map-report.mjs'))
  assert.ok(pkg.build?.asarUnpack?.includes('scripts/live2d-action-map-report.mjs'))
})
