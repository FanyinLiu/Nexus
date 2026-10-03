import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validatePetModelPortraitDraftExportPayload } from '../electron/ipc/payloadSchemas.js'
import { isWindowChannelAllowed, getRequiredWindowCapability } from '../electron/ipc/windowCapabilities.js'
import { petModelActionNeedsConfirmation, summarizePetModelRequest, summarizePetModelResult } from '../electron/ipc/petModelAudit.js'

const channel = 'pet-model:export-portrait-draft'
const draftId = 'draft-1700000000000-abcd1234'

test('portrait export IPC accepts a draft identifier and bounded attribution but no filesystem targets', () => {
  assert.deepEqual(validatePetModelPortraitDraftExportPayload({ draftId, displayName: '  Portrait  ', attributionText: 'Artist\nCC BY 4.0\n' }), {
    draftId, displayName: 'Portrait', attributionText: 'Artist\nCC BY 4.0\n',
  })
  for (const input of [
    { draftId, archivePath: '/private/target.zip' },
    { draftId, imagePath: '/private/image.png' },
    { draftId, displayName: 'x'.repeat(121) },
    { draftId, attributionText: 'x'.repeat(8193) },
    { draftId: '../private' },
    null,
  ]) assert.throws(() => validatePetModelPortraitDraftExportPayload(input), { message: 'portrait_draft_export_invalid' })
})

test('portrait export is panel-only and its native save dialog supplies the destination boundary', () => {
  assert.equal(getRequiredWindowCapability(channel), 'panel')
  assert.equal(isWindowChannelAllowed(channel, 'panel'), true)
  assert.equal(isWindowChannelAllowed(channel, 'pet'), false)
  assert.equal(isWindowChannelAllowed(channel, 'unknown'), false)
  assert.equal(petModelActionNeedsConfirmation(channel, { draftId }), false)
  assert.equal(summarizePetModelRequest(channel, { draftId }).dialogBacked, true)
})

test('portrait export audit retains only sizes and status, excluding image, identity and destination', () => {
  const sensitive = '/private/portrait-with-token.png'
  const request = summarizePetModelRequest(channel, { draftId, displayName: sensitive, attributionText: sensitive, archivePath: sensitive })
  assert.equal(request.displayNameLength, sensitive.length)
  assert.equal(request.attributionLength, sensitive.length)
  const result = summarizePetModelResult(channel, { exported: true, fileName: sensitive, preview: sensitive, draftId })
  assert.equal(result.exported, true)
  for (const value of [request, result]) {
    assert.equal(JSON.stringify(value).includes(sensitive), false)
    assert.equal(JSON.stringify(value).includes(draftId), false)
  }
  assert.equal(summarizePetModelResult(channel, null).canceled, true)
  assert.equal(summarizePetModelResult(channel, null, new Error(sensitive)).exported, undefined)
})
