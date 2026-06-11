import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { encodeWavFromFloat32, float32ToInt16PcmBuffer } from '../electron/services/audioEncoding.js'

describe('encodeWavFromFloat32', () => {
  test('writes a valid 16-bit mono WAV header', () => {
    const wav = encodeWavFromFloat32(new Float32Array([0, 0.5, -0.5, 1]), 24000)
    assert.equal(wav.length, 44 + 4 * 2)
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
    assert.equal(wav.readUInt16LE(22), 1) // mono
    assert.equal(wav.readUInt32LE(24), 24000) // sample rate
    assert.equal(wav.readUInt16LE(34), 16) // bits per sample
    assert.equal(wav.readUInt32LE(40), 8) // data bytes
  })

  test('clamps out-of-range samples instead of wrapping', () => {
    const wav = encodeWavFromFloat32(new Float32Array([2, -2]), 16000)
    assert.equal(wav.readInt16LE(44), 32767)
    assert.equal(wav.readInt16LE(46), -32767)
  })
})

describe('float32ToInt16PcmBuffer', () => {
  test('converts and clamps', () => {
    const pcm = float32ToInt16PcmBuffer(new Float32Array([0, 1, -1, 3]))
    assert.equal(pcm.length, 8)
    assert.equal(pcm.readInt16LE(0), 0)
    assert.equal(pcm.readInt16LE(2), 32767)
    assert.equal(pcm.readInt16LE(4), -32767)
    assert.equal(pcm.readInt16LE(6), 32767)
  })
})
