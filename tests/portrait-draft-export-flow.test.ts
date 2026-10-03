import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describePortraitModel, selectPortraitModels } from '../shared/portraitModels.js'
import { PORTRAIT_DRAFT_EXPORT_ERROR_CODES, PORTRAIT_DRAFT_EXPORT_LIMITS } from '../shared/portraitDraftExport.js'
import type { PortraitDraftExportPayload, PortraitDraftExportResult } from '../shared/portraitDraftExport.js'
import { createPortraitDraftFlow } from '../src/features/pet/portraitDraftFlow.ts'
import type { PortraitDraftBridge, PortraitDraftResult } from '../src/features/pet/portraitDraftFlow.ts'

const draftId = 'draft-1790985600000-1234abcd'
const preview = {
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jg3kAAAAASUVORK5CYII=',
  width: 1, height: 1,
}
const saved: PortraitDraftExportResult = { exported: true, formatVersion: 2, static: true, width: 1, height: 1, fileName: 'portrait.zip', messageKey: 'settings.chat.portrait_flow.export_saved' }
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup(overrides: Partial<PortraitDraftBridge> = {}) {
  let installed: 'present' | 'missing' = 'present'
  const calls = { generate: 0, download: 0, payloads: [] as PortraitDraftExportPayload[] }
  const bridge: PortraitDraftBridge = {
    getPortraitModelStatus: async () => ({ releasePublished: true, models: selectPortraitModels().map((entry) => ({ ...describePortraitModel(entry), installed })) }),
    subscribePortraitModelProgress: () => () => undefined,
    downloadPortraitModels: async () => { calls.download += 1; installed = 'present'; return { ok: true } },
    generatePortraitDraft: async () => { calls.generate += 1; return { accepted: true, preview, draftId } },
    exportPortraitDraft: async (payload) => { calls.payloads.push(payload); return saved },
    ...overrides,
  }
  return { flow: createPortraitDraftFlow({ getBridge: () => bridge }), calls, setInstalled: (value: typeof installed) => { installed = value } }
}

test('export is never automatic and requires a successful preview with a generated draft identifier', async () => {
  for (const result of [
    { accepted: true },
    { accepted: true, draftId },
    { accepted: true, preview },
    { accepted: true, preview, draftId: '/private/draft.json' },
    { accepted: true, preview: { ...preview, width: 2 }, draftId },
    { accepted: false, reasonCode: 'too_small', messageParams: {} },
    null,
  ] satisfies PortraitDraftResult[]) {
    const { flow, calls } = setup({ generatePortraitDraft: async () => result })
    await flow.exportDraft()
    const close = flow.open()
    await settle()
    await flow.generate()
    assert.equal(flow.getSnapshot().draftId, null)
    await flow.exportDraft()
    assert.equal(calls.payloads.length, 0)
    close()
  }
})

test('export sends a path-free payload with verbatim attribution and retains only a fixed success notice', async () => {
  const { flow, calls } = setup()
  const close = flow.open()
  await settle()
  await flow.generate()
  assert.equal(calls.payloads.length, 0)
  flow.setExportName('  My portrait  ')
  const attribution = 'Artist: Example\nLicense: CC0\n  original spacing  '
  flow.setExportAttribution(attribution)
  await flow.exportDraft('Static portrait')
  assert.deepEqual(calls.payloads, [{ draftId, displayName: 'My portrait', attributionText: attribution }])
  assert.deepEqual(flow.getSnapshot().exportNotice, { key: 'settings.chat.portrait_flow.export_saved' })
  assert.equal(JSON.stringify(flow.getSnapshot()).includes('portrait.zip'), false)
  assert.equal(flow.getSnapshot().draftId, draftId)
  assert.deepEqual(flow.getSnapshot().preview, preview)
  close()
})

test('blank names use the language-specific default provided by the view without changing entered attribution', async () => {
  const { flow, calls } = setup()
  const close = flow.open()
  await settle()
  await flow.generate()
  for (const name of ['', '   ']) {
    flow.setExportName(name)
    await flow.exportDraft('静态肖像')
    assert.equal(calls.payloads.at(-1)?.displayName, '静态肖像')
  }
  flow.setExportName('Custom')
  await flow.exportDraft('静态肖像')
  assert.equal(calls.payloads.at(-1)?.displayName, 'Custom')
  close()
})

test('cancelled export retains the draft and entered fields for a successful retry', async () => {
  let count = 0
  const { flow } = setup({ exportPortraitDraft: async () => ++count === 1 ? null : saved })
  const close = flow.open()
  await settle()
  await flow.generate()
  flow.setExportName('Retry')
  flow.setExportAttribution('Source: local fixture')
  await flow.exportDraft()
  assert.equal(flow.getSnapshot().exportNotice?.key, 'settings.chat.portrait_flow.export_cancelled')
  assert.equal(flow.getSnapshot().draftId, draftId)
  assert.equal(flow.getSnapshot().exportName, 'Retry')
  assert.equal(flow.getSnapshot().exportAttribution, 'Source: local fixture')
  await flow.exportDraft()
  assert.equal(count, 2)
  assert.equal(flow.getSnapshot().exportNotice?.key, 'settings.chat.portrait_flow.export_saved')
  close()
})

test('direct and Electron-wrapped export errors use safe actionable copy and allow retry', async () => {
  const cases = [
    [PORTRAIT_DRAFT_EXPORT_ERROR_CODES.INVALID, 'settings.chat.portrait_flow.export_invalid'],
    [PORTRAIT_DRAFT_EXPORT_ERROR_CODES.UNAVAILABLE, 'settings.chat.portrait_flow.export_unavailable'],
    [PORTRAIT_DRAFT_EXPORT_ERROR_CODES.EXISTS, 'settings.chat.portrait_flow.export_exists'],
    [PORTRAIT_DRAFT_EXPORT_ERROR_CODES.WRITE_FAILED, 'settings.chat.portrait_flow.export_error'],
    ['unknown /private/location secret-token', 'settings.chat.portrait_flow.export_error'],
  ] as const
  for (const [code, key] of cases) {
    let count = 0
    const { flow } = setup({ exportPortraitDraft: async () => {
      if (++count === 1) throw new Error(`Error invoking remote method 'export-portrait-draft': Error: ${code}`)
      return saved
    } })
    const close = flow.open()
    await settle()
    await flow.generate()
    flow.setExportName('Keep this name')
    await flow.exportDraft()
    assert.deepEqual(flow.getSnapshot().exportNotice, { key, error: true })
    assert.equal(flow.getSnapshot().exportName, 'Keep this name')
    assert.equal(flow.getSnapshot().draftId, draftId)
    assert.equal(flow.getSnapshot().exporting, false)
    assert.equal(JSON.stringify(flow.getSnapshot()).includes('secret-token'), false)
    await flow.exportDraft()
    assert.equal(flow.getSnapshot().exportNotice?.key, 'settings.chat.portrait_flow.export_saved')
    close()
  }
})

test('invalid export metadata never reaches IPC and remains available to correct', async () => {
  const { flow, calls } = setup()
  const close = flow.open()
  await settle()
  await flow.generate()
  flow.setExportName('a'.repeat(PORTRAIT_DRAFT_EXPORT_LIMITS.displayNameChars + 1))
  await flow.exportDraft()
  assert.equal(flow.getSnapshot().exportNotice?.key, 'settings.chat.portrait_flow.export_invalid')
  assert.equal(calls.payloads.length, 0)
  flow.setExportName('Corrected')
  assert.equal(flow.getSnapshot().exportNotice, null)
  for (const text of ['a'.repeat(PORTRAIT_DRAFT_EXPORT_LIMITS.attributionChars + 1), 'before\0after']) {
    flow.setExportAttribution(text)
    await flow.exportDraft()
    assert.equal(flow.getSnapshot().exportNotice?.key, 'settings.chat.portrait_flow.export_invalid')
    assert.equal(flow.getSnapshot().exportAttribution, text)
    assert.equal(calls.payloads.length, 0)
  }
  flow.setExportAttribution('Valid original text')
  await flow.exportDraft()
  assert.equal(calls.payloads.length, 1)
  close()
})

test('pending export prevents duplicate dialogs, generation and model downloads', async () => {
  const pending = deferred<PortraitDraftExportResult | null>()
  let exports = 0
  const { flow, calls, setInstalled } = setup({ exportPortraitDraft: () => { exports += 1; return pending.promise } })
  const close = flow.open()
  await settle()
  await flow.generate()
  flow.setExportName('Original')
  const run = flow.exportDraft()
  await flow.exportDraft()
  await flow.generate()
  flow.setExportName('Changed while saving')
  assert.equal(flow.getSnapshot().exportName, 'Original')
  setInstalled('missing')
  await flow.refresh()
  flow.setConsent(true)
  await flow.download()
  assert.equal(calls.download, 0)
  assert.equal(calls.generate, 1)
  assert.equal(exports, 1)
  pending.resolve(saved)
  await run
  assert.equal(flow.getSnapshot().exporting, false)
  close()
})

test('a pending model download prevents export of the current draft', async () => {
  const pending = deferred<{ ok: true }>()
  const { flow, calls, setInstalled } = setup({ downloadPortraitModels: () => pending.promise })
  const close = flow.open()
  await settle()
  await flow.generate()
  setInstalled('missing')
  await flow.refresh()
  flow.setConsent(true)
  const run = flow.download()
  await flow.exportDraft()
  assert.equal(calls.payloads.length, 0)
  pending.resolve({ ok: true })
  await run
  close()
})

test('closing clears the draft reference, pixels, metadata and notices; inactive setters cannot restore them', async () => {
  const { flow } = setup()
  const close = flow.open()
  await settle()
  await flow.generate()
  flow.setExportName('Private name')
  flow.setExportAttribution('Private attribution')
  await flow.exportDraft()
  close()
  flow.setExportName('Attempt to restore')
  flow.setExportAttribution('Attempt to restore')
  assert.equal(flow.getSnapshot().draftId, null)
  assert.equal(flow.getSnapshot().preview, null)
  assert.equal(flow.getSnapshot().exportName, '')
  assert.equal(flow.getSnapshot().exportAttribution, '')
  assert.equal(flow.getSnapshot().exportNotice, null)
})

test('late export success, cancellation and failure cannot add notices after close and reopen', async () => {
  for (const outcome of ['saved', 'cancelled', 'failed'] as const) {
    const pending = deferred<PortraitDraftExportResult | null>()
    let exports = 0
    const { flow } = setup({ exportPortraitDraft: () => { exports += 1; return pending.promise } })
    const close = flow.open()
    await settle()
    await flow.generate()
    const run = flow.exportDraft()
    close()
    const closeAgain = flow.open()
    await settle()
    await flow.exportDraft()
    await flow.generate()
    assert.equal(exports, 1)
    if (outcome === 'failed') pending.reject(new Error(PORTRAIT_DRAFT_EXPORT_ERROR_CODES.WRITE_FAILED))
    else pending.resolve(outcome === 'saved' ? saved : null)
    await run
    assert.equal(flow.getSnapshot().exporting, false)
    assert.equal(flow.getSnapshot().exportNotice, null)
    assert.equal(flow.getSnapshot().draftId, null)
    assert.equal(flow.getSnapshot().preview, null)
    closeAgain()
  }
})

test('new image cancellation, rejection or failure revokes the old export target and metadata', async () => {
  for (const outcome of ['cancelled', 'rejected', 'failed'] as const) {
    let count = 0
    const { flow, calls } = setup({ generatePortraitDraft: async () => {
      if (++count === 1) return { accepted: true, preview, draftId }
      if (outcome === 'failed') throw new Error('native_failure')
      return outcome === 'cancelled' ? null : { accepted: false, reasonCode: 'too_small', messageParams: {} }
    } })
    const close = flow.open()
    await settle()
    await flow.generate()
    flow.setExportName('Previous')
    flow.setExportAttribution('Previous source')
    await flow.generate()
    assert.equal(flow.getSnapshot().draftId, null)
    assert.equal(flow.getSnapshot().exportName, '')
    assert.equal(flow.getSnapshot().exportAttribution, '')
    await flow.exportDraft()
    assert.equal(calls.payloads.length, 0)
    close()
  }
})

test('a draft generated for a closed view cannot become an export target after reopening', async () => {
  const pending = deferred<PortraitDraftResult>()
  const { flow, calls } = setup({ generatePortraitDraft: () => pending.promise })
  const close = flow.open()
  await settle()
  const run = flow.generate()
  close()
  const closeAgain = flow.open()
  await settle()
  pending.resolve({ accepted: true, preview, draftId })
  await run
  assert.equal(flow.getSnapshot().draftId, null)
  await flow.exportDraft()
  assert.equal(calls.payloads.length, 0)
  closeAgain()
})
