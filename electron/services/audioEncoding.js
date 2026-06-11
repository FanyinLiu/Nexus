/**
 * Pure PCM encoding helpers — no Electron imports so node:test can load this.
 */

/**
 * Encode mono Float32 samples as a 16-bit PCM WAV file.
 * @param {Float32Array|number[]} samples
 * @param {number} sampleRate
 * @returns {Buffer}
 */
export function encodeWavFromFloat32(samples, sampleRate) {
  const length = samples.length
  const buffer = Buffer.alloc(44 + length * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + length * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // PCM chunk size
  buffer.writeUInt16LE(1, 20) // PCM format
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buffer.writeUInt16LE(2, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample
  buffer.write('data', 36)
  buffer.writeUInt32LE(length * 2, 40)
  for (let i = 0; i < length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2)
  }
  return buffer
}

/**
 * Convert mono Float32 samples to a raw 16-bit little-endian PCM buffer
 * (the shape the streaming TTS pipeline feeds to the renderer).
 * @param {Float32Array|number[]} samples
 * @returns {Buffer}
 */
export function float32ToInt16PcmBuffer(samples) {
  const buffer = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(clamped * 32767), i * 2)
  }
  return buffer
}
