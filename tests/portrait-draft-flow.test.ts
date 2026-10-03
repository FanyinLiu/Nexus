import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describePortraitModel, selectPortraitModels } from '../shared/portraitModels.js'
import { createPortraitDraftFlow, portraitDownloadError, portraitModelSummary, portraitProgressKey } from '../src/features/pet/portraitDraftFlow.ts'
import type { PortraitDraftBridge, PortraitDraftResult, PortraitModelProgress, PortraitModelStatus } from '../src/features/pet/portraitDraftFlow.ts'

const preview = {
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jg3kAAAAASUVORK5CYII=',
  width: 1, height: 1,
}

function status(installed: 'present' | 'missing' | 'invalid' = 'missing'): PortraitModelStatus {
  return { releasePublished: true, models: selectPortraitModels().map((model) => ({ ...describePortraitModel(model), installed })) }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
function setup(overrides: Partial<PortraitDraftBridge> = {}) {
  const calls = { status: 0, download: 0, generate: 0, subscribed: 0, unsubscribed: 0 }
  let installed = false
  let progress: (event: PortraitModelProgress) => void = () => undefined
  const bridge: PortraitDraftBridge = {
    getPortraitModelStatus: async () => { calls.status += 1; return status(installed ? 'present' : 'missing') },
    downloadPortraitModels: async () => { calls.download += 1; installed = true; return { ok: true } },
    generatePortraitDraft: async (...args) => { calls.generate += 1; assert.equal(args.length, 0); return { accepted: true } },
    exportPortraitDraft: async () => null,
    subscribePortraitModelProgress: (listener) => {
      calls.subscribed += 1
      progress = listener
      return () => { calls.unsubscribed += 1 }
    },
    ...overrides,
  }
  return { flow: createPortraitDraftFlow({ getBridge: () => bridge }), calls, emit: (event: PortraitModelProgress) => progress(event) }
}

test('creation leaves status, downloads and native picker untouched', () => {
  const { flow, calls } = setup()
  assert.equal(flow.getSnapshot().status, null)
  assert.deepEqual(calls, { status: 0, download: 0, generate: 0, subscribed: 0, unsubscribed: 0 })
})
test('open queries once without downloading; close removes subscription and reopen refreshes', async () => {
  const { flow, calls } = setup()
  const close = flow.open()
  await settle()
  flow.setConsent(true)
  close()
  assert.equal(flow.getSnapshot().consent, false)
  assert.equal(calls.unsubscribed, 1)
  const closeAgain = flow.open()
  await settle()
  assert.equal(calls.status, 2)
  assert.equal(calls.download, 0)
  closeAgain()
})
test('closed status request cannot publish stale readiness', async () => {
  const pending = deferred<PortraitModelStatus>()
  const { flow } = setup({ getPortraitModelStatus: () => pending.promise })
  const close = flow.open()
  close()
  pending.resolve(status('present'))
  await settle()
  assert.equal(flow.getSnapshot().status, null)
  assert.equal(flow.getSnapshot().checking, false)
})
test('older refresh cannot overwrite a newer status result', async () => {
  const pending = deferred<PortraitModelStatus>()
  let count = 0
  const { flow } = setup({ getPortraitModelStatus: () => ++count === 1 ? pending.promise : Promise.resolve(status('present')) })
  const close = flow.open()
  await flow.refresh()
  pending.resolve(status('missing'))
  await settle()
  assert.equal(portraitModelSummary(flow.getSnapshot().status).ready, true)
  close()
})
test('model inventory derives required models and attribution from the shared wired catalog', () => {
  const summary = portraitModelSummary(status())
  assert.deepEqual(summary.models.map((model) => ({ id: model.id, role: model.role, wired: model.wired, sizeBytes: model.sizeBytes, sourceName: model.sourceName, sourceUrl: model.sourceUrl, licenseSpdx: model.licenseSpdx, licenseUrl: model.licenseUrl, trainingDataDocumented: model.trainingDataDocumented })), selectPortraitModels().map(describePortraitModel))
  assert.equal(summary.downloadMegabytes, Math.ceil(selectPortraitModels().reduce((sum, model) => sum + model.sizeBytes, 0) / 1_000_000))
  assert.equal(summary.ready, false)
  assert.equal(portraitModelSummary(status('present')).downloadMegabytes, 0)
})
test('missing required entries and invalid files cannot count as ready', () => {
  const present = status('present')
  present.models.pop()
  assert.equal(portraitModelSummary(present).ready, false)
  assert.equal(portraitModelSummary(status('invalid')).ready, false)
})
test('no bridge shows a localized status failure without exposing an exception', async () => {
  const flow = createPortraitDraftFlow({ getBridge: () => undefined })
  const close = flow.open()
  await settle()
  assert.equal(flow.getSnapshot().modelNotice?.key, 'settings.chat.portrait_flow.status_error')
  close()
})
test('status failure can be retried successfully', async () => {
  let attempts = 0
  const { flow } = setup({ getPortraitModelStatus: async () => {
    if (++attempts === 1) throw new Error('/private/user/picture.png')
    return status('present')
  } })
  const close = flow.open()
  await settle()
  assert.equal(flow.getSnapshot().modelNotice?.error, true)
  assert.equal(JSON.stringify(flow.getSnapshot()).includes('/private'), false)
  await flow.refresh()
  assert.equal(flow.getSnapshot().modelNotice, null)
  assert.equal(portraitModelSummary(flow.getSnapshot().status).ready, true)
  close()
})
test('download requires explicit consent after the disclosure opens', async () => {
  const { flow, calls } = setup()
  const close = flow.open()
  await settle()
  await flow.download()
  assert.equal(calls.download, 0)
  flow.setConsent(true)
  await flow.download()
  assert.equal(calls.download, 1)
  assert.equal(portraitModelSummary(flow.getSnapshot().status).ready, true)
  close()
})
test('installed models and unpublished releases never trigger a download', async () => {
  for (const modelStatus of [status('present'), { ...status(), releasePublished: false }]) {
    const { flow, calls } = setup({ getPortraitModelStatus: async () => modelStatus })
    const close = flow.open()
    await settle()
    flow.setConsent(true)
    await flow.download()
    assert.equal(calls.download, 0)
    close()
  }
})
test('concurrent clicks share one download, including across close and reopen', async () => {
  const pending = deferred<{ ok: true }>()
  let count = 0
  const { flow } = setup({ downloadPortraitModels: () => { count += 1; return pending.promise } })
  const close = flow.open()
  await settle()
  flow.setConsent(true)
  const first = flow.download()
  await flow.download()
  close()
  const closeAgain = flow.open()
  await settle()
  flow.setConsent(true)
  await flow.download()
  assert.equal(count, 1)
  pending.resolve({ ok: true })
  await first
  assert.equal(flow.getSnapshot().downloading, false)
  closeAgain()
})
test('download progress is visible only for a running download and the active disclosure', async () => {
  const pending = deferred<{ ok: true }>()
  const { flow, emit } = setup({ downloadPortraitModels: () => pending.promise })
  const close = flow.open()
  await settle()
  emit({ phase: 'downloading', receivedBytes: 10 })
  assert.equal(flow.getSnapshot().progress, null)
  flow.setConsent(true)
  const run = flow.download()
  emit({ phase: 'downloading', receivedBytes: 20, totalBytes: 100 })
  assert.equal(flow.getSnapshot().progress?.receivedBytes, 20)
  close()
  emit({ phase: 'downloading', receivedBytes: 90 })
  assert.equal(flow.getSnapshot().progress?.receivedBytes, 20)
  pending.resolve({ ok: true })
  await run
  assert.equal(flow.getSnapshot().progress, null)
})
test('download failure retains consent and permits a successful explicit retry', async () => {
  let count = 0
  const { flow } = setup({ downloadPortraitModels: async () => ++count === 1 ? { ok: false, code: 'hash_mismatch' } : { ok: true } })
  const close = flow.open()
  await settle()
  flow.setConsent(true)
  await flow.download()
  assert.equal(flow.getSnapshot().modelNotice?.key, 'settings.chat.portrait_flow.integrity_error')
  assert.equal(flow.getSnapshot().consent, true)
  await flow.download()
  assert.equal(count, 2)
  assert.equal(flow.getSnapshot().modelNotice, null)
  close()
})
test('thrown download errors use safe localized copy', async () => {
  const { flow } = setup({ downloadPortraitModels: async () => { throw new Error('secret-token') } })
  const close = flow.open()
  await settle()
  flow.setConsent(true)
  await flow.download()
  assert.equal(flow.getSnapshot().modelNotice?.key, 'settings.chat.portrait_flow.download_error')
  assert.equal(JSON.stringify(flow.getSnapshot()).includes('secret-token'), false)
  close()
})
test('stable download error codes map to actionable safe messages', () => {
  assert.equal(portraitDownloadError('disk'), 'settings.chat.portrait_flow.disk_error')
  assert.equal(portraitDownloadError('release_unpublished'), 'settings.chat.portrait_flow.release_unavailable')
  assert.equal(portraitDownloadError('unsafe_url'), 'settings.chat.portrait_flow.integrity_error')
  assert.equal(portraitDownloadError('size_mismatch'), 'settings.chat.portrait_flow.integrity_error')
  assert.equal(portraitDownloadError('unknown/private/path'), 'settings.chat.portrait_flow.download_error')
})
test('generation cannot run before required local models are ready', async () => {
  const { flow, calls } = setup()
  await flow.generate()
  const close = flow.open()
  await settle()
  await flow.generate()
  assert.equal(calls.generate, 0)
  close()
})
test('ready generation opens the native picker without passing any image path', async () => {
  const { flow, calls } = setup({ getPortraitModelStatus: async () => status('present') })
  const close = flow.open()
  await settle()
  await flow.generate()
  assert.equal(calls.generate, 1)
  assert.deepEqual(flow.getSnapshot().draftNotice, { key: 'settings.chat.portrait_flow.saved' })
  close()
})
test('picker cancellation leaves models intact and permits retry', async () => {
  let count = 0
  const { flow } = setup({ getPortraitModelStatus: async () => status('present'), generatePortraitDraft: async () => ++count === 1 ? null : { accepted: true } })
  const close = flow.open()
  await settle()
  await flow.generate()
  assert.equal(flow.getSnapshot().draftNotice?.key, 'settings.chat.portrait_flow.cancelled')
  assert.equal(portraitModelSummary(flow.getSnapshot().status).ready, true)
  await flow.generate()
  assert.equal(flow.getSnapshot().draftNotice?.key, 'settings.chat.portrait_flow.saved')
  close()
})
test('image and landmark rejection reuse shared localized messages and safe parameters', async () => {
  for (const [reasonCode, params, key] of [
    ['too_small', { minWidth: 512 }, 'settings.pet.portrait_gate.too_small'],
    ['side_view', {}, 'settings.pet.portrait_gate.side_view'],
    ['cutout_models_unavailable', {}, 'settings.pet.portrait_gate.cutout_models_unavailable'],
    ['cutout_mask_invalid', {}, 'settings.pet.portrait_gate.cutout_mask_invalid'],
  ] as const) {
    const { flow } = setup({ getPortraitModelStatus: async () => status('present'), generatePortraitDraft: async () => ({ accepted: false, reasonCode, messageParams: params }) })
    const close = flow.open()
    await settle()
    await flow.generate()
    assert.deepEqual(flow.getSnapshot().draftNotice, { key, params, error: true })
    close()
  }
})
test('unknown rejection and thrown generation failures cannot expose details or paths', async () => {
  for (const generatePortraitDraft of [
    async (): Promise<PortraitDraftResult> => ({ accepted: false, reasonCode: '/private/path', messageParams: {} }),
    async (): Promise<PortraitDraftResult> => { throw new Error('/private/path') },
  ]) {
    const { flow } = setup({ getPortraitModelStatus: async () => status('present'), generatePortraitDraft })
    const close = flow.open()
    await settle()
    await flow.generate()
    assert.equal(flow.getSnapshot().draftNotice?.key, 'settings.chat.portrait_flow.generate_error')
    assert.equal(JSON.stringify(flow.getSnapshot()).includes('/private/path'), false)
    close()
  }
})
test('closing and reopening a pending native generation does not start a duplicate', async () => {
  const pending = deferred<PortraitDraftResult>()
  let count = 0
  const { flow } = setup({ getPortraitModelStatus: async () => status('present'), generatePortraitDraft: () => { count += 1; return pending.promise } })
  const close = flow.open()
  await settle()
  const first = flow.generate()
  await flow.generate()
  close()
  const closeAgain = flow.open()
  await settle()
  await flow.generate()
  assert.equal(count, 1)
  assert.equal(flow.getSnapshot().generating, true)
  pending.resolve({ accepted: true })
  await first
  assert.equal(flow.getSnapshot().generating, false)
  assert.equal(flow.getSnapshot().draftNotice?.key, 'settings.chat.portrait_flow.saved')
  closeAgain()
})
test('view subscribers can detach without retaining a render callback', async () => {
  const { flow } = setup()
  let changes = 0
  const unsubscribe = flow.subscribe(() => { changes += 1 })
  flow.setConsent(true)
  assert.equal(changes, 1)
  unsubscribe()
  flow.setConsent(false)
  assert.equal(changes, 1)
})

test('all download phases have localized accessible progress labels', () => {
  assert.equal(portraitProgressKey('start'), 'settings.chat.portrait_flow.downloading')
  assert.equal(portraitProgressKey('downloading'), 'settings.chat.portrait_flow.downloading')
  assert.equal(portraitProgressKey('verifying'), 'settings.chat.portrait_flow.verifying')
  assert.equal(portraitProgressKey('retrying'), 'settings.chat.portrait_flow.retrying')
  assert.equal(portraitProgressKey('installed'), 'settings.chat.portrait_flow.verifying')
  assert.equal(portraitProgressKey('error'), 'settings.chat.portrait_flow.download_error')
  assert.equal(portraitProgressKey('done'), 'settings.chat.portrait_flow.ready')
})

test('an accepted preview is normalized and returned only to the requesting open view', async () => {
  const { flow } = setup({ getPortraitModelStatus: async () => status('present'), generatePortraitDraft: async () => ({ accepted: true, preview: { ...preview, path: '/private/image.png' } }) })
  const close = flow.open()
  await settle()
  await flow.generate()
  assert.deepEqual(flow.getSnapshot().preview, preview)
  assert.equal(JSON.stringify(flow.getSnapshot()).includes('/private/image.png'), false)
  close()
  assert.equal(flow.getSnapshot().preview, null)
})

test('accepted drafts with missing or invalid preview remain saved without rendering pixels', async () => {
  for (const value of [undefined, { ...preview, dataUrl: 'file:///private/image.png' }, { ...preview, width: 2 }]) {
    const { flow } = setup({ getPortraitModelStatus: async () => status('present'), generatePortraitDraft: async () => ({ accepted: true, preview: value }) })
    const close = flow.open()
    await settle()
    await flow.generate()
    assert.equal(flow.getSnapshot().preview, null)
    assert.equal(flow.getSnapshot().draftNotice?.key, 'settings.chat.portrait_flow.saved')
    close()
  }
})

test('a result arriving after close cannot retain image pixels', async () => {
  const pending = deferred<PortraitDraftResult>()
  const { flow } = setup({ getPortraitModelStatus: async () => status('present'), generatePortraitDraft: () => pending.promise })
  const close = flow.open()
  await settle()
  const run = flow.generate()
  close()
  pending.resolve({ accepted: true, preview })
  await run
  assert.equal(flow.getSnapshot().preview, null)
  assert.equal(flow.getSnapshot().generating, false)
})

test('reopening during generation does not restore pixels belonging to the closed view', async () => {
  const pending = deferred<PortraitDraftResult>()
  const { flow } = setup({ getPortraitModelStatus: async () => status('present'), generatePortraitDraft: () => pending.promise })
  const close = flow.open()
  await settle()
  const run = flow.generate()
  close()
  const closeAgain = flow.open()
  await settle()
  pending.resolve({ accepted: true, preview })
  await run
  assert.equal(flow.getSnapshot().preview, null)
  assert.equal(flow.getSnapshot().draftNotice?.key, 'settings.chat.portrait_flow.saved')
  closeAgain()
})

test('a new selection clears the old preview through cancellation and a later retry replaces it', async () => {
  const pending = deferred<PortraitDraftResult>()
  let attempt = 0
  const { flow } = setup({ getPortraitModelStatus: async () => status('present'), generatePortraitDraft: async () => ++attempt === 2 ? pending.promise : { accepted: true, preview } })
  const close = flow.open()
  await settle()
  await flow.generate()
  assert.deepEqual(flow.getSnapshot().preview, preview)
  const firstRevision = flow.getSnapshot().previewRevision
  const run = flow.generate()
  assert.equal(flow.getSnapshot().preview, null)
  pending.resolve(null)
  await run
  assert.equal(flow.getSnapshot().preview, null)
  assert.equal(flow.getSnapshot().draftNotice?.key, 'settings.chat.portrait_flow.cancelled')
  await flow.generate()
  assert.deepEqual(flow.getSnapshot().preview, preview)
  assert.ok(flow.getSnapshot().previewRevision > firstRevision)
  close()
})

test('a rejected or failed new generation cannot leave the preceding preview visible', async () => {
  for (const failure of [
    async (): Promise<PortraitDraftResult> => ({ accepted: false, reasonCode: 'too_small', messageParams: {} }),
    async (): Promise<PortraitDraftResult> => { throw new Error('/private/failed.png') },
  ]) {
    let count = 0
    const { flow } = setup({ getPortraitModelStatus: async () => status('present'), generatePortraitDraft: async () => ++count === 1 ? { accepted: true, preview } : failure() })
    const close = flow.open()
    await settle()
    await flow.generate()
    assert.deepEqual(flow.getSnapshot().preview, preview)
    await flow.generate()
    assert.equal(flow.getSnapshot().preview, null)
    assert.equal(flow.getSnapshot().draftNotice?.error, true)
    close()
  }
})
