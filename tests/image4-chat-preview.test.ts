import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildImage4ChatPreviewMessages,
  getImage4ChatPreviewModeSync,
  getImage4ChatPreviewVariantSync,
} from '../src/app/views/image4ChatPreview.ts'

test('Image4 chat preview mode is URL gated', () => {
  const previousWindow = globalThis.window
  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { search: '?view=panel&image4Preview=1' } },
    })
    assert.equal(getImage4ChatPreviewModeSync(), false)

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { search: '?view=panel&image4Preview=1&image4ChatPreview=1' } },
    })
    assert.equal(getImage4ChatPreviewModeSync(), true)
    assert.equal(getImage4ChatPreviewVariantSync(), 'default')

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { search: '?view=panel&image4Preview=1&image4ChatPreview=density' } },
    })
    assert.equal(getImage4ChatPreviewModeSync(), true)
    assert.equal(getImage4ChatPreviewVariantSync(), 'density')
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    })
  }
})

test('Image4 chat density preview covers short and long bubble widths', () => {
  const messages = buildImage4ChatPreviewMessages(new Date('2026-06-28T20:00:00.000Z'), 'density')

  assert.equal(messages.length, 3)
  assert.equal(messages[0]?.content, '嗯')
  assert.equal(messages[1]?.content, '在。')
  assert.ok((messages[2]?.content.length ?? 0) > 40)
  assert.equal(messages[2]?.runStatus, 'streaming_text')
})

test('Image4 chat preview messages cover final and streaming states', () => {
  const messages = buildImage4ChatPreviewMessages(new Date('2026-06-28T20:00:00.000Z'))

  assert.equal(messages.length, 3)
  assert.equal(messages[0]?.role, 'user')
  assert.equal(messages[1]?.runStatus, 'final')
  assert.equal(messages[2]?.runStatus, 'streaming_text')
  assert.ok(messages.every((message) => message.id.startsWith('image4-chat-preview-')))
})
