const DEFAULT_TARGET_PEAK = 0.94

function toBufferView(input) {
  if (Buffer.isBuffer(input)) {
    return input
  }

  if (ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  }

  if (input instanceof ArrayBuffer) {
    return Buffer.from(input)
  }

  return Buffer.from([])
}

function clampSample(sample) {
  return Math.max(-1, Math.min(1, sample))
}

export function decodePcm16LeBufferToFloat32(input) {
  const buffer = toBufferView(input)
  const sampleCount = Math.floor(buffer.byteLength / 2)
  const samples = new Float32Array(sampleCount)

  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = buffer.readInt16LE(index * 2) / 32768
  }

  return samples
}

function removeDcOffsetInPlace(samples) {
  if (!samples.length) return

  let sum = 0
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index]
  }

  const mean = sum / samples.length
  if (Math.abs(mean) < 1e-5) {
    return
  }

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = clampSample(samples[index] - mean)
  }
}

function normalizePeakInPlace(samples, targetPeak = DEFAULT_TARGET_PEAK) {
  if (!samples.length || targetPeak <= 0) return

  let peak = 0
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index]))
  }

  if (peak <= 0 || peak <= targetPeak) {
    return
  }

  const gain = targetPeak / peak
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = clampSample(samples[index] * gain)
  }
}

function applyFadeInInPlace(samples, sampleRate, fadeInMs) {
  const fadeSampleCount = Math.min(
    samples.length,
    Math.max(0, Math.round(sampleRate * (fadeInMs / 1000))),
  )

  if (fadeSampleCount <= 1) {
    return
  }

  for (let index = 0; index < fadeSampleCount; index += 1) {
    const gain = index / (fadeSampleCount - 1)
    samples[index] *= gain
  }
}

function applyFadeOutInPlace(samples, sampleRate, fadeOutMs) {
  const fadeSampleCount = Math.min(
    samples.length,
    Math.max(0, Math.round(sampleRate * (fadeOutMs / 1000))),
  )

  if (fadeSampleCount <= 1) {
    return
  }

  const startIndex = samples.length - fadeSampleCount
  for (let index = 0; index < fadeSampleCount; index += 1) {
    const gain = 1 - (index / (fadeSampleCount - 1))
    samples[startIndex + index] *= gain
  }
}

export function enhanceSpeechSamples(
  inputSamples,
  sampleRate,
  options = {},
) {
  const sourceSamples = inputSamples instanceof Float32Array
    ? inputSamples
    : new Float32Array(inputSamples ?? [])
  const processedSamples = new Float32Array(sourceSamples)

  if (!processedSamples.length) {
    return processedSamples
  }

  removeDcOffsetInPlace(processedSamples)

  if (options.normalizePeak !== false) {
    normalizePeakInPlace(
      processedSamples,
      Number.isFinite(options.targetPeak) ? options.targetPeak : DEFAULT_TARGET_PEAK,
    )
  }

  applyFadeInInPlace(
    processedSamples,
    sampleRate,
    Number.isFinite(options.fadeInMs) ? options.fadeInMs : 10,
  )
  applyFadeOutInPlace(
    processedSamples,
    sampleRate,
    Number.isFinite(options.fadeOutMs) ? options.fadeOutMs : 6,
  )

  const prependSilenceMs = Number.isFinite(options.prependSilenceMs)
    ? Math.max(0, options.prependSilenceMs)
    : 18
  const silenceSampleCount = Math.round(sampleRate * (prependSilenceMs / 1000))

  if (silenceSampleCount <= 0) {
    return processedSamples
  }

  const output = new Float32Array(silenceSampleCount + processedSamples.length)
  output.set(processedSamples, silenceSampleCount)
  return output
}
