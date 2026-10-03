import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildPortraitDraftMetadata } from '../electron/services/portraitGenerator/portraitDraftMetadata.js'
import { PORTRAIT_MODEL_CATALOG } from '../shared/portraitModels.js'

type Geometry = Record<string, unknown>
type Stage = { keypoints?: unknown, geometry?: Geometry, metrics?: Record<string, unknown>, [key: string]: unknown }
type Split = { width?: unknown, height?: unknown, geometry?: Geometry, alphaSource?: unknown, [key: string]: unknown }

function inputs() {
  const sourcePoints = Array.from({ length: 28 }, (_, index) => [100 + index, 200 + index * 2, 0.7 + index / 100])
  sourcePoints[0] = [-0.25, 20, -0.3]
  sourcePoints[1] = [1000, 25, 1.4]
  sourcePoints[2] = [15, 2000, 0]
  sourcePoints[3] = [999.999, 1999.999, 0.2]
  sourcePoints[4] = [10, -0.01, 0.6]
  // Work points are independent observations, not regenerated from source points.
  const workPoints = Array.from({ length: 28 }, (_, index) => [40 + index, 80 + index, 0.91 - index / 100])
  workPoints[5] = [-0.2, 30, 1.2]
  workPoints[6] = [384, 40, -0.01]
  workPoints[7] = [100, 768, 0]
  workPoints[8] = [100, -1, 0.8]
  workPoints[9] = [383.99, 767.99, 1.4]
  const stage: Stage = {
    keypoints: sourcePoints,
    geometry: { source: { width: 1000, height: 2000 }, analysis: { width: 512, height: 1024 } },
    metrics: {},
  }
  const split: Split = {
    width: 384, height: 768, alphaSource: 'isnet',
    geometry: { source: { width: 1000, height: 2000 }, sourceToWork: { x: 0.384, y: 0.384 }, workPoints },
  }
  return { stage, split, sourcePoints, workPoints }
}

const roundTrip = (value: unknown) => JSON.parse(JSON.stringify(value))

function assertUnavailable(value: ReturnType<typeof buildPortraitDraftMetadata>) {
  const result = roundTrip(value)
  assert.deepEqual(result.landmarks, {
    topology: 'anime_face_28', confidenceSemantics: 'engine_score_not_calibrated',
    status: 'unavailable', reason: 'invalid_or_missing_geometry',
  }, 'incomplete geometry must not manufacture points, scores, or bounds checks')
  assert.equal(result.capabilities.motionReady, false)
}

test('metadata preserves all 28 observed points in both spaces, uncalibrated scores and outside indices', () => {
  const { stage, split, sourcePoints, workPoints } = inputs()
  const result = roundTrip(buildPortraitDraftMetadata(stage, split))
  assert.equal(result.version, 1)
  assert.deepEqual(result.coordinates, {
    units: 'pixels', origin: 'top_left', xAxis: 'right', yAxis: 'down', exifOrientation: 'applied',
    landmarkSource: { width: 1000, height: 2000 }, analysis: { width: 512, height: 1024 },
    layerSource: { width: 1000, height: 2000 }, work: { width: 384, height: 768 },
    sourceToWork: { x: 0.384, y: 0.384 }, sourceSizeMismatch: false,
  })
  assert.equal(result.landmarks.status, 'recorded')
  assert.equal(result.landmarks.topology, 'anime_face_28')
  assert.equal(result.landmarks.confidenceSemantics, 'engine_score_not_calibrated')
  assert.deepEqual(result.landmarks.sourcePoints, sourcePoints)
  assert.deepEqual(result.landmarks.workPoints, workPoints)
  assert.equal(result.landmarks.sourcePoints.length, 28)
  assert.equal(result.landmarks.workPoints.length, 28)
  assert.equal(result.landmarks.sourcePoints[0][2], -0.3)
  assert.equal(result.landmarks.sourcePoints[1][2], 1.4)
  assert.equal(result.landmarks.workPoints[6][2], -0.01)
  assert.deepEqual(result.landmarks.outsideSourceIndices, [0, 1, 2, 4])
  assert.deepEqual(result.landmarks.outsideWorkIndices, [5, 6, 7, 8])
})

const brokenPoints: Array<[string, (points: number[][]) => unknown]> = [
  ['missing confidence', points => { points[3] = points[3].slice(0, 2); return points }],
  ['NaN coordinate', points => { points[3][0] = NaN; return points }],
  ['infinite coordinate', points => { points[3][1] = Infinity; return points }],
  ['infinite confidence', points => { points[3][2] = -Infinity; return points }],
  ['short point array', points => points.slice(0, 27)],
  ['long point array', points => [...points, [1, 2, 3]]],
  ['sparse point array', points => { delete points[3]; return points }],
  ['sparse point tuple', points => { delete points[3][2]; return points }],
  ['missing point array', () => undefined],
  ['non-array point collection', () => ({ length: 28 })],
]

for (const [name, corrupt] of brokenPoints) {
  test(`metadata marks ${name} unavailable in either coordinate space without synthesizing the other`, () => {
    for (const space of ['source', 'work']) {
      const { stage, split, sourcePoints, workPoints } = inputs()
      if (space === 'source') stage.keypoints = corrupt(sourcePoints)
      else split.geometry!.workPoints = corrupt(workPoints)
      assertUnavailable(buildPortraitDraftMetadata(stage, split))
    }
  })
}

for (const [name, setSize, coordinateKey] of [
  ['landmark source', (stage: Stage, _split: Split, value: unknown) => { stage.geometry!.source = value }, 'landmarkSource'],
  ['analysis raster', (stage: Stage, _split: Split, value: unknown) => { stage.geometry!.analysis = value }, 'analysis'],
  ['layer source', (_stage: Stage, split: Split, value: unknown) => { split.geometry!.source = value }, 'layerSource'],
  ['work raster', (_stage: Stage, split: Split, value: unknown) => {
    split.width = (value as { width?: unknown } | null)?.width
    split.height = (value as { height?: unknown } | null)?.height
  }, 'work'],
] as const) {
  test(`metadata requires valid ${name} dimensions and records no invented size`, () => {
    for (const size of [undefined, null, {}, { width: 10 }, { width: 0, height: 10 }, { width: -1, height: 10 },
      { width: 1.5, height: 10 }, { width: NaN, height: 10 }, { width: 10, height: Infinity }, { width: '10', height: 10 }]) {
      const { stage, split } = inputs()
      setSize(stage, split, size)
      const result = buildPortraitDraftMetadata(stage, split)
      assertUnavailable(result)
      assert.equal(roundTrip(result).coordinates[coordinateKey], null)
    }
  })
}

test('missing geometry groups or invalid source-to-work scale stay unavailable', () => {
  for (const missing of ['stage', 'split']) {
    const { stage, split } = inputs()
    if (missing === 'stage') delete stage.geometry
    else delete split.geometry
    assertUnavailable(buildPortraitDraftMetadata(stage, split))
  }
  for (const scale of [undefined, null, {}, { x: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 },
    { x: NaN, y: 1 }, { x: 1, y: Infinity }, { x: '0.5', y: 0.5 }]) {
    const { stage, split } = inputs()
    split.geometry!.sourceToWork = scale
    const result = buildPortraitDraftMetadata(stage, split)
    assertUnavailable(result)
    assert.equal(roundTrip(result).coordinates.sourceToWork, null)
  }
})

test('source size mismatch and unusual finite scale retain both observations without correcting coordinates', () => {
  const { stage, split, sourcePoints, workPoints } = inputs()
  split.geometry!.source = { width: 1201, height: 1400 }
  split.geometry!.sourceToWork = { x: 0.1234567890123456, y: 1.234567890123456 }
  const result = roundTrip(buildPortraitDraftMetadata(stage, split))
  assert.equal(result.coordinates.sourceSizeMismatch, true)
  assert.deepEqual(result.coordinates.landmarkSource, { width: 1000, height: 2000 })
  assert.deepEqual(result.coordinates.layerSource, { width: 1201, height: 1400 })
  assert.deepEqual(result.coordinates.sourceToWork, split.geometry!.sourceToWork)
  assert.deepEqual(result.landmarks.sourcePoints, sourcePoints)
  assert.deepEqual(result.landmarks.workPoints, workPoints)
  assert.equal(result.landmarks.status, 'recorded', 'a recorded mismatch is not proof that either observation was corrected')
  delete stage.geometry!.source
  assert.equal(roundTrip(buildPortraitDraftMetadata(stage, split)).coordinates.sourceSizeMismatch, null)
})

test('missing runtime evidence retains expected catalog pins without claiming model identity verification', () => {
  const result = roundTrip(buildPortraitDraftMetadata({}, { alphaSource: 'isnet' }))
  assertUnavailable(result)
  assert.equal(result.provenance.runtimeModelIdentity, 'not_recorded')
  assert.equal(result.provenance.imageReads, 'per_stage')
  assert.equal(result.provenance.sourceBytesVerifiedAcrossStages, false)
  assert.equal(result.provenance.landmarkSource, 'engine_keypoints')
  assert.equal(result.provenance.cutout, 'engine_alpha')
  assert.deepEqual(result.provenance.expectedModels.map((model: { role: string }) => model.role), ['detector', 'landmarks', 'cutout'])
  for (const model of result.provenance.expectedModels) {
    const expected = PORTRAIT_MODEL_CATALOG.find(entry => entry.id === model.id)!
    assert.deepEqual(model, {
      id: expected.id, role: expected.role, sizeBytes: expected.sizeBytes,
      sha256: expected.sha256, sourceRevision: expected.source.revision,
    })
  }
})

test('native alpha excludes the cutout model and records that cutout inference was not used', () => {
  const { stage, split } = inputs()
  split.alphaSource = 'image'
  const result = roundTrip(buildPortraitDraftMetadata(stage, split))
  assert.equal(result.provenance.alphaSource, 'image')
  assert.equal(result.provenance.cutout, 'not_used')
  assert.deepEqual(result.provenance.expectedModels.map((model: { role: string }) => model.role), ['detector', 'landmarks'])
  assert.equal(result.provenance.runtimeModelIdentity, 'not_recorded')
})

test('unrecognized alpha sources remain unknown and cannot leak private strings or objects', () => {
  const secret = 'private-alpha-source-path-sentinel'
  for (const alphaSource of [undefined, null, '', secret, { path: secret, engine: 'isnet' }, ['image', secret]]) {
    const { stage, split } = inputs()
    split.alphaSource = alphaSource
    const serialized = JSON.stringify(buildPortraitDraftMetadata(stage, split))
    assert.equal(serialized.includes(secret), false)
    const result = JSON.parse(serialized)
    assert.equal(result.provenance.alphaSource, 'unknown')
    assert.equal(result.provenance.cutout, 'unknown')
    assert.equal(result.provenance.runtimeModelIdentity, 'not_recorded')
    assert.equal(result.landmarks.status, 'recorded', 'unknown alpha provenance does not erase independently recorded geometry')
  }
})

test('normalized retry distinguishes missing or invalid evidence from true and false', () => {
  for (const [value, expected] of [[undefined, null], [null, null], ['true', null], [0, null], [true, true], [false, false]]) {
    const { stage, split } = inputs()
    stage.metrics = { normalizedRetry: value }
    assert.equal(roundTrip(buildPortraitDraftMetadata(stage, split)).provenance.normalizedRetry, expected)
  }
  const { stage, split } = inputs()
  delete stage.metrics
  assert.equal(roundTrip(buildPortraitDraftMetadata(stage, split)).provenance.normalizedRetry, null)
})

test('private stage extras and fourth point items never enter serialized metadata', () => {
  const { stage, split, sourcePoints, workPoints } = inputs()
  const secret = 'private-path-and-credential-sentinel'
  stage.inputPath = secret
  stage.runtimeModelIdentity = { verified: true, path: secret }
  stage.geometry!.privateBytes = secret
  stage.geometry!.source = { width: 1000, height: 2000, imagePath: secret }
  stage.metrics = { normalizedRetry: true, originalPrompt: secret }
  split.privateOutputPath = secret
  split.geometry!.sourceToWork = { x: 0.384, y: 0.384, enginePath: secret }
  stage.keypoints = sourcePoints.map(point => [...point, { privatePath: secret }])
  split.geometry!.workPoints = workPoints.map(point => [...point, secret])
  const serialized = JSON.stringify(buildPortraitDraftMetadata(stage, split))
  assert.equal(serialized.includes(secret), false, 'only bounded stage-owned facts may be serialized')
  const result = JSON.parse(serialized)
  assert.deepEqual(result.landmarks.sourcePoints, sourcePoints)
  assert.deepEqual(result.landmarks.workPoints, workPoints)
  assert.deepEqual(result.coordinates.landmarkSource, { width: 1000, height: 2000 })
  assert.deepEqual(result.coordinates.sourceToWork, { x: 0.384, y: 0.384 })
  assert.equal(result.provenance.runtimeModelIdentity, 'not_recorded')
})

test('returned points, dimensions, scales, catalog entries and capability lists do not alias inputs or later calls', () => {
  const { stage, split, sourcePoints, workPoints } = inputs()
  const result = buildPortraitDraftMetadata(stage, split)
  const snapshot = roundTrip(result)
  sourcePoints[0][0] = 123
  workPoints[0][1] = 456
  ;(stage.geometry!.source as { width: number }).width = 777
  ;(split.geometry!.sourceToWork as { x: number }).x = 2
  assert.deepEqual(roundTrip(result), snapshot)
  result.landmarks.sourcePoints![0][0] = 999
  result.landmarks.workPoints![0][1] = 888
  assert.equal(sourcePoints[0][0], 123)
  assert.equal(workPoints[0][1], 456)
  result.provenance.expectedModels[0].sha256 = 'mutated-output-only'
  result.capabilities.knownMissingLayerGroups.push('mutated-output-only')
  const fresh = inputs()
  const later = roundTrip(buildPortraitDraftMetadata(fresh.stage, fresh.split))
  assert.deepEqual(later.provenance.expectedModels, snapshot.provenance.expectedModels)
  assert.deepEqual(later.capabilities, snapshot.capabilities)
})

test('recorded landmarks remain a coarse partition with unknown anchors and no motion-ready claim', () => {
  const { stage, split } = inputs()
  stage.anchors = { neck: [1, 2], shoulders: [3, 4] }
  split.motionReady = true
  const result = roundTrip(buildPortraitDraftMetadata(stage, split))
  assert.equal(result.landmarks.status, 'recorded')
  assert.deepEqual(result.capabilities, {
    motionReady: false, layerSemantics: 'coarse_partition', knownMissingLayerGroups: ['eyes', 'mouth', 'neck'],
    anchors: { neck: 'unknown', shoulders: 'unknown', waist: 'unknown', hairRoots: 'unknown' },
    hiddenRegions: 'not_generated',
  })
})
