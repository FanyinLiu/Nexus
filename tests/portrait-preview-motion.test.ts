import assert from 'node:assert/strict'
import { test } from 'node:test'
import { portraitPreviewMotion } from '../src/features/pet/portraitPreviewMotion.ts'
import type { PortraitPreviewMotionInput } from '../src/features/pet/portraitPreviewMotion.ts'

const ready: PortraitPreviewMotionInput = {
  preview: { dataUrl: 'unused-by-motion-policy', width: 512, height: 768 },
  decodedWidth: 512, decodedHeight: 768, failed: false,
  requested: false, active: true, hidden: false, reducedMotion: false,
}

test('a valid draft stays static until the user explicitly starts motion and returns to static on pause', () => {
  const initial = portraitPreviewMotion(ready)
  assert.equal(initial.canStart, true)
  assert.equal(initial.moving, false)
  assert.equal(initial.messageKey, 'settings.chat.portrait_flow.preview_static')
  const running = portraitPreviewMotion({ ...ready, requested: true })
  assert.equal(running.moving, true)
  assert.equal(running.messageKey, 'settings.chat.portrait_flow.preview_moving')
  assert.equal(portraitPreviewMotion({ ...ready, requested: false }).moving, false)
})

test('motion remains unavailable until the actual PNG has decoded to matching dimensions', () => {
  const pending = portraitPreviewMotion({ ...ready, requested: true, decodedWidth: 0, decodedHeight: 0 })
  assert.equal(pending.moving, false)
  assert.equal(pending.canStart, false)
  assert.equal(pending.unavailable, false)
  assert.equal(portraitPreviewMotion({ ...ready, requested: true }).moving, true)
})

test('invalid decoded geometry cannot animate even when motion was requested', () => {
  for (const [decodedWidth, decodedHeight] of [[513, 768], [512, 767], [Infinity, 768], [768, 512]]) {
    const result = portraitPreviewMotion({ ...ready, requested: true, decodedWidth, decodedHeight })
    assert.equal(result.moving, false)
    assert.equal(result.canStart, false)
    assert.equal(result.unavailable, true)
    assert.equal(result.messageKey, 'settings.chat.portrait_flow.preview_unavailable')
  }
})

test('decode failure disables motion even if an earlier size measurement was valid', () => {
  const result = portraitPreviewMotion({ ...ready, requested: true, failed: true })
  assert.equal(result.moving, false)
  assert.equal(result.canStart, false)
  assert.equal(result.unavailable, true)
})

test('reduced-motion preference suppresses requested animation and explains static fallback', () => {
  const result = portraitPreviewMotion({ ...ready, requested: true, reducedMotion: true })
  assert.equal(result.moving, false)
  assert.equal(result.canStart, false)
  assert.equal(result.messageKey, 'settings.chat.portrait_flow.preview_reduced_motion')
})

test('a hidden document pauses the preview and only a previously requested preview resumes when visible', () => {
  for (const requested of [true, false]) {
    const hidden = portraitPreviewMotion({ ...ready, requested, hidden: true })
    assert.equal(hidden.moving, false)
    assert.equal(hidden.canStart, false)
    assert.equal(portraitPreviewMotion({ ...ready, requested, hidden: false }).moving, requested)
  }
})

test('closed or inactive settings cannot animate regardless of the user motion request', () => {
  const result = portraitPreviewMotion({ ...ready, requested: true, active: false })
  assert.equal(result.moving, false)
  assert.equal(result.canStart, false)
  assert.equal(result.messageKey, 'settings.chat.portrait_flow.preview_static')
})
