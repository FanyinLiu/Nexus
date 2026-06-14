import assert from 'node:assert/strict'
import { test } from 'node:test'

import { analyzeLuminanceUniformity } from '../src/features/vision/frameTextHeuristic.ts'

function field(size: number, fill: number) {
  return new Array<number>(size).fill(fill)
}

// Mostly `background`, with `textPixels` pixels set to a high-contrast value —
// a stand-in for glyphs over a flat background.
function fieldWithText(size: number, background: number, textPixels: number, textValue: number) {
  const pixels = field(size, background)
  for (let index = 0; index < textPixels && index < size; index += 1) {
    pixels[index] = textValue
  }
  return pixels
}

test('analyzeLuminanceUniformity flags a solid frame as near-uniform (skip OCR)', () => {
  assert.equal(analyzeLuminanceUniformity(field(10_000, 30)).nearUniform, true)
  assert.equal(analyzeLuminanceUniformity(field(10_000, 255)).nearUniform, true)
})

test('analyzeLuminanceUniformity does NOT skip a dark frame carrying bright glyphs', () => {
  // ~5% bright "glyphs" over a dark editor background — the case OCR is for.
  const darkEditor = fieldWithText(10_000, 20, 500, 230)
  assert.equal(analyzeLuminanceUniformity(darkEditor).nearUniform, false)
})

test('analyzeLuminanceUniformity never skips a frame with even sparse text', () => {
  // 0.5% text coverage must still fall through to OCR (never eat text).
  const sparse = fieldWithText(10_000, 20, 50, 230)
  assert.equal(analyzeLuminanceUniformity(sparse).nearUniform, false)
})

test('analyzeLuminanceUniformity does not treat a split (half/half) frame as uniform', () => {
  const half = field(10_000, 0)
  for (let index = 5_000; index < 10_000; index += 1) half[index] = 255
  assert.equal(analyzeLuminanceUniformity(half).nearUniform, false)
})

test('analyzeLuminanceUniformity fails safe on an empty field', () => {
  assert.equal(analyzeLuminanceUniformity([]).nearUniform, false)
})
