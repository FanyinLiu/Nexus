/**
 * Frozen local fixtures for portrait verdict regression, not a visual-quality gate.
 * Every fixture is validated and snapshotted before inference starts. Human labels
 * stay in this harness and never enter the production gate or its model inputs.
 * Reports contain only fixture IDs, hashes, stable verdicts and catalog model pins.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { PORTRAIT_CUTOUT_GATE_REASONS } from '../../shared/portraitCutoutGate.js'
import { PORTRAIT_IMAGE_GATE_REASONS } from '../../shared/portraitImageGate.js'
import { PORTRAIT_LANDMARK_GATE_REASONS } from '../../shared/portraitLandmarkGate.js'
import { PORTRAIT_MODEL_CATALOG, PORTRAIT_MODEL_RELEASE } from '../../shared/portraitModels.js'
import { computeBuildInputFingerprint, isBuildFingerprintStable, isValidBuildInputFingerprint } from '../build-fingerprint.mjs'

const SAMPLE_COUNT = 20
const SAMPLE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const SHA256 = /^[a-f0-9]{64}$/
const SHARED_CONTRACT_PATHS = [
  'shared/portraitImageGate.js',
  'shared/portraitLandmarkGate.js',
  'shared/portraitCutoutGate.js',
  'shared/portraitModels.js',
  'shared/portraitPreview.js',
  'shared/portraitDraftExport.js',
]
const ALPHA_SOURCES = new Set(['image', 'isnet'])
const REASONS = new Set([
  ...Object.values(PORTRAIT_CUTOUT_GATE_REASONS),
  ...Object.values(PORTRAIT_IMAGE_GATE_REASONS),
  ...Object.values(PORTRAIT_LANDMARK_GATE_REASONS),
])
const UNAVAILABLE_REASONS = new Set([
  PORTRAIT_LANDMARK_GATE_REASONS.MODELS_UNAVAILABLE,
  PORTRAIT_CUTOUT_GATE_REASONS.MODELS_UNAVAILABLE,
])

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function initialReport() {
  return {
    schemaVersion: 1,
    scope: 'frozen-verdict-regression',
    status: 'not_run',
    reasonCode: 'manifest_not_provided',
    inference: 'none',
    pipelineVersion: null,
    modelVerification: 'not_run',
    visualQuality: 'not_assessed',
    manifestSha256: null,
    modelCatalog: {
      releaseTag: PORTRAIT_MODEL_RELEASE.tag,
      files: PORTRAIT_MODEL_CATALOG.map(({ id, sha256, sizeBytes, wired }) => ({ id, sha256, sizeBytes, wired })),
    },
    validation: { status: 'not_run', issues: [] },
    counts: { total: 0, passed: 0, failed: 0, notRun: 0 },
    samples: [],
  }
}

function stableVerdict(value, expected = false) {
  if (!value || typeof value.accepted !== 'boolean') return null
  if (value.accepted) {
    if (value.reasonCode !== null && (expected || value.reasonCode !== undefined)) return null
  } else if (!REASONS.has(value.reasonCode) || (expected && UNAVAILABLE_REASONS.has(value.reasonCode))) {
    return null
  }
  if (value.alphaSource !== undefined && value.alphaSource !== null && !ALPHA_SOURCES.has(value.alphaSource)) return null
  return { accepted: value.accepted, reasonCode: value.reasonCode ?? null, alphaSource: value.alphaSource ?? null }
}

function validateManifest(manifest) {
  const issues = []
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.samples)) return [{ code: 'manifest_schema_invalid' }]
  if (manifest.samples.length !== SAMPLE_COUNT) issues.push({ code: 'sample_count_invalid' })
  const ids = new Set()
  const hashes = new Set()
  let darkSkinAccepted = 0
  for (const sample of manifest.samples) {
    const id = typeof sample?.id === 'string' && SAMPLE_ID.test(sample.id) ? sample.id : null
    const add = (code) => issues.push(id ? { code, sampleId: id } : { code })
    if (!id || ids.has(id)) add('sample_id_invalid')
    ids.add(id)
    if (typeof sample?.file !== 'string' || !sample.file.trim() || sample.file.includes('\0') || /^[a-z]+:\/\//i.test(sample.file)) add('sample_file_invalid')
    if (typeof sample?.sha256 !== 'string' || !SHA256.test(sample.sha256) || hashes.has(sample.sha256)) add('sample_hash_invalid')
    hashes.add(sample?.sha256)
    const expected = stableVerdict(sample?.expected, true)
    if (!expected) add('sample_expectation_invalid')
    if (sample?.tags !== undefined && (!Array.isArray(sample.tags) || sample.tags.some((tag) => typeof tag !== 'string'))) add('sample_tags_invalid')
    if (expected?.accepted && Array.isArray(sample.tags) && sample.tags.includes('dark-skin')) darkSkinAccepted += 1
  }
  if (darkSkinAccepted < 2) issues.push({ code: 'accepted_dark_skin_samples_missing' })
  return issues
}

async function readFrozenSamples(manifest, manifestDirectory, report) {
  const frozen = []
  for (const sample of manifest.samples) {
    const item = { id: sample.id, sha256: sample.sha256, expected: stableVerdict(sample.expected, true), actual: null, status: 'not_run' }
    report.samples.push(item)
    try {
      const bytes = await fs.readFile(path.resolve(manifestDirectory, sample.file))
      if (sha256(bytes) !== sample.sha256) report.validation.issues.push({ code: 'sample_hash_mismatch', sampleId: sample.id })
      else frozen.push(bytes)
    } catch {
      report.validation.issues.push({ code: 'sample_unreadable', sampleId: sample.id })
    }
  }
  return frozen
}

async function createLocalPipeline(modelsDirectory) {
  // Imports and workers are deliberately deferred until the entire frozen set is valid.
  const [{ createWorkerLandmarkEngine }, { createWorkerCutoutEngine }, { generatePortraitDraftFromPayload }] = await Promise.all([
    import('../../electron/services/portraitGenerator/landmarkRuntime.js'),
    import('../../electron/services/portraitGenerator/cutoutRuntime.js'),
    import('../../electron/services/portraitGenerator/portraitDraft.js'),
  ])
  const landmarkEngine = createWorkerLandmarkEngine({ directory: modelsDirectory })
  const cutoutEngine = createWorkerCutoutEngine({ directory: modelsDirectory })
  const readiness = await Promise.all([landmarkEngine.prepare(), cutoutEngine.prepare()])
  if (readiness.some((result) => result.status !== 'ready')) return null
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-portrait-acceptance-'))
  let index = 0
  return {
    async evaluate(bytes) {
      // Evaluate the locked bytes, not a source file that can change during a long run.
      const imagePath = path.join(directory, `sample-${index++}.image`)
      await fs.writeFile(imagePath, bytes, { flag: 'wx', mode: 0o600 })
      return generatePortraitDraftFromPayload({ imagePath }, {
        pickImagePath: async () => null,
        getEngine: () => landmarkEngine,
        getCutoutEngine: () => cutoutEngine,
        draftRoot: path.join(directory, 'drafts'),
      })
    },
    dispose: () => fs.rm(directory, { recursive: true, force: true }),
  }
}

async function readCurrentPipelineFingerprint() {
  const build = computeBuildInputFingerprint()
  // The existing build fingerprint intentionally does not cover shared contracts.
  const sharedContracts = Object.fromEntries(await Promise.all(SHARED_CONTRACT_PATHS.map(async (modulePath) => [
    modulePath, sha256(await fs.readFile(new URL(`../../${modulePath}`, import.meta.url))),
  ])))
  return { ...build, sharedContracts }
}

async function capturePipelineFingerprint(readFingerprint) {
  try {
    const value = await readFingerprint()
    if (!isValidBuildInputFingerprint(value)
      || SHARED_CONTRACT_PATHS.some((modulePath) => typeof value.sharedContracts?.[modulePath] !== 'string' || !SHA256.test(value.sharedContracts[modulePath]))) return null
    const { schemaVersion, algorithm, digest, fileCount } = value
    return { schemaVersion, algorithm, digest, fileCount,
      sharedContracts: Object.fromEntries(SHARED_CONTRACT_PATHS.map((modulePath) => [modulePath, value.sharedContracts[modulePath]])) }
  } catch {
    return null
  }
}

/**
 * Validate an explicitly supplied frozen manifest, then optionally execute it.
 * `evaluate` is a test seam; its results are marked injected, never real inference.
 * It receives only snapshotted image bytes, without labels, IDs or expectations.
 * Missing fixtures, runtime failures and validation-only runs remain `not_run`.
 * @param {{ manifestPath?: string, execute?: boolean, modelsDirectory?: string,
 *   evaluate?: (bytes: Buffer) => Promise<object> | object,
 *   readPipelineFingerprint?: () => object | Promise<object> }} [options]
 */
export async function runPortraitAcceptance(options = {}) {
  const report = initialReport()
  if (!options.manifestPath) return report
  let manifest
  try {
    const bytes = await fs.readFile(options.manifestPath)
    report.manifestSha256 = sha256(bytes)
    manifest = JSON.parse(bytes.toString('utf8'))
  } catch {
    report.reasonCode = 'manifest_unreadable'
    return report
  }
  report.validation.issues = validateManifest(manifest)
  if (report.validation.issues.length) {
    report.validation.status = 'failed'
    report.reasonCode = 'manifest_invalid'
    return report
  }
  report.counts.total = manifest.samples.length
  report.counts.notRun = manifest.samples.length
  const frozen = await readFrozenSamples(manifest, path.dirname(path.resolve(options.manifestPath)), report)
  if (report.validation.issues.length) {
    report.validation.status = 'failed'
    report.reasonCode = 'samples_invalid'
    return report
  }
  report.validation.status = 'passed'
  const injected = typeof options.evaluate === 'function'
  if (!injected && !options.execute) {
    report.reasonCode = 'execute_not_requested'
    return report
  }
  if (!injected && (typeof options.modelsDirectory !== 'string' || !options.modelsDirectory.trim())) {
    report.reasonCode = 'models_directory_required'
    return report
  }
  // Unit fixtures do not scan the checkout; an explicit reader exercises drift handling.
  const readFingerprint = options.readPipelineFingerprint ?? (injected ? null : readCurrentPipelineFingerprint)
  report.pipelineVersion = { kind: injected ? 'injected' : 'build-input-and-portrait-contracts', before: null, after: null, stable: null }
  if (readFingerprint) {
    report.pipelineVersion.before = await capturePipelineFingerprint(readFingerprint)
    if (!report.pipelineVersion.before) {
      report.reasonCode = 'pipeline_fingerprint_unavailable'
      return report
    }
  }
  let runner
  if (injected) {
    runner = { evaluate: options.evaluate, dispose: async () => {} }
    report.inference = 'injected'
  } else {
    try {
      runner = await createLocalPipeline(path.resolve(options.modelsDirectory))
      if (!runner) {
        report.reasonCode = 'model_runtime_unavailable'
        return report
      }
      report.inference = 'local_models'
      report.modelVerification = 'passed'
    } catch {
      report.reasonCode = 'pipeline_unavailable'
      return report
    }
  }
  try {
    for (let index = 0; index < frozen.length; index += 1) {
      const sample = report.samples[index]
      try {
        const actual = stableVerdict(await runner.evaluate(frozen[index]))
        if (!actual) sample.errorCode = 'pipeline_result_invalid'
        else {
          sample.actual = actual
          if (UNAVAILABLE_REASONS.has(actual.reasonCode)) sample.errorCode = 'model_runtime_unavailable'
          else {
            const expected = sample.expected
            sample.status = actual.accepted === expected.accepted && actual.reasonCode === expected.reasonCode
              && (expected.alphaSource === null || actual.alphaSource === expected.alphaSource) ? 'passed' : 'failed'
            report.counts.notRun -= 1
            report.counts[sample.status] += 1
          }
        }
      } catch {
        sample.errorCode = 'pipeline_failed'
      }
    }
  } finally {
    try { await runner.dispose() } catch { report.cleanup = 'failed' }
    if (readFingerprint) {
      report.pipelineVersion.after = await capturePipelineFingerprint(readFingerprint)
      report.pipelineVersion.stable = isBuildFingerprintStable(report.pipelineVersion.before, report.pipelineVersion.after)
        && SHARED_CONTRACT_PATHS.every((modulePath) => report.pipelineVersion.before.sharedContracts[modulePath] === report.pipelineVersion.after.sharedContracts[modulePath])
    }
  }
  report.status = report.counts.notRun ? 'not_run' : report.counts.failed ? 'failed' : 'passed'
  report.reasonCode = report.counts.notRun ? 'execution_incomplete' : report.counts.failed ? 'expectation_mismatch' : null
  if (report.cleanup === 'failed') {
    report.status = 'not_run'
    report.reasonCode = 'cleanup_failed'
  }
  if (readFingerprint && !report.pipelineVersion.stable) {
    report.status = 'not_run'
    report.reasonCode = report.pipelineVersion.after ? 'pipeline_source_changed' : 'pipeline_fingerprint_unavailable'
  }
  return report
}
