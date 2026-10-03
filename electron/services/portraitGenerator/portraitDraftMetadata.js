/**
 * Optional, private draft diagnostics, not a rig or an animation contract.
 * Retain the geometry actually used by the two decode stages without inventing
 * anchors, filling missing scores, or changing generation's acceptance gates.
 * Catalog pins describe expectations; injected engines and worker results do
 * not currently attest the identity of the bytes loaded for this particular job.
 */
import { PORTRAIT_MODEL_CATALOG } from '../../../shared/portraitModels.js'

function rasterSize(value) {
  return Number.isInteger(value?.width) && value.width > 0 && Number.isInteger(value?.height) && value.height > 0
    ? { width: value.width, height: value.height } : null
}

function pointSet(value) {
  if (!Array.isArray(value) || value.length !== 28) return null
  const points = Array.from(value)
  if (!points.every((point) => Array.isArray(point) && [point[0], point[1], point[2]].every(Number.isFinite))) return null
  return points.map(([x, y, confidence]) => [x, y, confidence])
}

function outsideIndices(points, size) {
  return points.flatMap(([x, y], index) => x < 0 || y < 0 || x >= size.width || y >= size.height ? [index] : [])
}

/** Build bounded metadata from stage-owned dimensions and points, never paths or engine extras. */
export function buildPortraitDraftMetadata(stage, split) {
  const landmarkSource = rasterSize(stage.geometry?.source)
  const analysis = rasterSize(stage.geometry?.analysis)
  const layerSource = rasterSize(split.geometry?.source)
  const work = rasterSize(split)
  const sourcePoints = pointSet(stage.keypoints)
  const workPoints = pointSet(split.geometry?.workPoints)
  const scale = split.geometry?.sourceToWork
  const sourceToWork = Number.isFinite(scale?.x) && scale.x > 0 && Number.isFinite(scale?.y) && scale.y > 0
    ? { x: scale.x, y: scale.y } : null
  const geometryRecorded = Boolean(landmarkSource && analysis && layerSource && work && sourceToWork && sourcePoints && workPoints)
  const alphaSource = ['image', 'isnet'].includes(split.alphaSource) ? split.alphaSource : 'unknown'
  const usesImageAlpha = alphaSource === 'image'
  return {
    version: 1,
    coordinates: {
      units: 'pixels', origin: 'top_left', xAxis: 'right', yAxis: 'down', exifOrientation: 'applied',
      landmarkSource, analysis, layerSource, work, sourceToWork,
      sourceSizeMismatch: landmarkSource && layerSource
        ? landmarkSource.width !== layerSource.width || landmarkSource.height !== layerSource.height : null,
    },
    landmarks: {
      topology: 'anime_face_28', confidenceSemantics: 'engine_score_not_calibrated',
      // Recorded means finite and serializable, not accurate or safe to rig.
      ...(geometryRecorded ? {
        status: 'recorded', sourcePoints, workPoints,
        outsideSourceIndices: outsideIndices(sourcePoints, landmarkSource),
        outsideWorkIndices: outsideIndices(workPoints, work),
      } : { status: 'unavailable', reason: 'invalid_or_missing_geometry' }),
    },
    provenance: {
      imageReads: 'per_stage', sourceBytesVerifiedAcrossStages: false,
      landmarkSource: 'engine_keypoints', alphaSource,
      cutout: usesImageAlpha ? 'not_used' : alphaSource === 'isnet' ? 'engine_alpha' : 'unknown',
      runtimeModelIdentity: 'not_recorded',
      expectedModels: PORTRAIT_MODEL_CATALOG.filter((model) => model.role !== 'cutout' || !usesImageAlpha)
        .map(({ id, role, sizeBytes, sha256, source }) => ({ id, role, sizeBytes, sha256, sourceRevision: source.revision })),
      normalizedRetry: typeof stage.metrics?.normalizedRetry === 'boolean' ? stage.metrics.normalizedRetry : null,
    },
    capabilities: {
      motionReady: false, layerSemantics: 'coarse_partition',
      // These known omissions are not an exhaustive v4 validation report.
      knownMissingLayerGroups: ['eyes', 'mouth', 'neck'],
      anchors: { neck: 'unknown', shoulders: 'unknown', waist: 'unknown', hairRoots: 'unknown' },
      hiddenRegions: 'not_generated',
    },
  }
}
