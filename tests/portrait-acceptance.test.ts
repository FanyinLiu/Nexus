import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test, type TestContext } from 'node:test'

import { runPortraitAcceptance } from '../scripts/lib/portrait-acceptance.mjs'
import { PORTRAIT_MODEL_CATALOG, PORTRAIT_MODEL_RELEASE } from '../shared/portraitModels.js'

type Verdict = { accepted: boolean, reasonCode: string | null, alphaSource?: string }
type Sample = { id: string, file: string, sha256: string, expected: Verdict, tags: string[] }

async function fixture(t: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-acceptance-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const samples: Sample[] = []
  for (let index = 0; index < 20; index += 1) {
    // These bytes exercise orchestration only; they are not acceptance images.
    const bytes = Buffer.from(`synthetic fixture ${index}`)
    const file = `sample-${index}.png`
    await fs.writeFile(path.join(directory, file), bytes)
    samples.push({
      id: `sample-${index}`,
      file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      expected: index < 15 ? { accepted: true, reasonCode: null, alphaSource: 'isnet' } : { accepted: false, reasonCode: 'too_blurry' },
      tags: index < 2 ? ['dark-skin'] : [],
    })
  }
  const manifest = { schemaVersion: 1, samples }
  const manifestPath = path.join(directory, 'frozen.json')
  const save = () => fs.writeFile(manifestPath, JSON.stringify(manifest))
  await save()
  return { directory, manifestPath, manifest, save }
}

function matchingVerdict(bytes: Buffer): Verdict {
  const index = Number(bytes.toString().split(' ').at(-1))
  return index < 15 ? { accepted: true, reasonCode: null, alphaSource: 'isnet' } : { accepted: false, reasonCode: 'too_blurry' }
}

const fingerprint = (digest = 'a'.repeat(64)) => ({ schemaVersion: 1, algorithm: 'sha256', digest, fileCount: 1, inputPaths: ['/private/source-path'],
  sharedContracts: {
    'shared/portraitImageGate.js': 'c'.repeat(64),
    'shared/portraitLandmarkGate.js': 'd'.repeat(64),
    'shared/portraitCutoutGate.js': 'e'.repeat(64),
    'shared/portraitModels.js': 'f'.repeat(64),
    'shared/portraitPreview.js': '1'.repeat(64),
    'shared/portraitDraftExport.js': '3'.repeat(64),
  } })

test('missing manifest stays not_run and never calls an injected evaluator', async () => {
  let calls = 0
  const report = await runPortraitAcceptance({ evaluate: () => { calls += 1; return {} } })
  assert.equal(report.status, 'not_run')
  assert.equal(report.reasonCode, 'manifest_not_provided')
  assert.equal(report.inference, 'none')
  assert.equal(report.visualQuality, 'not_assessed')
  assert.equal(calls, 0)
})

test('a complete validated freeze without execution is not acceptance; model pins derive from the catalog', async (t) => {
  const { manifestPath } = await fixture(t)
  const report = await runPortraitAcceptance({ manifestPath })
  assert.equal(report.validation.status, 'passed')
  assert.equal(report.status, 'not_run')
  assert.equal(report.reasonCode, 'execute_not_requested')
  assert.deepEqual(report.counts, { total: 20, passed: 0, failed: 0, notRun: 20 })
  assert.equal(report.modelCatalog.releaseTag, PORTRAIT_MODEL_RELEASE.tag)
  assert.deepEqual(report.modelCatalog.files, PORTRAIT_MODEL_CATALOG.map(({ id, sha256, sizeBytes, wired }) => ({ id, sha256, sizeBytes, wired })))
  assert.equal(report.manifestSha256, createHash('sha256').update(await fs.readFile(manifestPath)).digest('hex'))
})

test('a frozen round must have exactly 20 entries before any image is evaluated', async (t) => {
  const data = await fixture(t)
  let calls = 0
  const evaluate = () => { calls += 1; return {} }
  data.manifest.samples.pop()
  await data.save()
  const short = await runPortraitAcceptance({ manifestPath: data.manifestPath, evaluate })
  assert.equal(short.status, 'not_run')
  assert.ok(short.validation.issues.some((issue: { code: string }) => issue.code === 'sample_count_invalid'))
  data.manifest.samples.push(data.manifest.samples[0], data.manifest.samples[1])
  await data.save()
  const long = await runPortraitAcceptance({ manifestPath: data.manifestPath, evaluate })
  assert.ok(long.validation.issues.some((issue: { code: string }) => issue.code === 'sample_count_invalid'))
  assert.equal(calls, 0)
})

test('duplicate IDs and repeated image hashes cannot inflate the frozen round', async (t) => {
  const data = await fixture(t)
  data.manifest.samples[1].id = data.manifest.samples[0].id
  data.manifest.samples[1].sha256 = data.manifest.samples[0].sha256
  await data.save()
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath })
  assert.deepEqual(report.validation.issues.map((issue: { code: string }) => issue.code), ['sample_id_invalid', 'sample_hash_invalid'])
  assert.equal(report.status, 'not_run')
})

test('manifest expectations require an explicit accepted/null or rejected/stable reason pair', async (t) => {
  const data = await fixture(t)
  data.manifest.samples[2].expected = { accepted: true, reasonCode: 'too_blurry' }
  data.manifest.samples[3].expected = { accepted: false, reasonCode: null }
  data.manifest.samples[4].expected = { accepted: false, reasonCode: 'landmark_models_unavailable' }
  data.manifest.samples[5].expected = { accepted: false, reasonCode: '/private/secret.png' }
  await data.save()
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath })
  assert.equal(report.validation.issues.filter((issue: { code: string }) => issue.code === 'sample_expectation_invalid').length, 4)
  assert.ok(!JSON.stringify(report).includes('/private/secret.png'))
})

test('dark-skin labels count only for manually expected accepted fixtures', async (t) => {
  const data = await fixture(t)
  data.manifest.samples[1].tags = []
  data.manifest.samples[19].tags = ['dark-skin']
  await data.save()
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath })
  assert.equal(report.status, 'not_run')
  assert.ok(report.validation.issues.some((issue: { code: string }) => issue.code === 'accepted_dark_skin_samples_missing'))
})

test('a hash mismatch in the last file stops the whole round before the first inference', async (t) => {
  const data = await fixture(t)
  await fs.writeFile(path.join(data.directory, data.manifest.samples[19].file), 'changed')
  let calls = 0
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, evaluate: () => { calls += 1; return {} } })
  assert.equal(report.reasonCode, 'samples_invalid')
  assert.deepEqual(report.validation.issues, [{ code: 'sample_hash_mismatch', sampleId: 'sample-19' }])
  assert.equal(calls, 0)
  assert.equal(report.counts.notRun, 20)
})

test('missing local files block evaluation without disclosing their paths', async (t) => {
  const data = await fixture(t)
  data.manifest.samples[19].file = path.join(data.directory, 'private-customer-name.png')
  await data.save()
  let calls = 0
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, evaluate: () => { calls += 1; return {} } })
  assert.deepEqual(report.validation.issues, [{ code: 'sample_unreadable', sampleId: 'sample-19' }])
  assert.equal(calls, 0)
  assert.ok(!JSON.stringify(report).includes(data.directory))
  assert.ok(!JSON.stringify(report).includes('private-customer-name'))
})

test('injected matching verdicts report regression success separately from real inference and visual quality', async (t) => {
  const data = await fixture(t)
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, evaluate: matchingVerdict })
  assert.equal(report.status, 'passed')
  assert.equal(report.inference, 'injected')
  assert.deepEqual(report.pipelineVersion, { kind: 'injected', before: null, after: null, stable: null })
  assert.equal(report.modelVerification, 'not_run')
  assert.equal(report.visualQuality, 'not_assessed')
  assert.deepEqual(report.counts, { total: 20, passed: 20, failed: 0, notRun: 0 })
  assert.deepEqual(report.samples[0].actual, { accepted: true, reasonCode: null, alphaSource: 'isnet' })
  assert.deepEqual(report.samples[19].actual, { accepted: false, reasonCode: 'too_blurry', alphaSource: null })
})

test('acceptance, rejection reason and requested alpha source mismatches each fail the round', async (t) => {
  const data = await fixture(t)
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, evaluate: (bytes: Buffer) => {
    const index = Number(bytes.toString().split(' ').at(-1))
    if (index === 0) return { accepted: false, reasonCode: 'eyes_unclear' }
    if (index === 1) return { accepted: true, reasonCode: null, alphaSource: 'image' }
    if (index === 19) return { accepted: false, reasonCode: 'side_view' }
    return matchingVerdict(bytes)
  } })
  assert.equal(report.status, 'failed')
  assert.equal(report.reasonCode, 'expectation_mismatch')
  assert.deepEqual(report.counts, { total: 20, passed: 17, failed: 3, notRun: 0 })
})

test('exceptions and malformed pipeline data remain not_run and cannot leak paths, metadata or credentials', async (t) => {
  const data = await fixture(t)
  const secret = 'secret-token-or-image-metadata'
  let calls = 0
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, evaluate: (bytes: Buffer) => {
    calls += 1
    if (calls === 1) throw new Error(`${data.directory}/${secret}`)
    if (calls === 2) return { accepted: false, reasonCode: secret }
    return { ...matchingVerdict(bytes), metadata: secret, imagePath: data.directory, pixels: [99, 123] }
  } })
  assert.equal(report.status, 'not_run')
  assert.equal(report.reasonCode, 'execution_incomplete')
  assert.deepEqual(report.counts, { total: 20, passed: 18, failed: 0, notRun: 2 })
  assert.equal(report.samples[0].errorCode, 'pipeline_failed')
  assert.equal(report.samples[1].errorCode, 'pipeline_result_invalid')
  assert.ok(!JSON.stringify(report).includes(secret))
  assert.ok(!JSON.stringify(report).includes(data.directory))
  assert.ok(!JSON.stringify(report).includes('pixels'))
})

test('missing models are unavailable evidence, never a passing expected rejection', async (t) => {
  const data = await fixture(t)
  for (const reasonCode of ['landmark_models_unavailable', 'cutout_models_unavailable']) {
    const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, evaluate: () => ({ accepted: false, reasonCode }) })
    assert.equal(report.status, 'not_run')
    assert.deepEqual(report.counts, { total: 20, passed: 0, failed: 0, notRun: 20 })
    assert.equal(report.samples[0].actual?.reasonCode, reasonCode)
    assert.equal(report.samples[0].errorCode, 'model_runtime_unavailable')
  }
})

test('cutout mask rejection uses the production stable contract in the frozen expectation', async (t) => {
  const data = await fixture(t)
  data.manifest.samples[19].expected = { accepted: false, reasonCode: 'cutout_mask_invalid' }
  await data.save()
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, evaluate: (bytes: Buffer) => bytes.toString().endsWith(' 19')
    ? { accepted: false, reasonCode: 'cutout_mask_invalid' } : matchingVerdict(bytes) })
  assert.equal(report.status, 'passed')
  assert.equal(report.samples[19].actual?.reasonCode, 'cutout_mask_invalid')
})

test('only immutable-at-start bytes enter inference; labels and later file changes never affect model inputs', async (t) => {
  const data = await fixture(t)
  let calls = 0
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, evaluate: async (...args: Buffer[]) => {
    assert.equal(args.length, 1)
    assert.ok(Buffer.isBuffer(args[0]))
    assert.equal(args[0].toString(), `synthetic fixture ${calls}`)
    if (calls++ === 0) await fs.writeFile(path.join(data.directory, data.manifest.samples[19].file), 'changed during inference')
    return matchingVerdict(args[0])
  } })
  assert.equal(report.status, 'passed')
  assert.equal(calls, 20)
  assert.ok(!JSON.stringify(report.samples).includes('dark-skin'))
  assert.ok(!JSON.stringify(report).includes('synthetic fixture'))
})

test('explicit execution without an explicit models directory does not infer or use the real user profile', async (t) => {
  const data = await fixture(t)
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, execute: true })
  assert.equal(report.status, 'not_run')
  assert.equal(report.reasonCode, 'models_directory_required')
  assert.equal(report.inference, 'none')
})

test('invalid JSON, unsafe IDs, remote file URLs and invalid hashes remain private validation failures', async (t) => {
  const data = await fixture(t)
  await fs.writeFile(data.manifestPath, '{ secret-invalid-json')
  const unreadable = await runPortraitAcceptance({ manifestPath: data.manifestPath })
  assert.equal(unreadable.reasonCode, 'manifest_unreadable')
  data.manifest.samples[0].id = '/private/secret-id'
  data.manifest.samples[0].file = 'https://example.invalid/private.png'
  data.manifest.samples[0].sha256 = 'private-secret-hash'
  await data.save()
  const invalid = await runPortraitAcceptance({ manifestPath: data.manifestPath })
  assert.equal(invalid.reasonCode, 'manifest_invalid')
  assert.ok(!JSON.stringify([unreadable, invalid]).includes('private'))
  assert.ok(!JSON.stringify([unreadable, invalid]).includes('secret'))
})

test('CLI emits parseable not_run JSON without a manifest; bad options are also sanitized', () => {
  const cli = fileURLToPath(new URL('../scripts/portrait-acceptance.mjs', import.meta.url))
  const missing = spawnSync(process.execPath, [cli], { encoding: 'utf8' })
  assert.equal(missing.status, 2, missing.stderr)
  assert.equal(JSON.parse(missing.stdout).reasonCode, 'manifest_not_provided')
  const invalid = spawnSync(process.execPath, [cli, '--private-secret'], { encoding: 'utf8' })
  assert.equal(invalid.status, 2)
  assert.equal(JSON.parse(invalid.stdout).status, 'not_run')
  assert.ok(!invalid.stdout.includes('private-secret'))
})

test('CLI writes a local report on request and never overwrites an existing fixture or manifest', async (t) => {
  const data = await fixture(t)
  const cli = fileURLToPath(new URL('../scripts/portrait-acceptance.mjs', import.meta.url))
  const output = path.join(data.directory, 'report.json')
  const run = spawnSync(process.execPath, [cli, '--manifest', data.manifestPath, '--output', output], { encoding: 'utf8' })
  assert.equal(run.status, 2, run.stderr)
  assert.equal(JSON.parse(await fs.readFile(output, 'utf8')).reasonCode, 'execute_not_requested')
  const before = await fs.readFile(data.manifestPath)
  const overwrite = spawnSync(process.execPath, [cli, '--manifest', data.manifestPath, '--output', data.manifestPath], { encoding: 'utf8' })
  assert.equal(overwrite.status, 2)
  assert.equal(JSON.parse(overwrite.stdout).reasonCode, 'arguments_or_output_invalid')
  assert.deepEqual(await fs.readFile(data.manifestPath), before)
})

test('production binding preflights explicit local models and cannot pass with missing weights', async (t) => {
  const data = await fixture(t)
  const modelsDirectory = path.join(data.directory, 'empty-models')
  await fs.mkdir(modelsDirectory)
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, execute: true, modelsDirectory, readPipelineFingerprint: fingerprint })
  assert.equal(report.reasonCode, 'model_runtime_unavailable')
  assert.equal(report.validation.status, 'passed')
  assert.equal(report.modelVerification, 'not_run')
  assert.equal(report.inference, 'none')
  assert.deepEqual(report.counts, { total: 20, passed: 0, failed: 0, notRun: 20 })
  assert.deepEqual(await fs.readdir(modelsDirectory), [], 'the tool never downloads missing models')
})

test('pipeline fingerprints bracket evaluation and retain provenance without source paths', async (t) => {
  const data = await fixture(t)
  let reads = 0
  let calls = 0
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, evaluate: (bytes: Buffer) => {
    assert.equal(reads, 1)
    calls += 1
    return matchingVerdict(bytes)
  }, readPipelineFingerprint: () => {
    assert.equal(calls, reads === 0 ? 0 : 20)
    reads += 1
    return fingerprint()
  } })
  assert.equal(reads, 2)
  assert.equal(report.status, 'passed')
  assert.equal(report.pipelineVersion.stable, true)
  assert.deepEqual(report.pipelineVersion.before, { schemaVersion: 1, algorithm: 'sha256', digest: 'a'.repeat(64), fileCount: 1, sharedContracts: fingerprint().sharedContracts })
  assert.deepEqual(report.pipelineVersion.after, report.pipelineVersion.before)
  assert.ok(!JSON.stringify(report).includes('/private/source-path'))
  assert.ok(!JSON.stringify(report).includes('inputPaths'))
})

test('a changed pipeline fingerprint invalidates an otherwise matching acceptance round', async (t) => {
  const data = await fixture(t)
  let reads = 0
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, evaluate: matchingVerdict,
    readPipelineFingerprint: () => fingerprint((reads++ === 0 ? 'a' : 'b').repeat(64)) })
  assert.equal(report.status, 'not_run')
  assert.equal(report.reasonCode, 'pipeline_source_changed')
  assert.equal(report.pipelineVersion.stable, false)
  assert.deepEqual(report.counts, { total: 20, passed: 20, failed: 0, notRun: 0 })
})

test('a shared portrait contract change invalidates a round even when the build fingerprint is stable', async (t) => {
  const data = await fixture(t)
  let reads = 0
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, evaluate: matchingVerdict, readPipelineFingerprint: () => {
    const value = fingerprint()
    if (reads++ !== 0) value.sharedContracts['shared/portraitCutoutGate.js'] = 'b'.repeat(64)
    return value
  } })
  assert.equal(report.status, 'not_run')
  assert.equal(report.reasonCode, 'pipeline_source_changed')
  assert.equal(report.pipelineVersion.before.digest, report.pipelineVersion.after.digest)
  assert.equal(report.pipelineVersion.stable, false)
})

test('unreadable or invalid initial fingerprints prevent all inference and redact errors', async (t) => {
  const data = await fixture(t)
  let calls = 0
  for (const readPipelineFingerprint of [
    () => { throw new Error('/private/secret-fingerprint-file') },
    () => ({ ...fingerprint(), digest: '/private/secret-fingerprint-file' }),
    () => ({ ...fingerprint(), sharedContracts: null }),
  ]) {
    const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, readPipelineFingerprint, evaluate: () => { calls += 1; return {} } })
    assert.equal(report.status, 'not_run')
    assert.equal(report.reasonCode, 'pipeline_fingerprint_unavailable')
    assert.equal(report.inference, 'none')
    assert.ok(!JSON.stringify(report).includes('secret-fingerprint-file'))
  }
  assert.equal(calls, 0)
})

test('preview response contract drift invalidates acceptance even when the build inputs are stable', async (t) => {
  const data = await fixture(t)
  let reads = 0
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, evaluate: matchingVerdict, readPipelineFingerprint: () => {
    const value = fingerprint()
    if (reads++ !== 0) value.sharedContracts['shared/portraitPreview.js'] = '2'.repeat(64)
    return value
  } })
  assert.equal(report.status, 'not_run')
  assert.equal(report.reasonCode, 'pipeline_source_changed')
  assert.equal(report.pipelineVersion.before.digest, report.pipelineVersion.after.digest)
  assert.equal(report.pipelineVersion.stable, false)
})

test('an unreadable final fingerprint cannot yield a stable acceptance pass', async (t) => {
  const data = await fixture(t)
  let reads = 0
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, evaluate: matchingVerdict, readPipelineFingerprint: () => {
    if (reads++ === 0) return fingerprint()
    throw new Error('/private/secret-fingerprint-file')
  } })
  assert.equal(report.status, 'not_run')
  assert.equal(report.reasonCode, 'pipeline_fingerprint_unavailable')
  assert.equal(report.pipelineVersion.stable, false)
  assert.equal(report.pipelineVersion.after, null)
  assert.ok(!JSON.stringify(report).includes('secret-fingerprint-file'))
})

test('shared draft identifier contract drift invalidates a generated-draft acceptance round', async (t) => {
  const data = await fixture(t)
  let reads = 0
  const report = await runPortraitAcceptance({ manifestPath: data.manifestPath, evaluate: matchingVerdict, readPipelineFingerprint: () => {
    const value = fingerprint()
    if (reads++ !== 0) value.sharedContracts['shared/portraitDraftExport.js'] = '4'.repeat(64)
    return value
  } })
  assert.equal(report.status, 'not_run')
  assert.equal(report.reasonCode, 'pipeline_source_changed')
  assert.equal(report.pipelineVersion.stable, false)
})
