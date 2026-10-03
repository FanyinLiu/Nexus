/**
 * ISNet's float RGB letterbox and probability-mask decoding. The pinned
 * skytnt/anime-seg weights (493cb60893f47441b26ec4fb9a306bce9e342982)
 * use SkyTNT/anime-segmentation inference.py + export.py: RGB / 255,
 * centred zero padding, img NCHW 1024, and a mask already passed through
 * sigmoid. Applying ImageNet normalisation or another sigmoid changes it.
 */

export const CUTOUT_INPUT_SIZE = 1024

// OpenCV INTER_LINEAR uses half-pixel coordinates and edge replication.
function sampleBilinear(data, width, height, channels, x, y, channel = 0) {
  const sx = Math.max(0, Math.min(width - 1, x))
  const sy = Math.max(0, Math.min(height - 1, y))
  const x0 = Math.floor(sx)
  const y0 = Math.floor(sy)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = sx - x0
  const fy = sy - y0
  const top = data[(y0 * width + x0) * channels + channel] * (1 - fx) + data[(y0 * width + x1) * channels + channel] * fx
  const bottom = data[(y1 * width + x0) * channels + channel] * (1 - fx) + data[(y1 * width + x1) * channels + channel] * fx
  return top * (1 - fy) + bottom * fy
}

/** RGB bytes -> float32 img [1,3,1024,1024], preserving the upstream padding geometry. */
export function prepareCutoutInput(image) {
  const { rgb, width, height } = image
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 2048 || height > 2048 || !(rgb instanceof Uint8Array) || rgb.length !== width * height * 3) {
    throw new Error('cutout_input_invalid')
  }
  const size = CUTOUT_INPUT_SIZE
  const resizedWidth = width >= height ? size : Math.max(1, Math.trunc(size * width / height))
  const resizedHeight = height > width ? size : Math.max(1, Math.trunc(size * height / width))
  const left = Math.floor((size - resizedWidth) / 2)
  const top = Math.floor((size - resizedHeight) / 2)
  const data = new Float32Array(3 * size * size)
  for (let y = 0; y < resizedHeight; y += 1) {
    for (let x = 0; x < resizedWidth; x += 1) {
      const sx = (x + 0.5) * width / resizedWidth - 0.5
      const sy = (y + 0.5) * height / resizedHeight - 0.5
      for (let c = 0; c < 3; c += 1) {
        data[c * size * size + (y + top) * size + x + left] = sampleBilinear(rgb, width, height, 3, sx, sy, c) / 255
      }
    }
  }
  return { data, dims: [1, 3, size, size], width, height, resizedWidth, resizedHeight, left, top }
}

/** Require a usable mask before layering; empty/full masks must not produce a successful draft. */
export function validateCutoutAlpha(alpha, width, height) {
  if (!(alpha instanceof Uint8Array) || alpha.length !== width * height) return false
  let foreground = 0
  for (const value of alpha) foreground += value > 127 ? 1 : 0
  return foreground > 0 && foreground < alpha.length
}

/** Remove letterbox padding and resize the single probability plane back to the source raster. */
export function decodeCutoutMask(tensor, geometry) {
  const size = CUTOUT_INPUT_SIZE
  if (!(tensor?.data instanceof Float32Array) || tensor.data.length !== size * size || tensor.dims?.length !== 4 || tensor.dims.some((n, i) => n !== [1, 1, size, size][i])) {
    throw new Error('cutout_mask_invalid')
  }
  for (const value of tensor.data) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('cutout_mask_invalid')
  }
  const { width, height, resizedWidth, resizedHeight, left, top } = geometry
  const cropped = new Float32Array(resizedWidth * resizedHeight)
  for (let y = 0; y < resizedHeight; y += 1) {
    cropped.set(tensor.data.subarray((y + top) * size + left, (y + top) * size + left + resizedWidth), y * resizedWidth)
  }
  const alpha = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Upstream converts the final float RGBA to uint8 (truncation, not rounding).
      alpha[y * width + x] = Math.trunc(255 * sampleBilinear(cropped, resizedWidth, resizedHeight, 1, (x + 0.5) * resizedWidth / width - 0.5, (y + 0.5) * resizedHeight / height - 0.5))
    }
  }
  if (!validateCutoutAlpha(alpha, width, height)) throw new Error('cutout_mask_invalid')
  return alpha
}
