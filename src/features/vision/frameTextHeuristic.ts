// Cheap, deliberately-conservative pre-filter that skips OCR on near-uniform
// screenshots (solid desktops, near-black screensavers, blank fullscreen) where
// there is definitely no text to read.
//
// It ONLY skips frames that are almost entirely a single luminance, so it can
// never drop a text-bearing frame: text always breaks uniformity, even light
// glyphs on a dark code-editor background. Anything with real visual variety —
// video, games, photos, IDEs — falls through to OCR. We do NOT try to detect
// "video/game" frames by pixel stats: that can't be done reliably without
// risking eating real text, and a missed text frame is worse than a wasted OCR.
//
// Fails open everywhere: if the frame can't be decoded/sampled, we run OCR.

const ANALYSIS_MAX_EDGE = 160       // downscale longest side to this before sampling
const UNIFORM_LUMA_DELTA = 8        // pixels within ±this of the mean count as "background"
const UNIFORM_SKIP_RATIO = 0.998    // skip only when ≥99.8% of pixels are background (≈ solid)

export type FrameUniformity = {
  sampleCount: number
  backgroundRatio: number
  nearUniform: boolean
}

/**
 * Pure analyzer: given a grayscale luminance field, decide whether the frame is
 * near-uniform (and therefore textless). Exported for tests — takes raw luma so
 * it needs no DOM.
 */
export function analyzeLuminanceUniformity(luma: ArrayLike<number>): FrameUniformity {
  const sampleCount = luma.length
  if (sampleCount === 0) {
    return { sampleCount: 0, backgroundRatio: 0, nearUniform: false }
  }

  let sum = 0
  for (let index = 0; index < sampleCount; index += 1) {
    sum += luma[index]
  }
  const mean = sum / sampleCount

  let background = 0
  for (let index = 0; index < sampleCount; index += 1) {
    if (Math.abs(luma[index] - mean) <= UNIFORM_LUMA_DELTA) {
      background += 1
    }
  }

  const backgroundRatio = background / sampleCount
  return {
    sampleCount,
    backgroundRatio,
    nearUniform: backgroundRatio >= UNIFORM_SKIP_RATIO,
  }
}

function loadFrameImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Screenshot decode failed.'))
    image.src = src
  })
}

async function decodeFrameLuminance(imageDataUrl: string): Promise<Uint8ClampedArray | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return null
  }

  let image: HTMLImageElement
  try {
    image = await loadFrameImage(imageDataUrl)
  } catch {
    return null
  }

  const width = image.naturalWidth
  const height = image.naturalHeight
  if (!width || !height) return null

  const scale = Math.min(1, ANALYSIS_MAX_EDGE / Math.max(width, height))
  const sampleWidth = Math.max(1, Math.round(width * scale))
  const sampleHeight = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = sampleWidth
  canvas.height = sampleHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  context.drawImage(image, 0, 0, sampleWidth, sampleHeight)

  let pixels: ImageData
  try {
    pixels = context.getImageData(0, 0, sampleWidth, sampleHeight)
  } catch {
    return null // tainted canvas or read failure → fail open
  }

  const luma = new Uint8ClampedArray(sampleWidth * sampleHeight)
  for (let offset = 0, pixel = 0; offset < pixels.data.length; offset += 4, pixel += 1) {
    luma[pixel] = (pixels.data[offset] * 299 + pixels.data[offset + 1] * 587 + pixels.data[offset + 2] * 114) / 1000
  }
  return luma
}

/**
 * True only when the screenshot is near-uniform (no text to read). Fails open
 * (returns false → run OCR) whenever the frame can't be decoded or sampled.
 */
export async function shouldSkipOcrForFrame(imageDataUrl: string): Promise<boolean> {
  const luma = await decodeFrameLuminance(imageDataUrl)
  if (!luma) return false
  return analyzeLuminanceUniformity(luma).nearUniform
}
