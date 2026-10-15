import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pickLive2DPage } from '../scripts/lib/packaged-sustained-runtime-cdp.mjs'

function page(url: string) {
  return { url: () => url }
}

const ready = { ready: true, canvasCount: 1, phase: 'first-frame' }

test('pickLive2DPage prefers the pet window when the panel canvas is enumerated first', () => {
  const panel = page('http://127.0.0.1:47822/?view=panel&section=chat')
  const pet = page('http://127.0.0.1:47822/?view=pet')

  const selected = pickLive2DPage([panel, pet], [ready, ready])

  assert.equal(selected, pet)
})

test('pickLive2DPage keeps a ready panel when no pet page exists', () => {
  const panel = page('http://127.0.0.1:47822/?view=panel&section=chat')

  const selected = pickLive2DPage([panel], [ready])

  assert.equal(selected, panel)
})

test('pickLive2DPage falls back to the pet url before an unrelated page', () => {
  const other = page('http://127.0.0.1:47822/')
  const pet = page('http://127.0.0.1:47822/?view=pet')

  const selected = pickLive2DPage([other, pet], [{}, {}])

  assert.equal(selected, pet)
})
